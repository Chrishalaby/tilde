import { describe, expect, it } from 'vitest';
import { MATERIAL } from '../src/config';
import { chunkRng } from '../src/world/hash';
import type { Landmark } from '../src/world/types';
import { localBrain } from '../src/npc/brain';
import { composeLine } from '../src/npc/lines';
import { createNpcManager } from '../src/npc/manager';
import type { Brain, Npc, NpcWorld, PlayerView } from '../src/npc/types';

declare const process: { stdout: { write(text: string): void } };

const SEED = 20260923;
const WATER_EDGE = 100;

interface Fire {
  x: number;
  z: number;
}

interface Stub {
  world: NpcWorld;
  state: {
    tod: number;
    px: number;
    pz: number;
    material: number;
    letters: Set<string>;
  };
}

const LETTER: Landmark = { kind: 'letter', letter: 'A', x: 0, z: 0, y: 5, regionKey: '0,0' };
const SHELTER: Landmark = { kind: 'shelter', letter: null, x: 80, z: 0, y: 5, regionKey: '1,0' };
const FAR: Landmark = { kind: 'tree', letter: null, x: 282.84, z: -282.84, y: 5, regionKey: '0,-1' };
const MARKS: Landmark[] = [LETTER, SHELTER, FAR];
const FIRES: Fire[] = [{ x: 6, z: 2 }, { x: 84, z: 3 }];

function makeWorld(marks: Landmark[], fires: Fire[], undiscovered: string[]): Stub {
  const state = {
    tod: 0.5,
    px: 300,
    pz: 0,
    material: MATERIAL.GRASS as number,
    letters: new Set<string>(),
  };
  const view: PlayerView = { x: state.px, z: state.pz, yaw: 0, lettersFound: state.letters };
  const world: NpcWorld = {
    heightAt: (x: number) => (x > WATER_EDGE ? -2 : 5),
    materialAt: () => state.material,
    timeOfDay: () => state.tod,
    player: () => {
      view.x = state.px;
      view.z = state.pz;
      return view;
    },
    landmarksNear: (x: number, z: number, radius: number) =>
      marks.filter((m) => Math.hypot(m.x - x, m.z - z) <= radius),
    discovered: (key: string) => undiscovered.indexOf(key) < 0,
    fires: () => fires,
  };
  return { world, state };
}

function defaultWorld(): Stub {
  return makeWorld(MARKS, FIRES, ['0,-1']);
}

function testNpc(over: Partial<Npc> = {}): Npc {
  return {
    id: '0,0:0',
    name: 'Tova',
    glyph: 't',
    temperament: 'quiet',
    homeKey: '0,0',
    homeX: 0,
    homeZ: 0,
    x: 0,
    z: 0,
    y: 5,
    yaw: 0,
    speed: 1,
    state: 'idle',
    speaking: null,
    speakUntil: 0,
    ...over,
  };
}

function stubBrain(remote: string | null): Brain {
  return {
    decide: () => ({ moveX: 0, moveZ: 0, state: 'talk' }),
    speak: () => 'the local words',
    speakAsync: () => Promise.resolve(remote),
  };
}

function speakerOf(manager: { snapshots(): Array<{ id: string; speaking: string | null }> }): string | null {
  const found = manager.snapshots().filter((s) => s.id === '0,0:0')[0];
  return found ? found.speaking : null;
}

function flush(): Promise<void> {
  return new Promise((done) => setTimeout(done, 0));
}

function allLines(): string[] {
  const { world, state } = defaultWorld();
  const tones: Npc['temperament'][] = ['curious', 'quiet', 'wistful', 'cheerful'];
  const times = [0.05, 0.25, 0.4, 0.55, 0.7];
  const grounds = [
    MATERIAL.GRASS, MATERIAL.FOREST, MATERIAL.STONE,
    MATERIAL.SAND, MATERIAL.SNOW, MATERIAL.WATER,
  ];
  const out: string[] = [];
  for (let t = 0; t < tones.length; t++) {
    const npc = testNpc({ temperament: tones[t] });
    for (let i = 0; i < times.length; i++) {
      state.tod = times[i];
      for (let g = 0; g < grounds.length; g++) {
        state.material = grounds[g];
        const rng = chunkRng(SEED, t, i * 16 + g, 3);
        for (let n = 0; n < 12; n++) out.push(composeLine(npc, world, rng));
      }
    }
  }
  return out;
}

describe('npc voices', () => {
  it('keeps every line quiet, lowercase and short', () => {
    const lines = allLines();
    expect(lines.length).toBeGreaterThan(100);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      expect(line).toBe(line.toLowerCase());
      expect(line.length).toBeLessThan(90);
      expect(line.indexOf('!')).toBe(-1);
      expect(line.endsWith('.')).toBe(false);
    }
  });

  it('has at least forty distinct things to say', () => {
    const distinct = new Set(allLines());
    expect(distinct.size).toBeGreaterThanOrEqual(40);
  });

  it('points north-east across water', () => {
    const lines = allLines();
    const pointing = lines.filter((line) => line.indexOf('north-east') >= 0);
    expect(pointing.length).toBeGreaterThan(0);
    for (let i = 0; i < pointing.length; i++) {
      expect(pointing[i].indexOf('water')).toBeGreaterThan(-1);
    }
  });

  it('does not repeat any of the last three lines', () => {
    const { world } = defaultWorld();
    const npc = testNpc({ temperament: 'curious' });
    const rng = chunkRng(SEED, 5, 5, 9);
    const said: string[] = [];
    for (let i = 0; i < 60; i++) said.push(localBrain.speak(npc, world, rng));
    for (let i = 3; i < said.length; i++) {
      const window = said.slice(i - 3, i + 1);
      expect(new Set(window).size).toBe(4);
    }
  });
});

describe('npc manager', () => {
  it('populates landmarks deterministically', () => {
    const { world, state } = defaultWorld();
    state.px = 5;
    state.pz = 5;
    const manager = createNpcManager(SEED, world, {});
    manager.update(0.1);
    const ids = manager.snapshots().map((s) => s.id).sort();
    expect(ids).toEqual(['0,0:0', '1,0:0', '1,0:1']);
    expect(manager.count()).toBe(3);
    manager.dispose();
    expect(manager.count()).toBe(0);
  });

  it('makes the same people and the same first words for one seed', () => {
    const run = (): string[] => {
      const { world, state } = defaultWorld();
      state.tod = 0.5;
      const said: string[] = [];
      const manager = createNpcManager(SEED, world, {
        onSpeak: (npc, line) => said.push(`${npc.id}|${npc.name}|${npc.glyph}|${line}`),
      });
      manager.update(0.1);
      const first = manager.snapshots().filter((s) => s.id === '0,0:0')[0];
      state.px = first.x + 10;
      state.pz = first.z;
      for (let i = 0; i < 900; i++) manager.update(0.1);
      const people = manager.snapshots().map((s) => `${s.id}|${s.name}|${s.glyph}`).sort();
      return people.concat(said);
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(3);
  });

  it('never leaves anyone standing on water', () => {
    const { world, state } = defaultWorld();
    state.px = 40;
    state.pz = 0;
    const manager = createNpcManager(SEED, world, {});
    let lowest = Infinity;
    let wet = 0;
    for (let step = 0; step < 6000; step++) {
      state.tod = ((step * 0.1) / 240) % 1;
      manager.update(0.1);
      const shots = manager.snapshots();
      for (let i = 0; i < shots.length; i++) {
        const h = world.heightAt(shots[i].x, shots[i].z);
        if (h < lowest) lowest = h;
        if (h < 0.5) wet++;
      }
    }
    expect(wet).toBe(0);
    expect(lowest).toBe(5);
  });

  it('approaches once, speaks once, then keeps its cooldown', () => {
    const { world, state } = defaultWorld();
    state.tod = 0.5;
    let clock = 0;
    const said: Array<{ id: string; at: number; line: string }> = [];
    const manager = createNpcManager(SEED, world, {
      onSpeak: (npc, line) => said.push({ id: npc.id, at: clock, line }),
    });
    manager.update(0.1);
    clock += 0.1;
    const first = manager.snapshots().filter((s) => s.id === '0,0:0')[0];
    state.px = first.x + 10;
    state.pz = first.z;
    for (let step = 0; step < 1200; step++) {
      manager.update(0.1);
      clock += 0.1;
    }
    const mine = said.filter((s) => s.id === '0,0:0');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0].at).toBeLessThan(60);
    expect(mine.filter((s) => s.at < mine[0].at + 45).length).toBe(1);
    expect(mine[0].line.length).toBeLessThan(90);
  });

  it('sits by the fire at night', () => {
    const { world, state } = defaultWorld();
    state.tod = 0.95;
    state.px = 60;
    state.pz = 40;
    const manager = createNpcManager(SEED, world, {});
    for (let step = 0; step < 3000; step++) manager.update(0.1);
    const shots = manager.snapshots();
    expect(shots.length).toBe(3);
    for (let i = 0; i < shots.length; i++) {
      let near = Infinity;
      for (let f = 0; f < FIRES.length; f++) {
        const d = Math.hypot(shots[i].x - FIRES[f].x, shots[i].z - FIRES[f].z);
        if (d < near) near = d;
      }
      expect(near).toBeLessThanOrEqual(3);
    }
  });

  it('forgets people who are far away and remembers them on return', () => {
    const { world, state } = defaultWorld();
    state.px = 5;
    state.pz = 5;
    const manager = createNpcManager(SEED, world, {});
    manager.update(0.1);
    const before = manager.snapshots().filter((s) => s.id === '0,0:0')[0];
    state.px = 4000;
    state.pz = 0;
    for (let step = 0; step < 40; step++) manager.update(0.1);
    expect(manager.count()).toBe(0);
    state.px = 5;
    state.pz = 5;
    for (let step = 0; step < 30; step++) manager.update(0.1);
    expect(manager.count()).toBe(3);
    const after = manager.snapshots().filter((s) => s.id === '0,0:0')[0];
    expect(after.name).toBe(before.name);
    expect(after.glyph).toBe(before.glyph);
  });

  it('lets an asynchronous brain replace the local line', async () => {
    const { world, state } = defaultWorld();
    state.px = 5;
    state.pz = 5;
    state.tod = 0.5;
    const said: string[] = [];
    const manager = createNpcManager(SEED, world, {
      brain: stubBrain('hello there'),
      onSpeak: (_npc, line) => said.push(line),
    });
    manager.update(0.1);
    expect(speakerOf(manager)).toBe('\u2026');
    await flush();
    expect(speakerOf(manager)).toBe('hello there');
    expect(said).toEqual(['hello there', 'hello there', 'hello there']);
    manager.dispose();
  });

  it('falls back to the local line when the asynchronous brain has nothing', async () => {
    const { world, state } = defaultWorld();
    state.px = 5;
    state.pz = 5;
    state.tod = 0.5;
    const said: string[] = [];
    const manager = createNpcManager(SEED, world, {
      brain: stubBrain(null),
      onSpeak: (_npc, line) => said.push(line),
    });
    manager.update(0.1);
    expect(speakerOf(manager)).toBe('\u2026');
    await flush();
    expect(speakerOf(manager)).toBe('the local words');
    expect(said).toEqual(['the local words', 'the local words', 'the local words']);
    manager.dispose();
  });

  it('updates thirty villagers well under a frame', () => {
    const marks: Landmark[] = [];
    for (let i = 0; i < 15; i++) {
      marks.push({
        kind: 'shelter',
        letter: null,
        x: -560 + i * 40,
        z: ((i * 97) % 300) - 150,
        y: 5,
        regionKey: `${i},9`,
      });
    }
    const { world, state } = makeWorld(marks, [{ x: -280, z: 0 }], []);
    state.px = -280;
    state.pz = 0;
    state.tod = 0.5;
    const manager = createNpcManager(SEED, world, {});
    manager.update(1 / 60);
    expect(manager.count()).toBe(30);
    for (let i = 0; i < 600; i++) manager.update(1 / 60);
    const iterations = 4000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) manager.update(1 / 60);
    const per = (performance.now() - start) / iterations;
    process.stdout.write(`\n  npc update: ${(per * 1000).toFixed(1)} us per update for ${manager.count()} villagers\n`);
    expect(per).toBeLessThan(1.5);
  });
});

