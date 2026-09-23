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
  ['letter', 0.52],
  ['castle', 0.1],
  ['ring', 0.12],
  ['tree', 0.1],
  ['pool', 0.08],
  ['shelter', 0.08],
];

const FLAT_RADII = [7, 14];
const FLAT_SPREAD = 4;
const FLAT_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [0.7071067811865476, 0.7071067811865476],
  [0, 1], [-0.7071067811865476, 0.7071067811865476],
  [-1, 0], [-0.7071067811865476, -0.7071067811865476],
  [0, -1], [0.7071067811865476, -0.7071067811865476],
];

function kindFor(roll: number): LandmarkKind {
  let acc = 0;
  for (let i = 0; i < KIND_WEIGHTS.length; i++) {
    acc += KIND_WEIGHTS[i][1];
    if (roll < acc) return KIND_WEIGHTS[i][0];
  }
  return 'shelter';
}

function flatEnough(sampler: WorldSampler, x: number, z: number, centre: number): boolean {
  let low = centre;
  let high = centre;
  for (let r = 0; r < FLAT_RADII.length; r++) {
    const radius = FLAT_RADII[r];
    for (let d = 0; d < FLAT_DIRS.length; d++) {
      const dir = FLAT_DIRS[d];
      const y = sampler.height(x + dir[0] * radius, z + dir[1] * radius);
      if (y < low) low = y;
      else if (y > high) high = y;
      if (high - low > FLAT_SPREAD) return false;
    }
  }
  return true;
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

  let kind = kindFor(hash01(seed, rx, rz, 9));
  const wantsFlat = kind === 'castle';

  const centreX = rx * REGION_SIZE + REGION_SIZE / 2;
  const centreZ = rz * REGION_SIZE + REGION_SIZE / 2;
  const half = (SEARCH_STEPS - 1) / 2;

  let bestX = 0;
  let bestZ = 0;
  let bestY = 0;
  let found = false;
  let flatX = 0;
  let flatZ = 0;
  let flatY = 0;
  let flat = false;

  for (let j = 0; j < SEARCH_STEPS; j++) {
    const z = centreZ + (j - half) * SEARCH_SPACING;
    for (let i = 0; i < SEARCH_STEPS; i++) {
      const x = centreX + (i - half) * SEARCH_SPACING;
      const y = sampler.height(x, z);
      if (y <= 0) continue;
      const better = !found || y > bestY;
      const betterFlat = wantsFlat && (!flat || y > flatY);
      if (!better && !betterFlat) continue;
      if (slopeAt(sampler, x, z) > STONE_SLOPE) continue;
      if (better) {
        bestX = x;
        bestZ = z;
        bestY = y;
        found = true;
      }
      if (betterFlat && flatEnough(sampler, x, z, y)) {
        flatX = x;
        flatZ = z;
        flatY = y;
        flat = true;
      }
    }
  }

  if (wantsFlat && !flat) kind = 'letter';
  const useFlat = kind === 'castle';
  if (!useFlat && !found) return null;
  const letter = kind === 'letter'
    ? String.fromCharCode(65 + (mix32(seed, rx, rz, 11) % 26))
    : null;
  return {
    kind,
    letter,
    x: useFlat ? flatX : bestX,
    z: useFlat ? flatZ : bestZ,
    y: useFlat ? flatY : bestY,
    regionKey: regionKey(rx, rz),
  };
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
