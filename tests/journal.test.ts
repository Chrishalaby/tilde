import { describe, expect, it } from 'vitest';
import { PROP } from '../src/config';
import type { Discovery, PersonEntry, TraceEntry } from '../src/state/db';
import { isTraceKind, journalLines, placeName, traceName, whereFrom, type JournalView } from '../src/ui/overlay';

function view(over: Partial<JournalView> = {}): JournalView {
  return {
    letters: new Set<string>(),
    places: [],
    people: [],
    traces: [],
    startX: 0,
    startZ: 0,
    day: 1,
    walked: 0,
    ...over,
  };
}

function place(id: string, kind: string, letter: string | null, x: number, z: number, at: number, day?: number): Discovery {
  const d: Discovery = { id, kind, letter, x, z, at };
  if (day !== undefined) d.day = day;
  return d;
}

function trace(kind: number, n: number): TraceEntry {
  return { id: `trace:${kind}:${n},0`, type: 'trace', kind, x: n, z: 0, day: 1, at: n };
}

function texts(v: JournalView): string[] {
  return journalLines(v).map((line) => line.text);
}

describe('journal', () => {
  it('reads as a quiet notebook even when nothing has happened', () => {
    const lines = texts(view());
    expect(lines).toContain('letters');
    expect(lines).toContain('· · · · · · · · · · · · · · · · · · · · · · · · · ·');
    expect(lines).toContain('0 of 26');
    expect(lines).toContain('places, from where you started');
    expect(lines).toContain('nothing yet');
    expect(lines).toContain('people');
    expect(lines).toContain('no one yet');
    expect(lines).toContain('traces');
    expect(lines).toContain('day 1 · 0.0 km walked');
  });

  it('counts letters, not every place found', () => {
    const places = [
      place('0,0', 'letter', 'K', 300, -300, 1, 1),
      place('1,0', 'castle', null, 0, 2000, 2, 2),
      place('2,0', 'ring', null, 40, 30, 3, 2),
    ];
    const lines = texts(view({ places, letters: new Set(['K']) }));
    expect(lines).toContain('· · · · · · · · · · K · · · · · · · · · · · · · · ·');
    expect(lines).toContain('1 of 26');
    expect(lines).toContain('the letter k       400 m north-east    day 1');
    expect(lines).toContain('a castle           2.0 km south        day 2');
    expect(lines).toContain('a stone ring       where you started   day 2');
  });

  it('shows only the latest few places and people so it fits on screen', () => {
    const places: Discovery[] = [];
    for (let i = 0; i < 9; i++) places.push(place(`${i},0`, 'pool', null, 1000 + i * 100, 0, i, i + 1));
    const people: PersonEntry[] = [];
    for (let i = 0; i < 5; i++) {
      people.push({ id: `person:${i}`, type: 'person', name: `v${i}`, home: 'at the shelter', said: `line ${i}`, day: i + 1, at: i });
    }
    const lines = texts(view({ places, people }));
    expect(lines).toContain('4 earlier');
    expect(lines.filter((line) => line.startsWith('a still pool')).length).toBe(5);
    expect(lines).toContain('2 earlier');
    expect(lines.filter((line) => line.startsWith('v')).length).toBe(3);
    expect(lines).toContain('“line 4”');
    expect(lines).not.toContain('“line 1”');
    expect(lines.some((line) => line.startsWith('v4, at the shelter') && line.endsWith('day 5'))).toBe(true);
    expect(journalLines(view({ places, people })).length).toBeLessThan(40);
  });

  it('tallies traces in plain words', () => {
    const traces = [trace(PROP.WRECK, 1), trace(PROP.CAIRN, 2), trace(PROP.WRECK, 3), trace(PROP.STEPPING, 4)];
    const lines = texts(view({ traces, day: 3, walked: 4260 }));
    expect(lines).toContain('2 shipwrecks · a cairn · stepping stones');
    expect(lines).toContain('day 3 · 4.3 km walked');
  });

  it('names things the way the notebook does', () => {
    expect(traceName(PROP.WRECK)).toBe('a shipwreck');
    expect(traceName(PROP.COLD_FIRE)).toBe('a cold campfire');
    expect(traceName(PROP.CAIRN)).toBe('a cairn');
    expect(traceName(PROP.FALLEN)).toBe('a toppled letter');
    expect(traceName(PROP.STEPPING)).toBe('stepping stones');
    expect(traceName(PROP.DOOR)).toBe('a lone door');
    expect(traceName(PROP.STUMPS)).toBe('a clearing of stumps');
    expect(isTraceKind(PROP.TREE)).toBe(false);
    expect(isTraceKind(PROP.ROCK)).toBe(false);
    expect(isTraceKind(99)).toBe(false);
    expect(placeName('letter', 'K')).toBe('the letter k');
    expect(placeName('castle', null)).toBe('a castle');
    expect(placeName('ring', null)).toBe('a stone ring');
    expect(placeName('tree', null)).toBe('a lone tall tree');
    expect(placeName('pool', null)).toBe('a still pool');
    expect(placeName('shelter', null)).toBe('a shelter');
    expect(whereFrom(0, -980)).toBe('1.0 km north');
    expect(whereFrom(-510, 0)).toBe('500 m west');
    expect(whereFrom(90, 90)).toBe('150 m south-east');
  });
});
