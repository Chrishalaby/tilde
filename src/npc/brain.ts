import { composeLine } from './lines';
import type { Brain, Intent, Npc, NpcWorld } from './types';

const DAY_START = 0.27;
const DAY_END = 0.73;
const DUSK_END = 0.85;
const HOME_RADIUS = 60;
const FIRE_RADIUS = 40;
const TALK_RANGE = 14;
const TALK_DISTANCE = 2.6;
const TALK_HOLD = 6;
const TALK_COOLDOWN = 45;
const MAX_SLOPE = 0.9;
const WATER_LEVEL = 0.5;
const PROBE = 1.5;
const ARRIVE = 1.2;
const PAUSE_MIN = 4;
const PAUSE_SPAN = 8;
const LEG_MIN = 6;
const LEG_SPAN = 10;
const FIRE_RECHECK = 5;
const RECENT_LINES = 3;
const TURNS = [0.6, -0.6, 1.3, -1.3, 2.1, -2.1];

interface Memory {
  t: number;
  pauseUntil: number;
  legUntil: number;
  targetX: number;
  targetZ: number;
  talkEnd: number;
  cooldownUntil: number;
  fireCheck: number;
  restX: number;
  restZ: number;
  restAngle: number;
  recent: string[];
}

const memories = new WeakMap<Npc, Memory>();

function memoryFor(npc: Npc, rng: () => number): Memory {
  let memory = memories.get(npc);
  if (!memory) {
    memory = {
      t: 0,
      pauseUntil: 0,
      legUntil: 0,
      targetX: npc.homeX,
      targetZ: npc.homeZ,
      talkEnd: -1,
      cooldownUntil: 0,
      fireCheck: -1,
      restX: npc.homeX,
      restZ: npc.homeZ,
      restAngle: rng() * Math.PI * 2,
      recent: [],
    };
    memories.set(npc, memory);
  }
  return memory;
}

function passable(world: NpcWorld, npc: Npc, here: number, dx: number, dz: number): boolean {
  const height = world.heightAt(npc.x + dx * PROBE, npc.z + dz * PROBE);
  if (height < WATER_LEVEL) return false;
  return Math.abs(height - here) / PROBE <= MAX_SLOPE;
}

function steer(
  world: NpcWorld,
  npc: Npc,
  here: number,
  dx: number,
  dz: number,
  rng: () => number,
  out: Intent,
): boolean {
  if (passable(world, npc, here, dx, dz)) {
    out.moveX = dx * npc.speed;
    out.moveZ = dz * npc.speed;
    return true;
  }
  const sign = rng() < 0.5 ? -1 : 1;
  for (let i = 0; i < TURNS.length; i++) {
    const angle = TURNS[i] * sign;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rx = dx * cos - dz * sin;
    const rz = dx * sin + dz * cos;
    if (passable(world, npc, here, rx, rz)) {
      out.moveX = rx * npc.speed;
      out.moveZ = rz * npc.speed;
      return true;
    }
  }
  out.moveX = 0;
  out.moveZ = 0;
  return false;
}

function travel(
  world: NpcWorld,
  npc: Npc,
  here: number,
  targetX: number,
  targetZ: number,
  rng: () => number,
  out: Intent,
): number {
  const dx = targetX - npc.x;
  const dz = targetZ - npc.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  if (distance < 0.0001) {
    out.moveX = 0;
    out.moveZ = 0;
    return distance;
  }
  steer(world, npc, here, dx / distance, dz / distance, rng, out);
  return distance;
}

function restPoint(npc: Npc, world: NpcWorld, memory: Memory): void {
  if (memory.t < memory.fireCheck) return;
  memory.fireCheck = memory.t + FIRE_RECHECK;
  const fires = world.fires();
  let bestX = npc.homeX;
  let bestZ = npc.homeZ;
  let best = FIRE_RADIUS * FIRE_RADIUS;
  for (let i = 0; i < fires.length; i++) {
    const fire = fires[i];
    const dx = fire.x - npc.homeX;
    const dz = fire.z - npc.homeZ;
    const d2 = dx * dx + dz * dz;
    if (d2 >= best) continue;
    best = d2;
    bestX = fire.x + Math.cos(memory.restAngle) * 1.1;
    bestZ = fire.z + Math.sin(memory.restAngle) * 1.1;
  }
  memory.restX = bestX;
  memory.restZ = bestZ;
}

function decide(npc: Npc, world: NpcWorld, dt: number, rng: () => number): Intent {
  const memory = memoryFor(npc, rng);
  memory.t += dt;
  const out: Intent = { moveX: 0, moveZ: 0, state: 'idle' };

  if (memory.t < memory.talkEnd) {
    out.state = 'talk';
    return out;
  }

  const time = world.timeOfDay();
  const day = time >= DAY_START && time < DAY_END;
  const dusk = !day && time >= DAY_END && time < DUSK_END;
  const here = world.heightAt(npc.x, npc.z);

  if (day && memory.t >= memory.cooldownUntil) {
    const view = world.player();
    const dx = view.x - npc.x;
    const dz = view.z - npc.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance < TALK_RANGE) {
      if (distance > TALK_DISTANCE) {
        out.state = 'approach';
        steer(world, npc, here, dx / distance, dz / distance, rng, out);
        return out;
      }
      memory.talkEnd = memory.t + TALK_HOLD;
      memory.cooldownUntil = memory.t + TALK_HOLD + TALK_COOLDOWN;
      memory.pauseUntil = memory.talkEnd;
      out.state = 'talk';
      return out;
    }
  }

  if (!day && !dusk) {
    restPoint(npc, world, memory);
    const distance = travel(world, npc, here, memory.restX, memory.restZ, rng, out);
    if (distance < 0.7) {
      out.moveX = 0;
      out.moveZ = 0;
      out.state = 'rest';
      return out;
    }
    out.state = 'return';
    return out;
  }

  if (dusk) {
    const distance = travel(world, npc, here, npc.homeX, npc.homeZ, rng, out);
    if (distance < ARRIVE) {
      out.moveX = 0;
      out.moveZ = 0;
      out.state = 'idle';
      return out;
    }
    out.state = 'return';
    return out;
  }

  if (memory.t < memory.pauseUntil) {
    out.state = 'idle';
    return out;
  }

  if (memory.t >= memory.legUntil) {
    const angle = rng() * Math.PI * 2;
    const radius = Math.sqrt(rng()) * HOME_RADIUS;
    memory.targetX = npc.homeX + Math.cos(angle) * radius;
    memory.targetZ = npc.homeZ + Math.sin(angle) * radius;
    memory.legUntil = memory.t + LEG_MIN + rng() * LEG_SPAN;
  }

  const distance = travel(world, npc, here, memory.targetX, memory.targetZ, rng, out);
  if (distance < ARRIVE || (out.moveX === 0 && out.moveZ === 0)) {
    memory.pauseUntil = memory.t + PAUSE_MIN + rng() * PAUSE_SPAN;
    memory.legUntil = memory.pauseUntil;
    out.moveX = 0;
    out.moveZ = 0;
    out.state = 'idle';
    return out;
  }
  out.state = 'wander';
  return out;
}

function speak(npc: Npc, world: NpcWorld, rng: () => number): string {
  const memory = memoryFor(npc, rng);
  let line = composeLine(npc, world, rng);
  for (let i = 0; i < 8 && memory.recent.indexOf(line) >= 0; i++) {
    line = composeLine(npc, world, rng);
  }
  memory.recent.push(line);
  if (memory.recent.length > RECENT_LINES) memory.recent.shift();
  return line;
}

export const localBrain: Brain = { decide, speak };
