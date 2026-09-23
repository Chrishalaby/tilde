import { CHUNK_SIZE, CHUNK_VERTS, GEN_VERSION, MATERIAL, PROP, VERTEX_SPACING } from '../config';
import { materialFor } from './biomes';
import { hash01, mix32 } from './hash';
import { landmarkInChunk } from './landmarks';
import { createSampler } from './sampler';
import type { ChunkData, WorldSampler } from './types';

const EXT = CHUNK_VERTS + 2;
const INV_SPAN = 1 / (2 * VERTEX_SPACING);
const PROP_CELLS = 21;
const PROP_CELL = CHUNK_SIZE / PROP_CELLS;
const TREE_CHANCE_MIN = 0.18;
const TREE_CHANCE_RANGE = 0.44;
const ROCK_CHANCE = 0.04;
const TREE_SCALE_MIN = 0.8;
const TREE_SCALE_RANGE = 0.6;
const ROCK_SCALE_MIN = 0.5;
const ROCK_SCALE_RANGE = 1;
const LANDMARK_CLEARANCE = 6;
const CASTLE_CLEARANCE = 16;

const TRACE_CELLS = 4;
const TRACE_CELL = CHUNK_SIZE / TRACE_CELLS;
const TRACE_EDGE = 0.15;
const TRACE_SPAN = 0.7;
const TRACE_SCALE_MIN = 0.85;
const TRACE_SCALE_RANGE = 0.35;
const TRACE_LAND = 0.5;

export const WRECK_SHALLOW = -1.7;
export const WRECK_SHORE = 1.6;
export const CAIRN_HEIGHT = 70;
export const STUMPS_RADIUS = 6;

const WRECK_CHANCE = 0.1;
const STEPPING_CHANCE = 0.06;
const STEPPING_LOW = -0.2;
const STEPPING_HIGH = 2.6;
const STEPPING_REACH = 20;
const CAIRN_CHANCE = 0.3;
const CAIRN_PROBE = 12;
const CAIRN_CREST = 3;
const STUMPS_CHANCE = 0.02;
const STUMPS_CLEAR = STUMPS_RADIUS + 1;
const DOOR_CHANCE = 0.004;
const FALLEN_CHANCE = 0.004;
const COLD_FIRE_CHANCE = 0.025;

const DIAGONAL = 0.7071067811865476;
const PROBE_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [0, 1], [-1, 0], [0, -1],
  [DIAGONAL, DIAGONAL], [-DIAGONAL, DIAGONAL],
  [-DIAGONAL, -DIAGONAL], [DIAGONAL, -DIAGONAL],
];

const ring = new Float32Array(EXT * EXT);

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

let cachedSeed = 0;
let cachedSampler: WorldSampler | null = null;

function samplerFor(seed: number): WorldSampler {
  if (!cachedSampler || cachedSeed !== seed) {
    cachedSampler = createSampler(seed);
    cachedSeed = seed;
  }
  return cachedSampler;
}

function heightAt(heights: Float32Array, lx: number, lz: number): number {
  const fx = lx / VERTEX_SPACING;
  const fz = lz / VERTEX_SPACING;
  let i = Math.floor(fx);
  let j = Math.floor(fz);
  if (i < 0) i = 0;
  else if (i > CHUNK_VERTS - 2) i = CHUNK_VERTS - 2;
  if (j < 0) j = 0;
  else if (j > CHUNK_VERTS - 2) j = CHUNK_VERTS - 2;
  const tx = fx - i;
  const tz = fz - j;
  const a = heights[j * CHUNK_VERTS + i];
  const b = heights[j * CHUNK_VERTS + i + 1];
  const c = heights[(j + 1) * CHUNK_VERTS + i];
  const d = heights[(j + 1) * CHUNK_VERTS + i + 1];
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

function waterWithin(world: WorldSampler, x: number, z: number, reach: number): boolean {
  for (let d = 0; d < PROBE_DIRS.length; d++) {
    const dir = PROBE_DIRS[d];
    if (world.height(x + dir[0] * reach, z + dir[1] * reach) < 0) return true;
  }
  return false;
}

function isCrest(world: WorldSampler, x: number, z: number): boolean {
  const centre = world.height(x, z);
  let lower = 0;
  for (let d = 0; d < 4; d++) {
    const dir = PROBE_DIRS[d];
    if (world.height(x + dir[0] * CAIRN_PROBE, z + dir[1] * CAIRN_PROBE) < centre) lower++;
  }
  return lower >= CAIRN_CREST;
}

function traceKind(
  world: WorldSampler,
  salt: number,
  ti: number,
  tj: number,
  lx: number,
  lz: number,
  x: number,
  z: number,
  m: number,
  h: number,
): number {
  if (m === MATERIAL.SAND || m === MATERIAL.WATER) {
    if (hash01(salt, ti, tj, 21) < WRECK_CHANCE) {
      const deep = world.height(x, z);
      if (deep > WRECK_SHALLOW && deep < WRECK_SHORE) return PROP.WRECK;
    }
  }
  if (h > STEPPING_LOW && h < STEPPING_HIGH && hash01(salt, ti, tj, 22) < STEPPING_CHANCE) {
    if (waterWithin(world, x, z, STEPPING_REACH)) return PROP.STEPPING;
  }
  if (h > CAIRN_HEIGHT && hash01(salt, ti, tj, 23) < CAIRN_CHANCE && isCrest(world, x, z)) {
    return PROP.CAIRN;
  }
  if (m === MATERIAL.FOREST && hash01(salt, ti, tj, 24) < STUMPS_CHANCE) {
    const inset = STUMPS_CLEAR;
    const fits = lx > inset && lx < CHUNK_SIZE - inset && lz > inset && lz < CHUNK_SIZE - inset;
    if (fits) return PROP.STUMPS;
  }
  if (h <= TRACE_LAND || m === MATERIAL.WATER) return -1;
  if (m === MATERIAL.GRASS && hash01(salt, ti, tj, 25) < DOOR_CHANCE) return PROP.DOOR;
  if (hash01(salt, ti, tj, 26) < FALLEN_CHANCE) return PROP.FALLEN;
  if (m === MATERIAL.GRASS || m === MATERIAL.SAND) {
    if (hash01(salt, ti, tj, 27) < COLD_FIRE_CHANCE) return PROP.COLD_FIRE;
  }
  return -1;
}

export function generateChunk(
  seed: number,
  cx: number,
  cz: number,
  sampler?: WorldSampler,
): ChunkData {
  const world = sampler ?? samplerFor(seed);
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;

  for (let j = 0; j < EXT; j++) {
    const z = z0 + (j - 1) * VERTEX_SPACING;
    const row = j * EXT;
    for (let i = 0; i < EXT; i++) {
      ring[row + i] = world.height(x0 + (i - 1) * VERTEX_SPACING, z);
    }
  }

  const heights = new Float32Array(CHUNK_VERTS * CHUNK_VERTS);
  const materials = new Uint8Array(CHUNK_VERTS * CHUNK_VERTS);

  for (let j = 0; j < CHUNK_VERTS; j++) {
    const z = z0 + j * VERTEX_SPACING;
    const out = j * CHUNK_VERTS;
    const mid = (j + 1) * EXT + 1;
    const up = j * EXT + 1;
    const down = (j + 2) * EXT + 1;
    for (let i = 0; i < CHUNK_VERTS; i++) {
      const x = x0 + i * VERTEX_SPACING;
      const h = ring[mid + i];
      const dx = (ring[mid + i + 1] - ring[mid + i - 1]) * INV_SPAN;
      const dz = (ring[down + i] - ring[up + i]) * INV_SPAN;
      heights[out + i] = h;
      materials[out + i] = materialFor(
        h,
        Math.sqrt(dx * dx + dz * dz),
        world.moisture(x, z),
        world.temperature(x, z),
      );
    }
  }

  const landmark = landmarkInChunk(seed, cx, cz, world);
  const reach = landmark !== null && landmark.kind === 'castle'
    ? CASTLE_CLEARANCE
    : LANDMARK_CLEARANCE;
  const clearance = reach * reach;
  const salt = mix32(seed, cx, cz, 5);
  const list: number[] = [];
  const clearings: number[] = [];

  for (let tj = 0; tj < TRACE_CELLS; tj++) {
    for (let ti = 0; ti < TRACE_CELLS; ti++) {
      const lx = (ti + TRACE_EDGE + TRACE_SPAN * hash01(salt, ti, tj, 11)) * TRACE_CELL;
      const lz = (tj + TRACE_EDGE + TRACE_SPAN * hash01(salt, ti, tj, 12)) * TRACE_CELL;
      const x = x0 + lx;
      const z = z0 + lz;
      if (landmark) {
        const ox = x - landmark.x;
        const oz = z - landmark.z;
        if (ox * ox + oz * oz < clearance) continue;
      }
      const vi = Math.min(CHUNK_VERTS - 1, Math.round(lx / VERTEX_SPACING));
      const vj = Math.min(CHUNK_VERTS - 1, Math.round(lz / VERTEX_SPACING));
      const m = materials[vj * CHUNK_VERTS + vi];
      const h = heightAt(heights, lx, lz);
      const kind = traceKind(world, salt, ti, tj, lx, lz, x, z, m, h);
      if (kind < 0) continue;
      const scale = TRACE_SCALE_MIN + hash01(salt, ti, tj, 13) * TRACE_SCALE_RANGE;
      list.push(x, z, kind, scale);
      if (kind === PROP.STUMPS) clearings.push(x, z);
    }
  }

  for (let gj = 0; gj < PROP_CELLS; gj++) {
    const vj = Math.min(CHUNK_VERTS - 1, Math.round(((gj + 0.5) * PROP_CELL) / VERTEX_SPACING));
    for (let gi = 0; gi < PROP_CELLS; gi++) {
      const vi = Math.min(CHUNK_VERTS - 1, Math.round(((gi + 0.5) * PROP_CELL) / VERTEX_SPACING));
      const m = materials[vj * CHUNK_VERTS + vi];
      let kind: number;
      let chance: number;
      if (m === MATERIAL.FOREST) {
        kind = PROP.TREE;
        const wet = world.moisture(x0 + (gi + 0.5) * PROP_CELL, z0 + (gj + 0.5) * PROP_CELL);
        chance = TREE_CHANCE_MIN + TREE_CHANCE_RANGE * smoothstep(0.12, 0.4, wet);
      } else if (m === MATERIAL.STONE) {
        kind = PROP.ROCK;
        chance = ROCK_CHANCE;
      } else {
        continue;
      }
      if (hash01(salt, gi, gj, 1) >= chance) continue;

      const lx = (gi + hash01(salt, gi, gj, 2)) * PROP_CELL;
      const lz = (gj + hash01(salt, gi, gj, 3)) * PROP_CELL;
      if (heightAt(heights, lx, lz) <= 0) continue;

      const x = x0 + lx;
      const z = z0 + lz;
      if (landmark) {
        const ox = x - landmark.x;
        const oz = z - landmark.z;
        if (ox * ox + oz * oz < clearance) continue;
      }
      let cleared = false;
      for (let c = 0; c < clearings.length; c += 2) {
        const ox = x - clearings[c];
        const oz = z - clearings[c + 1];
        if (ox * ox + oz * oz < STUMPS_CLEAR * STUMPS_CLEAR) {
          cleared = true;
          break;
        }
      }
      if (cleared) continue;

      const r = hash01(salt, gi, gj, 4);
      const scale = kind === PROP.TREE
        ? TREE_SCALE_MIN + r * TREE_SCALE_RANGE
        : ROCK_SCALE_MIN + r * ROCK_SCALE_RANGE;
      list.push(x, z, kind, scale);
    }
  }

  return {
    cx,
    cz,
    genVersion: GEN_VERSION,
    heights,
    materials,
    props: new Float32Array(list),
    landmark,
  };
}
