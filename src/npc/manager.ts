import { chunkRng, hash01, mix32, seedFromString } from '../world/hash';
import type { Landmark } from '../world/types';
import { localBrain } from './brain';
import { nameFor } from './names';
import type { Brain, Npc, NpcSnapshot, NpcWorld, PlayerView, Temperament } from './types';

export interface NpcManager {
  update(dt: number): void;
  snapshots(): NpcSnapshot[];
  count(): number;
  dispose(): void;
}

const SPAWN_RADIUS = 700;
const DESPAWN_RADIUS = 900;
const SIM_RADIUS = 350;
const SCAN_INTERVAL = 2;
const SPEAK_HOLD = 6;
const WATER_LEVEL = 0.5;
const PENDING = '\u2026';

const TEMPERAMENTS: Temperament[] = ['curious', 'quiet', 'wistful', 'cheerful'];

interface Entry {
  npc: Npc;
  rng: () => number;
  homeY: number;
  parked: boolean;
  alive: boolean;
  ticket: number;
}

function population(kind: string): number {
  if (kind === 'shelter' || kind === 'ring') return 2;
  if (kind === 'castle') return 4;
  if (kind === 'letter') return 1;
  if (kind === 'tree' || kind === 'pool') return 0;
  return 1;
}

function regionNumbers(key: string): [number, number] {
  const comma = key.indexOf(',');
  if (comma < 0) return [seedFromString(key) | 0, 0];
  const rx = Number.parseInt(key.slice(0, comma), 10);
  const rz = Number.parseInt(key.slice(comma + 1), 10);
  return [Number.isFinite(rx) ? rx : 0, Number.isFinite(rz) ? rz : 0];
}

function snapshotOf(npc: Npc): NpcSnapshot {
  return {
    id: npc.id,
    name: npc.name,
    glyph: npc.glyph,
    x: npc.x,
    y: npc.y,
    z: npc.z,
    yaw: npc.yaw,
    state: npc.state,
    speaking: npc.speaking,
  };
}

export function createNpcManager(
  seed: number,
  world: NpcWorld,
  opts: { brain?: Brain; onSpeak?: (npc: NpcSnapshot, line: string) => void },
): NpcManager {
  const brain = opts.brain ?? localBrain;
  const onSpeak = opts.onSpeak;
  const entries: Entry[] = [];
  const known = new Set<string>();
  let time = 0;
  let scanIn = 0;

  function create(mark: Landmark, index: number, id: string): Entry {
    const [rx, rz] = regionNumbers(mark.regionKey);
    const rng = chunkRng(seed, rx, rz, 101 + index * 7);
    const name = nameFor(seed, mix32(rx, rz, index, 13));
    const temperament = TEMPERAMENTS[mix32(seed, rx, rz, 53 + index) % TEMPERAMENTS.length];
    const speed = 0.7 + hash01(seed, rx, rz, 71 + index) * 0.6;
    const angle = hash01(seed, rx, rz, 89 + index) * Math.PI * 2;
    const radius = 3 + hash01(seed, rx, rz, 97 + index) * 5;
    let homeX = mark.x + Math.cos(angle) * radius;
    let homeZ = mark.z + Math.sin(angle) * radius;
    let homeY = world.heightAt(homeX, homeZ);
    if (homeY < WATER_LEVEL) {
      homeX = mark.x;
      homeZ = mark.z;
      homeY = world.heightAt(homeX, homeZ);
    }
    const npc: Npc = {
      id,
      name,
      glyph: name.charAt(0).toLowerCase(),
      temperament,
      homeKey: mark.regionKey,
      homeX,
      homeZ,
      x: homeX,
      z: homeZ,
      y: homeY,
      yaw: angle,
      speed,
      state: 'idle',
      speaking: null,
      speakUntil: 0,
    };
    return { npc, rng, homeY, parked: true, alive: true, ticket: 0 };
  }

  function spawnNear(px: number, pz: number): void {
    const marks = world.landmarksNear(px, pz, SPAWN_RADIUS);
    for (let i = 0; i < marks.length; i++) {
      const mark = marks[i];
      const dx = mark.x - px;
      const dz = mark.z - pz;
      if (dx * dx + dz * dz > SPAWN_RADIUS * SPAWN_RADIUS) continue;
      const total = population(mark.kind);
      for (let index = 0; index < total; index++) {
        const id = `${mark.regionKey}:${index}`;
        if (known.has(id)) continue;
        known.add(id);
        entries.push(create(mark, index, id));
      }
    }
  }

  function park(entry: Entry): void {
    const npc = entry.npc;
    npc.x = npc.homeX;
    npc.z = npc.homeZ;
    npc.y = entry.homeY;
    npc.state = 'idle';
    npc.speaking = null;
    entry.parked = true;
  }

  function say(entry: Entry, line: string): void {
    const npc = entry.npc;
    npc.speaking = line;
    npc.speakUntil = time + SPEAK_HOLD;
    if (onSpeak) onSpeak(snapshotOf(npc), line);
  }

  function finishTalk(entry: Entry, ticket: number, remote: string | null): void {
    const npc = entry.npc;
    if (!entry.alive || entry.ticket !== ticket || npc.state !== 'talk') return;
    say(entry, remote ?? brain.speak(npc, world, entry.rng));
  }

  function beginTalk(entry: Entry): void {
    const npc = entry.npc;
    const ask = brain.speakAsync;
    if (!ask) {
      say(entry, brain.speak(npc, world, entry.rng));
      return;
    }
    const ticket = ++entry.ticket;
    npc.speaking = PENDING;
    npc.speakUntil = time + SPEAK_HOLD;
    void Promise.resolve(ask.call(brain, npc, world, entry.rng)).then(
      (line) => finishTalk(entry, ticket, line),
      () => finishTalk(entry, ticket, null),
    );
  }

  function simulate(entry: Entry, dt: number, view: PlayerView): void {
    const npc = entry.npc;
    const intent = brain.decide(npc, world, dt, entry.rng);
    if (intent.state === 'talk' && npc.state !== 'talk') beginTalk(entry);
    npc.state = intent.state;
    if (intent.state === 'talk' || intent.state === 'approach') {
      npc.yaw = Math.atan2(npc.x - view.x, npc.z - view.z);
    }
    if (intent.moveX === 0 && intent.moveZ === 0) return;
    const nx = npc.x + intent.moveX * dt;
    const nz = npc.z + intent.moveZ * dt;
    const ny = world.heightAt(nx, nz);
    if (ny < WATER_LEVEL) return;
    npc.x = nx;
    npc.z = nz;
    npc.y = ny;
    if (intent.state !== 'talk' && intent.state !== 'approach') {
      npc.yaw = Math.atan2(-intent.moveX, -intent.moveZ);
    }
  }

  function update(dt: number): void {
    time += dt;
    const view = world.player();
    scanIn -= dt;
    if (scanIn <= 0) {
      scanIn = SCAN_INTERVAL;
      spawnNear(view.x, view.z);
    }
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      const npc = entry.npc;
      const dx = npc.homeX - view.x;
      const dz = npc.homeZ - view.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > DESPAWN_RADIUS * DESPAWN_RADIUS) {
        entry.alive = false;
        known.delete(npc.id);
        entries.splice(i, 1);
        continue;
      }
      if (npc.speaking !== null && time >= npc.speakUntil) npc.speaking = null;
      if (d2 > SIM_RADIUS * SIM_RADIUS) {
        if (!entry.parked) park(entry);
        continue;
      }
      entry.parked = false;
      simulate(entry, dt, view);
    }
  }

  function snapshots(): NpcSnapshot[] {
    const out: NpcSnapshot[] = [];
    for (let i = 0; i < entries.length; i++) out.push(snapshotOf(entries[i].npc));
    return out;
  }

  function count(): number {
    return entries.length;
  }

  function dispose(): void {
    for (let i = 0; i < entries.length; i++) entries[i].alive = false;
    entries.length = 0;
    known.clear();
  }

  return { update, snapshots, count, dispose };
}
