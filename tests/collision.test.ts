import { Scene, ShaderMaterial } from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHUNK_SIZE, PROP } from '../src/config';
import { PLAYER_RADIUS, createPlayer } from '../src/player/controller';
import type { Player } from '../src/player/controller';
import { createDrift } from '../src/player/drift';
import type { GlyphAtlas } from '../src/render/glyph-atlas';
import { generateChunk } from '../src/world/chunk-gen';
import { createChunkManager } from '../src/world/chunk-manager';
import type { ChunkManager } from '../src/world/chunk-manager';
import { landmarkForRegion } from '../src/world/landmarks';
import { createSampler } from '../src/world/sampler';
import {
  CASTLE,
  castleRuin,
  castleTurn,
  chunkColliders,
  landmarkColliders,
  packColliders,
  partCollider,
  settle,
  treeSolidRadius,
  treeVariant,
} from '../src/world/structures';
import type { ColliderSet, Part } from '../src/world/structures';
import type { ChunkData, GenRequest, Landmark, WorldSampler } from '../src/world/types';

declare const process: { stdout: { write(text: string): void } };

const SEED = 77;
const R = PLAYER_RADIUS;
const STEP = 0.05;
const INNER_FACE = CASTLE.half - CASTLE.wallThickness / 2;
const ATLAS = { index: new Map<string, number>() } as unknown as GlyphAtlas;

const samplers = new Map<number, WorldSampler>();
function samplerFor(seed: number): WorldSampler {
  let sampler = samplers.get(seed);
  if (sampler === undefined) {
    sampler = createSampler(seed);
    samplers.set(seed, sampler);
  }
  return sampler;
}

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage(request: GenRequest): void {
    const data = generateChunk(request.seed, request.cx, request.cz, samplerFor(request.seed));
    if (this.onmessage !== null) this.onmessage({ data: { type: 'chunk', ...data } });
  }
  terminate(): void {}
}

function mark(x: number, z: number): Landmark {
  return { kind: 'castle', letter: null, x, z, y: 10, regionKey: `${x},${z}` };
}

function castles(): Landmark[] {
  const out: Landmark[] = [];
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) out.push(mark(131 + 25 * i + 512 * j, 381 + 25 * j - 512 * i));
  return out;
}

interface Frame {
  toWorld(lx: number, lz: number): { x: number; z: number };
  toLocal(x: number, z: number): { x: number; z: number };
}

function frameOf(m: Landmark): Frame {
  const turn = castleTurn(m);
  const c = [1, 0, -1, 0][turn];
  const s = [0, 1, 0, -1][turn];
  return {
    toWorld: (lx, lz) => ({ x: m.x + c * lx + s * lz, z: m.z - s * lx + c * lz }),
    toLocal: (x, z) => ({ x: c * (x - m.x) - s * (z - m.z), z: s * (x - m.x) + c * (z - m.z) }),
  };
}

function walk(
  sets: ColliderSet[],
  frame: Frame,
  from: [number, number],
  to: [number, number],
): { end: { x: number; z: number }; worstPush: number } {
  const steps = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / STEP);
  let at = frame.toWorld(from[0], from[1]);
  let worstPush = 0;
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const goal = frame.toWorld(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t);
    const local = frame.toLocal(at.x, at.z);
    const stepGoal = frame.toWorld(
      local.x + (to[0] - from[0]) / steps,
      local.z + (to[1] - from[1]) / steps,
    );
    const next = settle(sets, stepGoal.x, stepGoal.z, R);
    worstPush = Math.max(worstPush, Math.hypot(next.x - goal.x, next.z - goal.z));
    at = next;
  }
  return { end: frame.toLocal(at.x, at.z), worstPush };
}

function wall(x: number, z: number, sx: number, sz: number, yaw = 0): Part {
  return { role: 'wall', shape: 'box', material: 2, x, y: 2, z, sx, sy: 4, sz, yaw, tilt: 0, blocks: true };
}

function stubDom(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  const events = { addEventListener: (): void => undefined, removeEventListener: (): void => undefined };
  if (g.window === undefined) g.window = events;
  if (g.document === undefined) g.document = { ...events, pointerLockElement: null };
}

function fakePlayer(yaw: number): Player {
  return {
    pose: { x: 0, z: 0, yaw, pitch: 0 },
    view: { x: 0, y: 0, z: 0, yaw, pitch: 0 },
    speed: 0,
    groundHeight: 5,
    locked: false,
    drifting: true,
    driftInput: { forward: 0, strafe: 0, turn: 0, stroll: true, run: false },
    update: () => undefined,
    onFirstLock: () => undefined,
    dispose: () => undefined,
  };
}

let previousWorker: unknown;

beforeAll(() => {
  const g = globalThis as unknown as { Worker: unknown };
  previousWorker = g.Worker;
  g.Worker = FakeWorker;
});

afterAll(() => {
  (globalThis as unknown as { Worker: unknown }).Worker = previousWorker;
});

function managerAt(x: number, z: number, built: number): ChunkManager {
  const manager = createChunkManager({
    seed: SEED,
    scene: new Scene(),
    terrainMaterial: new ShaderMaterial(),
    atlas: ATLAS,
    sampler: samplerFor(SEED),
  });
  for (let i = 0; i < 80 && manager.stats().loaded < built; i++) manager.update(x, z);
  return manager;
}

describe('castle collisions', () => {
  it('lets a walker straight through the gate in every orientation, ruined or not', () => {
    const seen = new Set<string>();
    for (const m of castles()) {
      const frame = frameOf(m);
      const sets = [chunkColliders(new Float32Array(0), m)];
      const { end, worstPush } = walk(sets, frame, [0, 24], [0, 2.5]);
      expect(worstPush).toBeLessThan(1e-9);
      expect(end.z).toBeCloseTo(2.5, 6);
      seen.add(`${castleTurn(m)}:${castleRuin(m) === null ? 'whole' : 'ruin'}`);
    }
    expect(seen.size).toBe(8);
  });

  it('stops a walker at the curtain walls, the gatehouse flank and the keep', () => {
    const whole = castles().filter((m) => castleRuin(m) === null).slice(0, 48);
    for (const m of whole) {
      const frame = frameOf(m);
      const sets = [chunkColliders(new Float32Array(0), m)];
      expect(walk(sets, frame, [0, 4], [-20, 4]).end.x).toBeCloseTo(-(INNER_FACE - R), 4);
      expect(walk(sets, frame, [0, 4], [20, 4]).end.x).toBeCloseTo(INNER_FACE - R, 4);
      expect(walk(sets, frame, [-7, 2], [-7, -20]).end.z).toBeCloseTo(-(INNER_FACE - R), 4);
      expect(walk(sets, frame, [-7, 2], [-7, 20]).end.z).toBeCloseTo(INNER_FACE - R, 4);
      expect(walk(sets, frame, [2.5, 3], [2.5, 20]).end.z).toBeCloseTo(CASTLE.gateBack - R, 4);
      expect(walk(sets, frame, [1.5, -2], [1.5, -20]).end.z).toBeCloseTo(CASTLE.keepFront + R, 4);
      expect(walk(sets, frame, [0, -30], [0, 0]).end.z).toBeLessThan(-15);
    }
  });

  it('walks a ruin through its breach while the broken stubs still block', () => {
    const ruins = castles().filter((m) => castleRuin(m) !== null);
    expect(ruins.length).toBeGreaterThan(30);
    for (const m of ruins) {
      const ruin = castleRuin(m);
      if (ruin === null) continue;
      const frame = frameOf(m);
      const sets = [chunkColliders(new Float32Array(0), m)];
      const side = ruin.breachRun === 0 ? -1 : 1;
      const mid = (ruin.breachFrom + ruin.breachTo) / 2;
      const through = walk(sets, frame, [side * 5, mid], [side * 20, mid]);
      expect(through.worstPush).toBeLessThan(1e-9);
      const stub = ruin.breachFrom - 0.6;
      const stopped = walk(sets, frame, [side * 5, stub], [side * 20, stub]);
      expect(side * stopped.end.x).toBeCloseTo(INNER_FACE - R, 4);
    }
  });

  it('slides along a wall instead of sticking to it', () => {
    const sets = [(() => {
      const list: number[] = [];
      partCollider(wall(0, 0.75, 40, 1.5), list);
      return packColliders(list);
    })()];
    let x = -6;
    let z = -2;
    const dx = STEP * Math.SQRT1_2;
    const dz = STEP * Math.SQRT1_2;
    let touching = 0;
    for (let k = 0; k < 200; k++) {
      const next = settle(sets, x + dx, z + dz, R);
      if (next.z < z + dz - 1e-9) touching++;
      expect(next.z).toBeLessThanOrEqual(-R + 1e-5);
      expect(next.x).toBeCloseTo(x + dx, 9);
      x = next.x;
      z = next.z;
    }
    expect(touching).toBeGreaterThan(100);
    expect(x).toBeCloseTo(-6 + 200 * dx, 6);
  });

  it('slides the real player controller along a wall with its velocity kept tangential', () => {
    stubDom();
    const list: number[] = [];
    partCollider(wall(0, 0.75, 60, 1.5), list);
    const sets = [packColliders(list)];
    const canvas = {
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
    } as unknown as HTMLCanvasElement;
    const player = createPlayer({
      canvas,
      heightAt: () => 5,
      initial: { x: -8, z: -2, yaw: (-3 * Math.PI) / 4, pitch: 0 },
      collide: (x, z, radius) => settle(sets, x, z, radius),
    });
    player.drifting = true;
    player.driftInput.forward = 1;
    player.driftInput.stroll = false;
    player.driftInput.run = false;
    const dt = 1 / 60;
    let deepest = -Infinity;
    for (let k = 0; k < 120; k++) {
      player.update(dt);
      deepest = Math.max(deepest, player.pose.z);
    }
    const x0 = player.pose.x;
    for (let k = 0; k < 60; k++) {
      player.update(dt);
      deepest = Math.max(deepest, player.pose.z);
    }
    const along = player.pose.x - x0;
    process.stdout.write(`controller slide: ${along.toFixed(2)} m along the wall in 1 s, speed ${player.speed.toFixed(2)} m/s\n`);
    expect(deepest).toBeLessThanOrEqual(-R + 1e-5);
    expect(player.pose.z).toBeCloseTo(-R, 3);
    expect(along).toBeGreaterThan(1.5);
    expect(player.speed).toBeGreaterThan(1.5);
    player.dispose();
  });
});

describe('prop collisions', () => {
  it('pushes a walker out of every kind of tree trunk and never lets it inside', () => {
    let checked = 0;
    for (let k = 0; k < 400; k++) {
      const x = Math.fround(100 + k * 3.31);
      const z = Math.fround(-40 + (k % 17) * 2.7);
      const scale = Math.fround(0.8 + (k % 7) * 0.1);
      const set = chunkColliders(new Float32Array([x, z, PROP.TREE, scale]), null);
      const solid = treeSolidRadius(treeVariant(x, z), scale);
      const out = settle([set], x + 0.03, z - 0.02, R);
      expect(Math.hypot(out.x - x, out.z - z)).toBeGreaterThanOrEqual(solid + R - 1e-6);
      let px = x - 3;
      let pz = z + 0.4;
      for (let s = 0; s < 120; s++) {
        const to = settle([set], px + STEP, pz, R);
        expect(Math.hypot(to.x - x, to.z - z)).toBeGreaterThanOrEqual(solid + R - 1e-6);
        px = to.x;
        pz = to.z;
      }
      expect(px).toBeGreaterThan(x);
      checked++;
    }
    expect(checked).toBe(400);
  });

  it('blocks on rocks, cairns, stumps, door posts, the keel and the fallen letter, not on stepping stones or cold fires', () => {
    const blocking = [PROP.ROCK, PROP.CAIRN, PROP.STUMPS, PROP.DOOR, PROP.WRECK, PROP.FALLEN];
    for (const kind of blocking) {
      expect(chunkColliders(new Float32Array([500.5, 700.25, kind, 1]), null).count).toBeGreaterThan(0);
    }
    for (const kind of [PROP.STEPPING, PROP.COLD_FIRE]) {
      expect(chunkColliders(new Float32Array([500.5, 700.25, kind, 1]), null).count).toBe(0);
    }
    const door = chunkColliders(new Float32Array([500.5, 700.25, PROP.DOOR, 1]), null);
    expect(door.count).toBe(2);
    const between = settle([door], 500.5, 700.25, R);
    expect(Math.hypot(between.x - 500.5, between.z - 700.25)).toBeLessThan(1e-9);
  });
});

describe('drift', () => {
  it('turns a stalled walker onto a new heading after about a second and a half', () => {
    const player = fakePlayer(0.4);
    const drift = createDrift(player, () => 5);
    for (let t = 0; t < 1.4; t += 0.05) drift.update(0.05);
    expect(player.pose.yaw).toBe(0.4);
    expect(player.driftInput.forward).toBe(1);
    for (let t = 0; t < 0.25; t += 0.05) drift.update(0.05);
    expect(player.driftInput.forward).toBe(0);
    for (let t = 0; t < 4; t += 0.05) {
      drift.update(0.05);
      player.pose.x -= Math.sin(player.pose.yaw) * 1.2 * 0.05 * player.driftInput.forward;
      player.pose.z -= Math.cos(player.pose.yaw) * 1.2 * 0.05 * player.driftInput.forward;
    }
    expect(Math.abs(player.pose.yaw - 0.4)).toBeGreaterThan(0.9);
    expect(player.driftInput.forward).toBe(1);
  });

  it('leaves a walker that keeps moving on its heading', () => {
    const player = fakePlayer(0.4);
    const drift = createDrift(player, () => 5);
    for (let t = 0; t < 12; t += 0.05) {
      drift.update(0.05);
      player.pose.x -= Math.sin(player.pose.yaw) * 1.2 * 0.05 * player.driftInput.forward;
      player.pose.z -= Math.cos(player.pose.yaw) * 1.2 * 0.05 * player.driftInput.forward;
    }
    expect(player.pose.yaw).toBe(0.4);
    expect(player.driftInput.forward).toBe(1);
  });
});

describe('chunk manager collide', () => {
  it('answers from a castle whose landmark lives in the neighbouring chunk', () => {
    const sampler = samplerFor(SEED);
    let found: { castle: Landmark; x: number; z: number } | null = null;
    for (let rz = 0; rz < 20 && found === null; rz++) {
      for (let rx = 0; rx < 20 && found === null; rx++) {
        const castle = landmarkForRegion(SEED, rx, rz, sampler);
        if (castle === null || castle.kind !== 'castle') continue;
        const home = [Math.floor(castle.x / CHUNK_SIZE), Math.floor(castle.z / CHUNK_SIZE)];
        const list: number[] = [];
        landmarkColliders(castle, list);
        for (let o = 0; o < list.length; o += 7) {
          if (list[o] !== 1 || Math.min(list[o + 3], list[o + 4]) < 0.7) continue;
          const x = list[o + 1];
          const z = list[o + 2];
          if (Math.floor(x / CHUNK_SIZE) === home[0] && Math.floor(z / CHUNK_SIZE) === home[1]) continue;
          found = { castle, x, z };
          break;
        }
      }
    }
    expect(found).not.toBeNull();
    if (found === null) return;
    const manager = managerAt(found.castle.x, found.castle.z, 25);
    const neighbour: ChunkData = generateChunk(SEED, Math.floor(found.x / CHUNK_SIZE), Math.floor(found.z / CHUNK_SIZE), sampler);
    expect(neighbour.landmark).toBeNull();
    const alone = settle([chunkColliders(neighbour.props, neighbour.landmark)], found.x, found.z, R);
    expect(Math.hypot(alone.x - found.x, alone.z - found.z)).toBeLessThan(1e-9);
    const pushed = manager.collide(found.x, found.z, R);
    expect(Math.hypot(pushed.x - found.x, pushed.z - found.z)).toBeGreaterThan(0.9);
    const fires = manager.firesNear(found.castle.x, found.castle.z, 40);
    expect(fires.length).toBe(1);
    expect(Math.hypot(fires[0].x - found.castle.x, fires[0].z - found.castle.z)).toBeLessThan(1);
    manager.dispose();
  });

  it('costs well under 0.05 ms per call in the densest forest chunk', () => {
    const sampler = samplerFor(SEED);
    let best: ChunkData | null = null;
    let bestTrees = -1;
    for (let cz = -7; cz <= 7; cz++) {
      for (let cx = -7; cx <= 7; cx++) {
        const chunk = generateChunk(SEED, cx, cz, sampler);
        let trees = 0;
        for (let p = 2; p < chunk.props.length; p += 4) if (chunk.props[p] === PROP.TREE) trees++;
        if (trees > bestTrees) {
          bestTrees = trees;
          best = chunk;
        }
      }
    }
    expect(best).not.toBeNull();
    if (best === null) return;
    const x0 = best.cx * CHUNK_SIZE;
    const z0 = best.cz * CHUNK_SIZE;
    const manager = managerAt(x0 + CHUNK_SIZE / 2, z0 + CHUNK_SIZE / 2, 25);
    const calls = 50000;
    const points = new Float64Array(calls * 2);
    let seed = 1234567;
    for (let i = 0; i < points.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      points[i] = (i % 2 === 0 ? x0 : z0) + (seed / 4294967296) * CHUNK_SIZE;
    }
    let pushed = 0;
    for (let i = 0; i < 5000; i++) manager.collide(points[2 * i], points[2 * i + 1], R);
    const start = performance.now();
    for (let i = 0; i < calls; i++) {
      const x = points[2 * i];
      const z = points[2 * i + 1];
      const out = manager.collide(x, z, R);
      if (out.x !== x || out.z !== z) pushed++;
    }
    const perCall = (performance.now() - start) / calls;
    process.stdout.write(
      `collide: ${(perCall * 1000).toFixed(2)} us per call (${perCall.toFixed(5)} ms) over ${calls} calls, `
      + `chunk ${best.cx},${best.cz} with ${bestTrees} trees, ${((pushed / calls) * 100).toFixed(1)}% of points pushed\n`,
    );
    expect(pushed).toBeGreaterThan(0);
    expect(perCall).toBeLessThan(0.05);
    manager.dispose();
  });
});
