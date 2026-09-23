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
