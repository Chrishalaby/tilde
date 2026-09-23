import { chunkRng, hash01, mix32, seedFromString } from '../world/hash';
import type { Landmark } from '../world/types';
import { localBrain } from './brain';
import { nameFor } from './names';
import type { Brain, ChatLine, ChatTurn, Npc, NpcSnapshot, NpcWorld, PlayerView, Temperament } from './types';

export interface NpcInfo {
  id: string;
  name: string;
  glyph: string;
  temperament: Temperament;
  homeKey: string;
  homeKind: string;
  homeLetter: string | null;
  homeX: number;
  homeZ: number;
  x: number;
  z: number;
  speaking: string | null;
}

export interface ChatRequest {
  history: ChatLine[];
  message: string;
  metBefore: boolean;
}

export interface NpcManager {
  update(dt: number): void;
  snapshots(): NpcSnapshot[];
  count(): number;
  dispose(): void;
  hold(id: string): boolean;
  release(id: string): void;
  holding(): string | null;
  info(id: string): NpcInfo | null;
  reply(id: string, request: ChatRequest): Promise<string | null>;
}

export interface NpcManagerOptions {
  brain?: Brain;
  onSpeak?: (npc: NpcSnapshot, line: string) => void;
  greetGap?: number;
  quietAfterTalk?: number;
}

const SPAWN_RADIUS = 700;
const DESPAWN_RADIUS = 900;
const SIM_RADIUS = 350;
const SCAN_INTERVAL = 2;
const SPEAK_HOLD = 6;
const WATER_LEVEL = 0.5;
const BODY_RADIUS = 0.35;
const QUIET_AFTER_TALK = 60;
const PENDING = '\u2026';

const TEMPERAMENTS: Temperament[] = ['curious', 'quiet', 'wistful', 'cheerful'];

interface Entry {
  npc: Npc;
  rng: () => number;
  homeY: number;
  homeKind: string;
  homeLetter: string | null;
  parked: boolean;
  alive: boolean;
  ticket: number;
  quietUntil: number;
}

function population(kind: string): number {
  if (kind === 'shelter' || kind === 'ring') return 3;
  if (kind === 'castle') return 6;
  if (kind === 'letter') return 2;
  if (kind === 'pool' || kind === 'tree') return 0;
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

function isSocial(state: string): boolean {
  return state === 'approach' || state === 'talk';
}

export function createNpcManager(seed: number, world: NpcWorld, opts: NpcManagerOptions): NpcManager {
  const brain = opts.brain ?? localBrain;
  const onSpeak = opts.onSpeak;
  const greetGap = Math.max(0, opts.greetGap ?? 0);
  const quietAfterTalk = Math.max(0, opts.quietAfterTalk ?? QUIET_AFTER_TALK);
  const entries: Entry[] = [];
  const byId = new Map<string, Entry>();
  let time = 0;
  let scanIn = 0;
  let held: Entry | null = null;
  let greeter: Entry | null = null;
  let greetUntil = 0;

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
    const homeLetter = mark.kind === 'letter' && mark.letter ? mark.letter.toLowerCase() : null;
    return {
      npc,
      rng,
      homeY,
      homeKind: mark.kind,
      homeLetter,
      parked: true,
      alive: true,
      ticket: 0,
      quietUntil: 0,
    };
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
        if (byId.has(id)) continue;
        const entry = create(mark, index, id);
        byId.set(id, entry);
        entries.push(entry);
      }
    }
  }

  function letGo(entry: Entry): void {
    if (held === entry) held = null;
    entry.quietUntil = time + quietAfterTalk;
    entry.npc.state = 'idle';
    entry.npc.speaking = null;
  }

  function park(entry: Entry): void {
    if (held === entry) letGo(entry);
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
    if (!entry.alive || entry.ticket !== ticket || npc.state !== 'talk' || held === entry) return;
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

  function mayGreet(entry: Entry): boolean {
    if (time < entry.quietUntil) return false;
    if (held !== null) return false;
    if (greetGap <= 0 || greeter === entry) return true;
    return time >= greetUntil;
  }

  function claim(entry: Entry): void {
    if (greetGap <= 0) return;
    greeter = entry;
    greetUntil = time + greetGap;
  }

  function face(npc: Npc, view: PlayerView): void {
    npc.yaw = Math.atan2(npc.x - view.x, npc.z - view.z);
  }

  function simulate(entry: Entry, dt: number, view: PlayerView): void {
    const npc = entry.npc;
    const intent = brain.decide(npc, world, dt, entry.rng);
    let state = intent.state;
    let moveX = intent.moveX;
    let moveZ = intent.moveZ;
    if (isSocial(state)) {
      if (mayGreet(entry)) {
        claim(entry);
      } else {
        state = 'idle';
        moveX = 0;
        moveZ = 0;
      }
    }
    if (state === 'talk' && npc.state !== 'talk') beginTalk(entry);
    npc.state = state;
    if (isSocial(state)) face(npc, view);
    if (moveX === 0 && moveZ === 0) return;
    let nx = npc.x + moveX * dt;
    let nz = npc.z + moveZ * dt;
    if (world.collide) {
      const moved = world.collide(nx, nz, BODY_RADIUS);
      if (!moved || !Number.isFinite(moved.x) || !Number.isFinite(moved.z)) return;
      nx = moved.x;
      nz = moved.z;
    }
    const ny = world.heightAt(nx, nz);
    if (ny < WATER_LEVEL) return;
    npc.x = nx;
    npc.z = nz;
    npc.y = ny;
    if (!isSocial(state)) npc.yaw = Math.atan2(-moveX, -moveZ);
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
        if (held === entry) held = null;
        if (greeter === entry) greeter = null;
        entry.alive = false;
        byId.delete(npc.id);
        entries.splice(i, 1);
        continue;
      }
      if (npc.speaking !== null && time >= npc.speakUntil) npc.speaking = null;
      if (d2 > SIM_RADIUS * SIM_RADIUS) {
        if (!entry.parked) park(entry);
        continue;
      }
      entry.parked = false;
      if (entry === held) {
        npc.state = 'talk';
        face(npc, view);
        continue;
      }
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
    byId.clear();
    held = null;
    greeter = null;
  }

  function hold(id: string): boolean {
    const entry = byId.get(id);
    if (!entry || !entry.alive) return false;
    if (held !== null && held !== entry) letGo(held);
    held = entry;
    entry.ticket++;
    entry.parked = false;
    const npc = entry.npc;
    npc.state = 'talk';
    npc.speaking = null;
    face(npc, world.player());
    return true;
  }

  function release(id: string): void {
    if (held !== null && held.npc.id === id) letGo(held);
  }

  function holding(): string | null {
    return held ? held.npc.id : null;
  }

  function info(id: string): NpcInfo | null {
    const entry = byId.get(id);
    if (!entry) return null;
    const npc = entry.npc;
    return {
      id: npc.id,
      name: npc.name,
      glyph: npc.glyph,
      temperament: npc.temperament,
      homeKey: npc.homeKey,
      homeKind: entry.homeKind,
      homeLetter: entry.homeLetter,
      homeX: npc.homeX,
      homeZ: npc.homeZ,
      x: npc.x,
      z: npc.z,
      speaking: npc.speaking === PENDING ? null : npc.speaking,
    };
  }

  function answer(npc: Npc, turn: ChatTurn, rng: () => number): Promise<string> {
    if (brain.chat) return brain.chat(npc, world, turn, rng);
    if (localBrain.chat) return localBrain.chat(npc, world, turn, rng);
    return Promise.resolve(brain.speak(npc, world, rng));
  }

  function reply(id: string, request: ChatRequest): Promise<string | null> {
    const entry = byId.get(id);
    if (!entry) return Promise.resolve(null);
    const npc = entry.npc;
    const turn: ChatTurn = {
      history: request.history.slice(),
      message: request.message,
      metBefore: request.metBefore,
      homeKind: entry.homeKind,
    };
    const local = (): string => brain.speak(npc, world, entry.rng);
    const voiced = (text: string): string => {
      if (held === entry && entry.alive) {
        npc.speaking = text;
        npc.speakUntil = time + SPEAK_HOLD;
      }
      return text;
    };
    return new Promise<string>((done) => done(answer(npc, turn, entry.rng))).then(
      (line) => {
        const text = typeof line === 'string' ? line.trim() : '';
        return voiced(text.length > 0 ? text : local());
      },
      () => voiced(local()),
    );
  }

  return { update, snapshots, count, dispose, hold, release, holding, info, reply };
}
