import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type Discovery, type JournalEntry, type PersonEntry, type TraceEntry } from '../src/state/db';

type Row = Record<string, unknown>;

interface Store {
  keyPath: string;
  rows: Map<string, Row>;
}

interface Base {
  version: number;
  stores: Map<string, Store>;
}

interface Pending {
  result: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

interface Opening extends Pending {
  onupgradeneeded: (() => void) | null;
  onblocked: (() => void) | null;
}

interface Fake {
  bases: Map<string, Base>;
  created: string[];
  upgrades: Array<[number, number]>;
  open(name: string, version: number): Opening;
}

function later(fn: () => void): void {
  setTimeout(fn, 0);
}

function createFake(): Fake {
  const bases = new Map<string, Base>();
  const created: string[] = [];
  const upgrades: Array<[number, number]> = [];

  const connect = (base: Base) => ({
    onversionchange: null as (() => void) | null,
    objectStoreNames: { contains: (name: string) => base.stores.has(name) },
    createObjectStore(name: string, opts: { keyPath: string }) {
      created.push(name);
      base.stores.set(name, { keyPath: opts.keyPath, rows: new Map() });
    },
    close(): void {
      return;
    },
    transaction(name: string) {
      const store = base.stores.get(name);
      if (!store) throw new Error('NotFoundError');
      const tx = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        objectStore: () => ({
          getAll(): Pending {
            const req: Pending = { result: undefined, onsuccess: null, onerror: null };
            later(() => {
              req.result = Array.from(store.rows.values()).map((row) => structuredClone(row));
              if (req.onsuccess) req.onsuccess();
            });
            return req;
          },
          put(value: Row): Pending {
            store.rows.set(String(value[store.keyPath]), structuredClone(value));
            return { result: undefined, onsuccess: null, onerror: null };
          },
        }),
      };
      later(() => {
        if (tx.oncomplete) tx.oncomplete();
      });
      return tx;
    },
  });

  return {
    bases,
    created,
    upgrades,
    open(name: string, version: number): Opening {
      const req: Opening = { result: undefined, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      later(() => {
        let base = bases.get(name);
        if (!base) {
          base = { version: 0, stores: new Map() };
          bases.set(name, base);
        }
        if (version < base.version) {
          if (req.onerror) req.onerror();
          return;
        }
        req.result = connect(base);
        if (version > base.version) {
          upgrades.push([base.version, version]);
          base.version = version;
          if (req.onupgradeneeded) req.onupgradeneeded();
        }
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
  };
}

function install(fake: Fake | undefined): void {
  Object.defineProperty(globalThis, 'indexedDB', { value: fake, configurable: true, writable: true });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'indexedDB');
});

const SEED = 424242;
const NAME = `tilde-${SEED.toString(36)}`;

function someone(at: number, said: string): PersonEntry {
  return { id: 'person:3,-2:1', type: 'person', name: 'goshes', home: 'by the castle', said, day: 2, at };
}

function wreck(at: number): TraceEntry {
  return { id: 'trace:2:120,-44', type: 'trace', kind: 2, x: 120.4, z: -44.1, day: 1, at };
}

describe('journal storage', () => {
  it('keeps a journal in memory when there is no IndexedDB', async () => {
    install(undefined);
    const db = await openDb(SEED);
    await db.putJournal(someone(20, 'go well'));
    await db.putJournal(wreck(10));
    await db.putJournal(someone(30, 'you came back'));
    await db.putJournal({ id: '', type: 'trace', kind: 2, x: 0, z: 0, day: 1, at: 1 });
    await db.putJournal({ id: 'odd', type: 'nonsense', day: 1, at: 1 } as unknown as JournalEntry);
    const rows = await db.listJournal();
    expect(rows.map((row) => row.id)).toEqual(['trace:2:120,-44', 'person:3,-2:1']);
    expect((rows[1] as PersonEntry).said).toBe('you came back');
    db.close();
  });

  it('upgrades an old world to version 2 without losing what was found', async () => {
    const fake = createFake();
    const letter = { id: '1,2', kind: 'letter', letter: 'K', x: 700.5, z: 1100.25, at: 1000 };
    fake.bases.set(NAME, {
      version: 1,
      stores: new Map([
        ['discoveries', { keyPath: 'id', rows: new Map<string, Row>([['1,2', letter]]) }],
        ['visited', { keyPath: 'key', rows: new Map<string, Row>([['0,0', { key: '0,0' }], ['0,1', { key: '0,1' }]]) }],
      ]),
    });
    install(fake);

    const first = await openDb(SEED);
    expect(fake.upgrades).toEqual([[1, 2]]);
    expect(fake.created).toEqual(['journal']);
    expect(await first.listDiscoveries()).toEqual([letter]);
    expect((await first.listVisited()).sort()).toEqual(['0,0', '0,1']);
    expect(await first.listJournal()).toEqual([]);

    const castle: Discovery = { id: '4,4', kind: 'castle', letter: null, x: 2300, z: 2310, at: 2000, day: 3 };
    await first.addDiscovery(castle);
    await first.putJournal(wreck(1500));
    await first.putJournal(someone(2500, 'the tall one is north-east of here'));
    first.close();

    const second = await openDb(SEED);
    expect(fake.upgrades).toEqual([[1, 2]]);
    expect(await second.listDiscoveries()).toEqual([letter, castle]);
    expect((await second.listVisited()).sort()).toEqual(['0,0', '0,1']);
    const rows = await second.listJournal();
    expect(rows).toEqual([wreck(1500), someone(2500, 'the tall one is north-east of here')]);
    second.close();
  });

  it('creates every store for a new world', async () => {
    const fake = createFake();
    install(fake);
    const db = await openDb(SEED + 1);
    expect(fake.upgrades).toEqual([[0, 2]]);
    expect(fake.created.sort()).toEqual(['discoveries', 'journal', 'visited']);
    await db.putJournal(wreck(5));
    expect(await db.listJournal()).toEqual([wreck(5)]);
    db.close();
  });
});
