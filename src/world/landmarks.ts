import { CHUNK_SIZE, REGION_SIZE } from '../config';
import { hash01, mix32 } from './hash';
import { regionKey } from './types';
import type { Landmark, LandmarkKind, WorldSampler } from './types';

const LANDMARK_CHANCE = 1 / 9;
const SEARCH_STEPS = 9;
const SEARCH_SPACING = 25;
const STONE_SLOPE = 0.85;
const PROBE = 2;

const KIND_WEIGHTS: ReadonlyArray<readonly [LandmarkKind, number]> = [
  ['letter', 0.6],
  ['ring', 0.12],
  ['tree', 0.12],
  ['pool', 0.08],
  ['shelter', 0.08],
];

function kindFor(roll: number): LandmarkKind {
  let acc = 0;
  for (let i = 0; i < KIND_WEIGHTS.length; i++) {
    acc += KIND_WEIGHTS[i][1];
    if (roll < acc) return KIND_WEIGHTS[i][0];
  }
  return 'shelter';
}

function slopeAt(sampler: WorldSampler, x: number, z: number): number {
  const dx = (sampler.height(x + PROBE, z) - sampler.height(x - PROBE, z)) / (2 * PROBE);
  const dz = (sampler.height(x, z + PROBE) - sampler.height(x, z - PROBE)) / (2 * PROBE);
  return Math.sqrt(dx * dx + dz * dz);
}

export function landmarkForRegion(
  seed: number,
  rx: number,
  rz: number,
  sampler: WorldSampler,
): Landmark | null {
  if (hash01(seed, rx, rz, 7) >= LANDMARK_CHANCE) return null;

  const kind = kindFor(hash01(seed, rx, rz, 9));
  const letter = kind === 'letter'
    ? String.fromCharCode(65 + (mix32(seed, rx, rz, 11) % 26))
    : null;

  const centreX = rx * REGION_SIZE + REGION_SIZE / 2;
  const centreZ = rz * REGION_SIZE + REGION_SIZE / 2;
  const half = (SEARCH_STEPS - 1) / 2;

  let bestX = 0;
  let bestZ = 0;
  let bestY = 0;
  let found = false;

  for (let j = 0; j < SEARCH_STEPS; j++) {
    const z = centreZ + (j - half) * SEARCH_SPACING;
    for (let i = 0; i < SEARCH_STEPS; i++) {
      const x = centreX + (i - half) * SEARCH_SPACING;
      const y = sampler.height(x, z);
      if (y <= 0) continue;
      if (found && y <= bestY) continue;
      if (slopeAt(sampler, x, z) > STONE_SLOPE) continue;
      bestX = x;
      bestZ = z;
      bestY = y;
      found = true;
    }
  }

  if (!found) return null;
  return { kind, letter, x: bestX, z: bestZ, y: bestY, regionKey: regionKey(rx, rz) };
}

export function landmarkInChunk(
  seed: number,
  cx: number,
  cz: number,
  sampler: WorldSampler,
): Landmark | null {
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  const x1 = x0 + CHUNK_SIZE;
  const z1 = z0 + CHUNK_SIZE;
  const reach = ((SEARCH_STEPS - 1) / 2) * SEARCH_SPACING;

  const rx0 = Math.floor((x0 - reach) / REGION_SIZE);
  const rx1 = Math.floor((x1 + reach) / REGION_SIZE);
  const rz0 = Math.floor((z0 - reach) / REGION_SIZE);
  const rz1 = Math.floor((z1 + reach) / REGION_SIZE);

  for (let rz = rz0; rz <= rz1; rz++) {
    for (let rx = rx0; rx <= rx1; rx++) {
      const mark = landmarkForRegion(seed, rx, rz, sampler);
      if (!mark) continue;
      if (mark.x < x0 || mark.x >= x1) continue;
      if (mark.z < z0 || mark.z >= z1) continue;
      return mark;
    }
  }
  return null;
}
