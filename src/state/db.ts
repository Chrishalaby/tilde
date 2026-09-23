export interface Discovery {
  id: string;
  kind: string;
  letter: string | null;
  x: number;
  z: number;
  at: number;
  day?: number;
}

export interface PersonEntry {
  id: string;
  type: 'person';
  name: string;
  home: string;
  said: string;
  day: number;
  at: number;
}

export interface TraceEntry {
  id: string;
  type: 'trace';
  kind: number;
  x: number;
  z: number;
  day: number;
  at: number;
}

export type JournalEntry = PersonEntry | TraceEntry;

export interface Db {
  addDiscovery(d: Discovery): Promise<void>;
  listDiscoveries(): Promise<Discovery[]>;
  markVisited(key: string): void;
  listVisited(): Promise<string[]>;
  putJournal(entry: JournalEntry): Promise<void>;
  listJournal(): Promise<JournalEntry[]>;
  close(): void;
}

const DISCOVERIES = 'discoveries';
const VISITED = 'visited';
const JOURNAL = 'journal';
const STORES = [DISCOVERIES, VISITED, JOURNAL];
const DB_VERSION = 2;
const MAX_ID = 96;
const MAX_NAME = 32;
const MAX_HOME = 64;
const MAX_SAID = 240;
const OPEN_TIMEOUT_MS = 4000;
const FLUSH_MS = 5000;
const FLUSH_KEYS = 200;

function dbName(seed: number): string {
  const s = Number.isFinite(seed) ? seed : 0;
  return `tilde-${s.toString(36)}`;
}

function factory(): IDBFactory | null {
  try {
    const f = globalThis.indexedDB as IDBFactory | undefined;
    if (!f || typeof f.open !== 'function') return null;
    return f;
  } catch {
    return null;
  }
}

function unref(timer: ReturnType<typeof setTimeout>): void {
  const t = timer as unknown as { unref?: () => void };
  if (typeof t.unref === 'function') {
    try {
      t.unref();
    } catch {
      return;
    }
  }
}

function openRaw(name: string): Promise<IDBDatabase | null> {
  const idb = factory();
  if (!idb) return Promise.resolve(null);
  return new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (db: IDBDatabase | null): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (settled) {
        if (db) {
          try {
            db.close();
          } catch {
            return;
          }
        }
        return;
      }
      settled = true;
      resolve(db);
    };
    let req: IDBOpenDBRequest;
    try {
      req = idb.open(name, DB_VERSION);
    } catch {
      finish(null);
      return;
    }
    timer = setTimeout(() => finish(null), OPEN_TIMEOUT_MS);
    unref(timer);
    req.onupgradeneeded = (): void => {
      try {
        const db = req.result;
        if (!db.objectStoreNames.contains(DISCOVERIES)) db.createObjectStore(DISCOVERIES, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(VISITED)) db.createObjectStore(VISITED, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(JOURNAL)) db.createObjectStore(JOURNAL, { keyPath: 'id' });
      } catch {
        return;
      }
    };
    req.onsuccess = (): void => {
      let db: IDBDatabase | null = null;
      try {
        db = req.result;
      } catch {
        db = null;
      }
      const opened = db;
      if (opened && !STORES.every((store) => opened.objectStoreNames.contains(store))) {
        try {
          opened.close();
        } catch {
          db = null;
        }
        finish(null);
        return;
      }
      if (opened) {
        opened.onversionchange = (): void => {
          try {
            opened.close();
          } catch {
            return;
          }
        };
      }
      finish(opened);
    };
    req.onerror = (): void => finish(null);
    req.onblocked = (): void => finish(null);
  });
}

function readAll(db: IDBDatabase, store: string): Promise<unknown[]> {
  return new Promise<unknown[]>((resolve) => {
    let settled = false;
    const done = (rows: unknown[]): void => {
      if (settled) return;
      settled = true;
      resolve(rows);
    };
    try {
      const tx = db.transaction(store, 'readonly');
      tx.onerror = (): void => done([]);
      tx.onabort = (): void => done([]);
      const req = tx.objectStore(store).getAll();
      req.onsuccess = (): void => done(Array.isArray(req.result) ? (req.result as unknown[]) : []);
      req.onerror = (): void => done([]);
    } catch {
      done([]);
    }
  });
}

function putAll(db: IDBDatabase, store: string, values: unknown[]): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.oncomplete = done;
      tx.onerror = done;
      tx.onabort = done;
      const os = tx.objectStore(store);
      for (const value of values) {
        const req = os.put(value);
        req.onerror = (): void => undefined;
      }
    } catch {
      done();
    }
  });
}

function isDay(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function toDiscovery(v: unknown): Discovery | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.kind !== 'string') return null;
  if (typeof r.x !== 'number' || typeof r.z !== 'number' || typeof r.at !== 'number') return null;
  const d: Discovery = {
    id: r.id,
    kind: r.kind,
    letter: typeof r.letter === 'string' ? r.letter : null,
    x: r.x,
    z: r.z,
    at: r.at,
  };
  if (isDay(r.day)) d.day = r.day;
  return d;
}

function toJournalEntry(v: unknown): JournalEntry | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > MAX_ID) return null;
  if (!isDay(r.day) || !isNumber(r.at)) return null;
  if (r.type === 'person') {
    if (typeof r.name !== 'string' || typeof r.home !== 'string' || typeof r.said !== 'string') return null;
    const name = r.name.slice(0, MAX_NAME);
    if (name.length === 0) return null;
    return {
      id: r.id,
      type: 'person',
      name,
      home: r.home.slice(0, MAX_HOME),
      said: r.said.slice(0, MAX_SAID),
      day: r.day,
      at: r.at,
    };
  }
  if (r.type === 'trace') {
    if (!isNumber(r.kind) || !isNumber(r.x) || !isNumber(r.z)) return null;
    return { id: r.id, type: 'trace', kind: r.kind, x: r.x, z: r.z, day: r.day, at: r.at };
  }
  return null;
}

export async function openDb(seed: number): Promise<Db> {
  let db: IDBDatabase | null = null;
  try {
    db = await openRaw(dbName(seed));
  } catch {
    db = null;
  }

  const discoveries = new Map<string, Discovery>();
  const visited = new Set<string>();
  const journal = new Map<string, JournalEntry>();

  const hydrate = async (source: IDBDatabase): Promise<void> => {
    try {
      for (const row of await readAll(source, DISCOVERIES)) {
        const d = toDiscovery(row);
        if (d) discoveries.set(d.id, d);
      }
      for (const row of await readAll(source, VISITED)) {
        const r = row as { key?: unknown } | null;
        if (r && typeof r.key === 'string') visited.add(r.key);
      }
      for (const row of await readAll(source, JOURNAL)) {
        const entry = toJournalEntry(row);
        if (entry) journal.set(entry.id, entry);
      }
    } catch {
      return;
    }
  };

  if (db) await hydrate(db);

  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    if (!db) return;
    void putAll(
      db,
      VISITED,
      batch.map((key) => ({ key })),
    );
  };

  const schedule = (): void => {
    if (timer !== null) return;
    timer = setTimeout(flush, FLUSH_MS);
    unref(timer);
  };

  return {
    addDiscovery(d: Discovery): Promise<void> {
      const clean = toDiscovery(d);
      if (!clean || closed) return Promise.resolve();
      discoveries.set(clean.id, clean);
      if (!db) return Promise.resolve();
      return putAll(db, DISCOVERIES, [clean]);
    },
    listDiscoveries(): Promise<Discovery[]> {
      const rows = Array.from(discoveries.values());
      rows.sort((a, b) => a.at - b.at);
      return Promise.resolve(rows);
    },
    markVisited(key: string): void {
      if (closed || typeof key !== 'string' || key.length === 0) return;
      if (visited.has(key)) return;
      visited.add(key);
      pending.push(key);
      if (pending.length >= FLUSH_KEYS) flush();
      else schedule();
    },
    listVisited(): Promise<string[]> {
      return Promise.resolve(Array.from(visited));
    },
    putJournal(entry: JournalEntry): Promise<void> {
      const clean = toJournalEntry(entry);
      if (!clean || closed) return Promise.resolve();
      journal.set(clean.id, clean);
      if (!db) return Promise.resolve();
      return putAll(db, JOURNAL, [clean]);
    },
    listJournal(): Promise<JournalEntry[]> {
      const rows = Array.from(journal.values());
      rows.sort((a, b) => a.at - b.at);
      return Promise.resolve(rows);
    },
    close(): void {
      if (closed) return;
      flush();
      closed = true;
      if (!db) return;
      try {
        db.close();
      } catch {
        return;
      }
    },
  };
}
