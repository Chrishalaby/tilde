import { afterEach, describe, expect, it, vi } from 'vitest';
import { MATERIAL } from '../src/config';
import { chunkRng } from '../src/world/hash';
import type { Landmark } from '../src/world/types';
import { localBrain } from '../src/npc/brain';
import { createConversation, type ConversationView } from '../src/npc/conversation';
import { villagerInSight } from '../src/npc/focus';
import { composeLine, replyLine } from '../src/npc/lines';
import { createNpcManager } from '../src/npc/manager';
import { createRemoteBrain } from '../src/npc/remote-brain';
import type { Brain, ChatLine, ChatTurn, Npc, NpcSnapshot, NpcWorld, PlayerView } from '../src/npc/types';

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
    expect(ids).toEqual(['0,0:0', '0,0:1', '1,0:0', '1,0:1', '1,0:2']);
    expect(manager.count()).toBe(5);
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
    expect(shots.length).toBe(5);
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
    expect(manager.count()).toBe(5);
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
    expect(said).toEqual(new Array(manager.count()).fill('hello there'));
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
    expect(said).toEqual(new Array(manager.count()).fill('the local words'));
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
    expect(manager.count()).toBe(45);
    for (let i = 0; i < 600; i++) manager.update(1 / 60);
    const iterations = 4000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) manager.update(1 / 60);
    const per = (performance.now() - start) / iterations;
    process.stdout.write(`\n  npc update: ${(per * 1000).toFixed(1)} us per update for ${manager.count()} villagers\n`);
    expect(per).toBeLessThan(1.5);
  });
});

function turn(message: string, over: Partial<ChatTurn> = {}): ChatTurn {
  return { history: [], message, metBefore: false, homeKind: 'letter', ...over };
}

function shotOf(manager: { snapshots(): NpcSnapshot[] }, id: string): NpcSnapshot {
  const found = manager.snapshots().filter((s) => s.id === id)[0];
  if (!found) throw new Error(`no villager ${id}`);
  return found;
}

function person(id: string, x: number, z: number): NpcSnapshot {
  return { id, name: id, glyph: 'a', x, y: 5, z, yaw: 0, state: 'idle', speaking: null };
}

function isQuiet(line: string): boolean {
  return line === line.toLowerCase() && line.indexOf('!') < 0 && line.length < 90 && !line.endsWith('.');
}

describe('talking with a villager', () => {
  it('holds a villager still and facing the traveller for as long as they talk', () => {
    const { world, state } = defaultWorld();
    state.tod = 0.5;
    state.px = 5;
    state.pz = 5;
    let clock = 0;
    const said: Array<{ id: string; at: number }> = [];
    const manager = createNpcManager(SEED, world, {
      onSpeak: (npc) => said.push({ id: npc.id, at: clock }),
    });
    manager.update(0.1);
    const id = '0,0:0';
    const start = shotOf(manager, id);
    state.px = start.x + 3;
    state.pz = start.z + 1;
    expect(manager.hold(id)).toBe(true);
    expect(manager.holding()).toBe(id);
    expect(manager.hold('nowhere:9')).toBe(false);
    said.length = 0;
    for (let step = 0; step < 900; step++) {
      manager.update(0.1);
      clock += 0.1;
      const now = shotOf(manager, id);
      expect(now.x).toBe(start.x);
      expect(now.z).toBe(start.z);
      expect(now.state).toBe('talk');
      expect(now.yaw).toBeCloseTo(Math.atan2(now.x - state.px, now.z - state.pz), 9);
    }
    expect(said).toEqual([]);
    const info = manager.info(id);
    expect(info?.homeKind).toBe('letter');
    expect(info?.homeLetter).toBe('a');
    manager.release(id);
    expect(manager.holding()).toBeNull();
    expect(shotOf(manager, id).state).not.toBe('talk');
    for (let step = 0; step < 550; step++) {
      manager.update(0.1);
      clock += 0.1;
    }
    expect(said.filter((s) => s.id === id)).toEqual([]);
    manager.dispose();
    expect(manager.holding()).toBeNull();
  });

  it('answers the traveller in its own words when there is no server', async () => {
    const { world, state } = defaultWorld();
    state.px = 5;
    state.pz = 5;
    state.tod = 0.5;
    const manager = createNpcManager(SEED, world, {});
    manager.update(0.1);
    const id = '0,0:0';
    manager.hold(id);
    const way = await manager.reply(id, { history: [], message: 'Which way should I go?', metBefore: false });
    expect(way).not.toBeNull();
    expect(way).toContain('north-east');
    expect(way).toContain('water');
    const name = await manager.reply(id, { history: [], message: 'what is your name', metBefore: false });
    const info = manager.info(id);
    expect(info).not.toBeNull();
    expect(name).toContain(info ? info.name.toLowerCase() : '?');
    expect(shotOf(manager, id).speaking).toBe(name);
    expect(await manager.reply('nobody:0', { history: [], message: 'hello', metBefore: false })).toBeNull();
    manager.dispose();
  });

  it('keeps a conversation going until the traveller walks away', async () => {
    const { world, state } = defaultWorld();
    state.px = 5;
    state.pz = 5;
    state.tod = 0.95;
    const manager = createNpcManager(SEED, world, {});
    manager.update(0.1);
    const id = '0,0:1';
    const shot = shotOf(manager, id);
    state.px = shot.x + 2;
    state.pz = shot.z;
    const changes: Array<ConversationView | null> = [];
    const replies: string[] = [];
    const talk = createConversation(manager, {
      metBefore: () => false,
      onChange: (view) => changes.push(view),
      onReply: (_view, line) => replies.push(line),
    });
    const opened = talk.open(id);
    expect(opened?.pending).toBe(true);
    expect(opened?.name).toBe(shot.name.toLowerCase());
    expect(opened?.home).toBe('under the letter a');
    expect(manager.holding()).toBe(id);
    expect(talk.active()).toBe(id);
    await flush();
    expect(replies.length).toBe(1);
    expect(talk.view()?.lines.map((line) => line.who)).toEqual(['npc']);
    expect(talk.say('hello there')).toBe(true);
    expect(talk.say('are you listening')).toBe(false);
    expect(talk.view()?.pending).toBe(true);
    await flush();
    const lines = talk.view()?.lines ?? [];
    expect(lines.map((line) => line.who)).toEqual(['npc', 'player', 'npc']);
    expect(lines[1].text).toBe('hello there');
    expect(talk.say('')).toBe(true);
    await flush();
    expect(talk.view()?.lines.map((line) => line.who)).toEqual(['npc', 'player', 'npc', 'npc']);
    for (const line of talk.view()?.lines ?? []) {
      if (line.who === 'npc') expect(isQuiet(line.text)).toBe(true);
    }
    for (let step = 0; step < 100; step++) manager.update(0.1);
    expect(talk.check(state.px, state.pz)).toBe(true);
    state.px += 9;
    expect(talk.check(state.px, state.pz)).toBe(false);
    expect(talk.view()).toBeNull();
    expect(manager.holding()).toBeNull();
    expect(changes[changes.length - 1]).toBeNull();
    state.px -= 9;
    const again = talk.open(id);
    expect(again?.lines.slice(0, 4).map((line) => line.who)).toEqual(['npc', 'player', 'npc', 'npc']);
    talk.close();
    expect(manager.holding()).toBeNull();
    manager.dispose();
  });

  it('sends the brain a bounded history, the new words apart, and whether they have met', async () => {
    const { world, state } = defaultWorld();
    state.px = 5;
    state.pz = 5;
    state.tod = 0.95;
    const turns: ChatTurn[] = [];
    const brain: Brain = {
      decide: localBrain.decide,
      speak: localBrain.speak,
      chat: (_npc, _world, asked) => {
        turns.push(asked);
        return Promise.resolve('i hear you');
      },
    };
    const manager = createNpcManager(SEED, world, { brain });
    manager.update(0.1);
    const talk = createConversation(manager, { metBefore: (id) => id === '0,0:0' });
    talk.open('0,0:0');
    await flush();
    for (let i = 0; i < 10; i++) {
      expect(talk.say(`question ${i} ` + 'x'.repeat(300))).toBe(true);
      await flush();
    }
    expect(turns.length).toBe(11);
    expect(turns[0].message).toBe('');
    expect(turns[0].history).toEqual([]);
    const lastTurn = turns[10];
    expect(lastTurn.metBefore).toBe(true);
    expect(lastTurn.homeKind).toBe('letter');
    expect(lastTurn.message.startsWith('question 9')).toBe(true);
    expect(lastTurn.message.length).toBe(240);
    expect(lastTurn.history.length).toBe(12);
    expect(lastTurn.history[lastTurn.history.length - 1]).toEqual({ who: 'npc', text: 'i hear you' });
    for (const line of lastTurn.history) expect(line.text.length).toBeLessThanOrEqual(240);
    talk.close();
    manager.dispose();
  });

  it('finds the villager in the middle of the view', () => {
    const eye = { x: 0, y: 6.6, z: 0, yaw: 0, pitch: 0 };
    const ahead = person('ahead', 0.3, -4);
    const aside = person('aside', 3, -4);
    const far = person('far', 0, -7);
    const behind = person('behind', 0, 3);
    expect(villagerInSight(eye, [aside, far, behind, ahead])?.id).toBe('ahead');
    expect(villagerInSight(eye, [aside, far, behind])).toBeNull();
    expect(villagerInSight({ ...eye, yaw: -Math.atan2(3, 4) }, [aside, ahead])?.id).toBe('aside');
    const close = person('close', 0, -1.2);
    expect(villagerInSight({ ...eye, pitch: -0.5 }, [close])?.id).toBe('close');
    expect(villagerInSight({ ...eye, pitch: 0.9 }, [close])).toBeNull();
    const chest = person('chest', 0, -5);
    const tilt = Math.atan2(5 + 1.2 - eye.y, 5);
    expect(villagerInSight({ ...eye, pitch: tilt }, [chest])?.id).toBe('chest');
    expect(villagerInSight({ ...eye, pitch: tilt - 0.45 }, [chest])).toBeNull();
  });

  it('lets the world push villagers out of solid things', () => {
    const { world, state } = defaultWorld();
    state.tod = 0.5;
    state.px = 60;
    state.pz = 60;
    let calls = 0;
    const walled: NpcWorld = {
      ...world,
      collide: (x, z, radius) => {
        calls++;
        return { x, z: Math.min(z, 12 - radius) };
      },
    };
    const manager = createNpcManager(SEED, walled, {});
    for (let step = 0; step < 3000; step++) {
      manager.update(0.1);
      for (const shot of manager.snapshots()) expect(shot.z).toBeLessThanOrEqual(12);
    }
    expect(calls).toBeGreaterThan(100);
    manager.dispose();
  });

  it('lets only one villager greet a passer-by at a time when a gap is asked for', () => {
    const { world, state } = defaultWorld();
    state.tod = 0.5;
    let clock = 0;
    const said: number[] = [];
    const manager = createNpcManager(SEED, world, { greetGap: 30, onSpeak: () => said.push(clock) });
    manager.update(0.1);
    state.px = 80;
    state.pz = 6;
    for (let step = 0; step < 3000; step++) {
      manager.update(0.1);
      clock += 0.1;
    }
    expect(said.length).toBeGreaterThan(1);
    for (let i = 1; i < said.length; i++) expect(said[i] - said[i - 1]).toBeGreaterThanOrEqual(30);
    manager.dispose();
  });

  it('answers in its own plain words to whatever is said', () => {
    const { world, state } = defaultWorld();
    const messages = [
      '', 'hello', 'what is your name', 'where do you live', 'how are you', 'which way to the nearest letter',
      'how many letters have i found', 'what time is it', 'is the water cold', 'thank you', 'goodbye',
      'tell me about the internet', 'WHERE?!',
    ];
    const history: ChatLine[] = [{ who: 'npc', text: 'it is quiet, that is the whole of it' }];
    const tones: Npc['temperament'][] = ['curious', 'quiet', 'wistful', 'cheerful'];
    let count = 0;
    for (let t = 0; t < tones.length; t++) {
      const npc = testNpc({ temperament: tones[t] });
      for (const time of [0.05, 0.3, 0.5, 0.7]) {
        state.tod = time;
        const rng = chunkRng(SEED, t, Math.round(time * 100), 5);
        for (const message of messages) {
          for (const met of [false, true]) {
            for (const before of [[], history]) {
              const line = replyLine(npc, world, turn(message, { metBefore: met, history: before }), rng);
              expect(isQuiet(line)).toBe(true);
              count++;
            }
          }
        }
      }
    }
    expect(count).toBeGreaterThan(400);
    const npc = testNpc();
    const rng = chunkRng(SEED, 1, 2, 3);
    expect(replyLine(npc, world, turn('what is your name'), rng)).toContain('tova');
    expect(replyLine(npc, world, turn(''), rng)).toContain('tova');
    expect(replyLine(npc, world, turn('', { metBefore: true }), rng)).toContain('you');
    const way = replyLine(npc, world, turn('where should i go'), rng);
    expect(way).toContain('north-east');
    expect(way).toContain('water');
  });
});

describe('remote chat', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  });

  function stubFetch(answer: (init: RequestInit) => Promise<Response>): Array<{ url: string; body: unknown; size: number }> {
    const calls: Array<{ url: string; body: unknown; size: number }> = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = init && typeof init.body === 'string' ? init.body : '';
      calls.push({ url: String(input), body: raw ? JSON.parse(raw) : null, size: new TextEncoder().encode(raw).length });
      return answer(init ?? {});
    }) as typeof fetch;
    return calls;
  }

  function json(status: number, value: unknown): Promise<Response> {
    return Promise.resolve(new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }));
  }

  it('uses the words the server sends and tells it who, where and what was said', async () => {
    const calls = stubFetch(() => json(200, { line: 'the tall one is north-east, past the water' }));
    const { world, state } = defaultWorld();
    state.px = 3;
    state.pz = 3;
    const brain = createRemoteBrain(localBrain);
    const history: ChatLine[] = [
      { who: 'npc', text: 'you came back' },
      { who: 'player', text: 'i did' },
    ];
    const line = await brain.chat?.(testNpc(), world, turn('where now', { history, metBefore: true }), chunkRng(SEED, 1, 1, 1));
    expect(line).toBe('the tall one is north-east, past the water');
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('/api/npc/chat');
    expect(calls[0].body).toEqual({
      npc: { name: 'Tova', glyph: 't', temperament: 'quiet', homeKind: 'letter', homeLetter: 'a' },
      world: {
        phase: 'noon',
        ground: 'grass',
        hint: 'an old tree to the north-east, a long walk, water in the way',
        lettersFound: 0,
        metBefore: true,
      },
      history,
      message: 'where now',
    });
  });

  it('falls back to the local grammar when the server says fallback, and stops asking for a while', async () => {
    const calls = stubFetch(() => json(503, { fallback: true }));
    const { world } = defaultWorld();
    const brain = createRemoteBrain(localBrain);
    const rng = chunkRng(SEED, 2, 2, 2);
    const first = await brain.chat?.(testNpc(), world, turn('hello'), rng);
    const second = await brain.chat?.(testNpc(), world, turn('are you there'), rng);
    expect(typeof first).toBe('string');
    expect(isQuiet(first ?? '!')).toBe(true);
    expect(isQuiet(second ?? '!')).toBe(true);
    expect(calls.length).toBe(1);
  });

  it('falls back when the network fails', async () => {
    stubFetch(() => Promise.reject(new TypeError('offline')));
    const { world } = defaultWorld();
    const line = await createRemoteBrain(localBrain).chat?.(testNpc(), world, turn('hello'), chunkRng(SEED, 3, 3, 3));
    expect(isQuiet(line ?? '!')).toBe(true);
  });

  it('falls back when the server takes too long', async () => {
    vi.useFakeTimers();
    stubFetch((init) => new Promise<Response>((_done, fail) => {
      init.signal?.addEventListener('abort', () => fail(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const { world } = defaultWorld();
    const pending = createRemoteBrain(localBrain).chat?.(testNpc(), world, turn('hello'), chunkRng(SEED, 4, 4, 4));
    await vi.advanceTimersByTimeAsync(10000);
    const line = await pending;
    expect(isQuiet(line ?? '!')).toBe(true);
  });

  it('keeps the request under eight kilobytes however much was said', async () => {
    const calls = stubFetch(() => json(200, { line: 'that is a lot of words' }));
    const { world } = defaultWorld();
    const history: ChatLine[] = [];
    for (let i = 0; i < 20; i++) history.push({ who: i % 2 === 0 ? 'player' : 'npc', text: '字'.repeat(400) });
    await createRemoteBrain(localBrain).chat?.(testNpc(), world, turn('字'.repeat(400), { history }), chunkRng(SEED, 5, 5, 5));
    expect(calls.length).toBe(1);
    expect(calls[0].size).toBeLessThanOrEqual(8000);
    const body = calls[0].body as { history: ChatLine[]; message: string };
    expect(body.history.length).toBeLessThanOrEqual(12);
    expect(body.history.length).toBeGreaterThan(0);
    expect(body.message.length).toBe(240);
    for (const line of body.history) expect(line.text.length).toBeLessThanOrEqual(240);
  });
});
