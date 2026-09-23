import { InterleavedBufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, CHUNK_VERTS, REGION_SIZE } from '../src/config';
import { buildTerrainGeometry, createTerrainMaterial } from '../src/render/terrain-mesh';
import { CASTLE_CLEARANCE, ROAD_CLEARANCE, generateChunk } from '../src/world/chunk-gen';
import { landmarkForRegion } from '../src/world/landmarks';
import { castleGate } from '../src/world/structures';
import {
  CASTLE_KEEP,
  MAIN_HALF_WIDTH,
  PATH_HALF_WIDTH,
  ROAD_CHANNELS,
  ROAD_FAR,
  ROAD_LENGTH,
  ROAD_MAX_SLOPE,
  ROAD_MIN_HEIGHT,
  ROAD_PRESENT,
  ROAD_SLOPE_GRID,
  ROAD_SLOPE_REACH,
  ROAD_STRIDE,
  SPUR_HALF_WIDTH,
  regionRoads,
  roadEdge,
} from '../src/world/roads';
import { createSampler } from '../src/world/sampler';
import type { ChunkData, Landmark, WorldSampler } from '../src/world/types';

declare const process: { stdout: { write(text: string): void } };

const SEED = 20260923;
const N = CHUNK_VERTS;
const SWEEPS: ReadonlyArray<readonly [number, number]> = [[-12, -12], [40, 40], [-60, 25]];
const SWEEP = 12;

function bytes(view: Float32Array): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function sameBytes(a: Float32Array, b: Float32Array): boolean {
  const x = bytes(a);
  const y = bytes(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

function roadsOf(chunk: ChunkData): Float32Array {
  expect(chunk.roads).toBeInstanceOf(Float32Array);
  return chunk.roads as Float32Array;
}

function channel(roads: Float32Array, v: number, c: number): number {
  return roads[ROAD_STRIDE + v * ROAD_CHANNELS + c];
}

function probeSlope(world: WorldSampler, x: number, z: number): number {
  const r = ROAD_SLOPE_REACH;
  const gx = (Math.fround(world.height(x + r, z)) - Math.fround(world.height(x - r, z))) / (2 * r);
  const gz = (Math.fround(world.height(x, z + r)) - Math.fround(world.height(x, z - r))) / (2 * r);
  return Math.sqrt(gx * gx + gz * gz);
}

function roadScaleSlope(world: WorldSampler, x: number, z: number): number {
  const g = ROAD_SLOPE_GRID;
  const ax = Math.floor(x / g) * g;
  const az = Math.floor(z / g) * g;
  const tx = (x - ax) / g;
  const tz = (z - az) / g;
  const low = probeSlope(world, ax, az) * (1 - tx) + probeSlope(world, ax + g, az) * tx;
  const high = probeSlope(world, ax, az + g) * (1 - tx) + probeSlope(world, ax + g, az + g) * tx;
  return low * (1 - tz) + high * tz;
}

function* sweepChunks(world: WorldSampler): Generator<ChunkData> {
  for (const [ax, az] of SWEEPS) {
    for (let cz = az; cz < az + SWEEP; cz++) {
      for (let cx = ax; cx < ax + SWEEP; cx++) yield generateChunk(SEED, cx, cz, world);
    }
  }
}

describe('roads', () => {
  it('carries one edge distance and six lane values per vertex', () => {
    const chunk = generateChunk(SEED, 3, -2, createSampler(SEED));
    const roads = roadsOf(chunk);
    expect(roads.length).toBe(ROAD_LENGTH);
    expect(ROAD_LENGTH).toBe(N * N * (1 + ROAD_CHANNELS));
    for (let i = 0; i < roads.length; i++) expect(Number.isFinite(roads[i])).toBe(true);
    for (let v = 0; v < N * N; v++) {
      expect(roads[v]).toBeLessThanOrEqual(ROAD_FAR);
      expect(channel(roads, v, 1)).toBeGreaterThanOrEqual(0);
      expect(channel(roads, v, 1)).toBeLessThanOrEqual(MAIN_HALF_WIDTH);
      expect(channel(roads, v, 3)).toBeLessThanOrEqual(PATH_HALF_WIDTH);
      expect(channel(roads, v, 5)).toBeLessThanOrEqual(SPUR_HALF_WIDTH);
    }
  });

  it('repeats road bytes across calls, samplers and generation order', () => {
    for (const [cx, cz] of [[0, 0], [5, -7], [-12, 31], [104, 208], [7, 8]]) {
      const cold = generateChunk(SEED, cx, cz, createSampler(SEED));
      const warmed = createSampler(SEED);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) generateChunk(SEED, cx + dx, cz + dz, warmed);
      }
      const warm = generateChunk(SEED, cx, cz, warmed);
      const cached = generateChunk(SEED, cx, cz);
      expect(sameBytes(roadsOf(cold), roadsOf(warm))).toBe(true);
      expect(sameBytes(roadsOf(cold), roadsOf(cached))).toBe(true);
    }
  });

  it('separates road networks by seed', () => {
    const a = roadsOf(generateChunk(1, 0, 0, createSampler(1)));
    const b = roadsOf(generateChunk(2, 0, 0, createSampler(2)));
    expect(sameBytes(a, b)).toBe(false);
  });

  it('agrees with its neighbours on every shared border value', () => {
    const world = createSampler(SEED);
    let checked = 0;
    for (const [cx, cz] of [[0, 0], [-4, 9], [17, -23], [7, 7], [-1, -1], [23, 15]]) {
      const here = roadsOf(generateChunk(SEED, cx, cz, world));
      const east = roadsOf(generateChunk(SEED, cx + 1, cz, world));
      const south = roadsOf(generateChunk(SEED, cx, cz + 1, world));
      for (let k = 0; k < N; k++) {
        const eastEdge = k * N + (N - 1);
        const westEdge = k * N;
        const southEdge = (N - 1) * N + k;
        const northEdge = k;
        expect(here[eastEdge]).toBe(east[westEdge]);
        expect(here[southEdge]).toBe(south[northEdge]);
        for (let c = 0; c < ROAD_CHANNELS; c++) {
          expect(channel(here, eastEdge, c)).toBe(channel(east, westEdge, c));
          expect(channel(here, southEdge, c)).toBe(channel(south, northEdge, c));
        }
        checked += 2;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('agrees across region borders beside every spur', () => {
    const world = createSampler(SEED);
    const per = REGION_SIZE / CHUNK_SIZE;
    let pairs = 0;
    for (let rz = -12; rz < 12; rz++) {
      for (let rx = -12; rx < 12; rx++) {
        const spur = regionRoads(SEED, rx, rz, world).spur;
        if (spur === null) continue;
        const ex = spur.x + spur.dx * spur.length;
        const ez = spur.z + spur.dz * spur.length;
        const row = Math.min(rz * per + per - 1, Math.max(rz * per, Math.floor(ez / CHUNK_SIZE)));
        const col = Math.min(rx * per + per - 1, Math.max(rx * per, Math.floor(ex / CHUNK_SIZE)));
        const seams: Array<[number, number, boolean]> = [
          [rx * per - 1, row, true],
          [rx * per + per - 1, row, true],
          [col, rz * per - 1, false],
          [col, rz * per + per - 1, false],
        ];
        for (const [cx, cz, eastward] of seams) {
          const here = roadsOf(generateChunk(SEED, cx, cz, world));
          const next = roadsOf(generateChunk(SEED, eastward ? cx + 1 : cx, eastward ? cz : cz + 1, world));
          for (let k = 0; k < N; k++) {
            const a = eastward ? k * N + (N - 1) : (N - 1) * N + k;
            const b = eastward ? k * N : k;
            expect(here[a]).toBe(next[b]);
            for (let c = 0; c < ROAD_CHANNELS; c++) expect(channel(here, a, c)).toBe(channel(next, b, c));
          }
          pairs++;
        }
      }
    }
    expect(pairs).toBeGreaterThan(0);
  });

  it('keeps roads off water and steep ground', () => {
    const world = createSampler(SEED);
    let onRoad = 0;
    let shore = 0;
    let bumpy = 0;
    for (const chunk of sweepChunks(world)) {
      const roads = roadsOf(chunk);
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const v = j * N + i;
          const h = chunk.heights[v];
          if (h < ROAD_MIN_HEIGHT) {
            expect(roads[v]).toBeGreaterThan(0);
            for (let c = 1; c < ROAD_CHANNELS; c += 2) expect(channel(roads, v, c)).toBe(0);
          }
          if (roads[v] >= 0) continue;
          onRoad++;
          const x = chunk.cx * CHUNK_SIZE + i * 2;
          const z = chunk.cz * CHUNK_SIZE + j * 2;
          expect(h).toBeGreaterThanOrEqual(ROAD_MIN_HEIGHT);
          expect(roadScaleSlope(world, x, z)).toBeLessThan(ROAD_MAX_SLOPE + 1e-6);
          if (probeSlope(world, x, z) > ROAD_MAX_SLOPE + 0.1) bumpy++;
          if (h < 1.3) shore++;
        }
      }
    }
    process.stdout.write(
      `road vertices ${onRoad}: ${shore} taper toward a shore, `
      + `${((bumpy / onRoad) * 100).toFixed(1)}% sit where a single 32 m probe reads steeper than ${ROAD_MAX_SLOPE + 0.1}\n`,
    );
    expect(onRoad).toBeGreaterThan(0);
    expect(shore).toBeGreaterThan(0);
  });

  it('keeps trees, rocks and traces off the roads', () => {
    const world = createSampler(SEED);
    let props = 0;
    let nearest = Infinity;
    for (const chunk of sweepChunks(world)) {
      const roads = roadsOf(chunk);
      for (let p = 0; p < chunk.props.length; p += 4) {
        const lx = chunk.props[p] - chunk.cx * CHUNK_SIZE;
        const lz = chunk.props[p + 1] - chunk.cz * CHUNK_SIZE;
        const edge = roadEdge(roads, lx, lz);
        expect(edge).toBeGreaterThanOrEqual(ROAD_CLEARANCE);
        if (edge < nearest) nearest = edge;
        props++;
      }
    }
    process.stdout.write(`${props} props, nearest sits ${nearest.toFixed(2)} m from a road edge\n`);
    expect(props).toBeGreaterThan(0);
  });

  it('reads the stored edge distance back at the vertices', () => {
    const world = createSampler(SEED);
    for (const [cx, cz] of [[0, 0], [-7, 3], [12, -5]]) {
      const roads = roadsOf(generateChunk(SEED, cx, cz, world));
      for (let j = 0; j < N; j += 3) {
        for (let i = 0; i < N; i += 3) {
          expect(roadEdge(roads, i * 2, j * 2)).toBeCloseTo(roads[j * N + i], 4);
        }
      }
    }
  });

  it('covers a sensible fraction of the land', () => {
    const world = createSampler(SEED);
    let land = 0;
    let legal = 0;
    let road = 0;
    let main = 0;
    let path = 0;
    let spur = 0;
    let chunks = 0;
    for (const chunk of sweepChunks(world)) {
      chunks++;
      const roads = roadsOf(chunk);
      for (let j = 0; j < N - 1; j++) {
        for (let i = 0; i < N - 1; i++) {
          const v = j * N + i;
          if (chunk.heights[v] < ROAD_MIN_HEIGHT) continue;
          land++;
          if (channel(roads, v, 1) >= MAIN_HALF_WIDTH * 0.999) legal++;
          if (roads[v] < 0) road++;
          for (let c = 0; c < ROAD_CHANNELS; c += 2) {
            const w = channel(roads, v, c + 1);
            if (w <= ROAD_PRESENT || Math.abs(channel(roads, v, c)) >= w) continue;
            if (c === 0) main++;
            else if (c === 2) path++;
            else spur++;
          }
        }
      }
    }
    const pct = (n: number, of: number): string => `${((n / of) * 100).toFixed(2)}%`;
    process.stdout.write(
      `roads over ${chunks} chunks (${((chunks * CHUNK_SIZE * CHUNK_SIZE) / 1e6).toFixed(1)} km2): `
      + `${pct(road, land)} of land (tracks ${pct(main, land)}, footpaths ${pct(path, land)}, spurs ${pct(spur, land)}), `
      + `${pct(road, legal)} of ground gentle enough for a road\n`,
    );
    expect(main).toBeGreaterThan(0);
    expect(path).toBeGreaterThan(0);
    expect(road / land).toBeGreaterThan(0.008);
    expect(road / land).toBeLessThan(0.06);
  });

  it('clears trees and rocks for 24 m around every castle, across chunk borders', () => {
    const world = createSampler(SEED);
    const castles: Landmark[] = [];
    for (let rz = -10; rz < 10 && castles.length < 6; rz++) {
      for (let rx = -10; rx < 10 && castles.length < 6; rx++) {
        const mark = landmarkForRegion(SEED, rx, rz, world);
        if (mark && mark.kind === 'castle') castles.push(mark);
      }
    }
    expect(castles.length).toBeGreaterThan(0);
    expect(CASTLE_CLEARANCE).toBe(24);
    let near = 0;
    for (const castle of castles) {
      const ccx = Math.floor(castle.x / CHUNK_SIZE);
      const ccz = Math.floor(castle.z / CHUNK_SIZE);
      for (let cz = ccz - 1; cz <= ccz + 1; cz++) {
        for (let cx = ccx - 1; cx <= ccx + 1; cx++) {
          const chunk = generateChunk(SEED, cx, cz, world);
          for (let p = 0; p < chunk.props.length; p += 4) {
            const dx = chunk.props[p] - castle.x;
            const dz = chunk.props[p + 1] - castle.z;
            const d = Math.sqrt(dx * dx + dz * dz);
            expect(d).toBeGreaterThanOrEqual(CASTLE_CLEARANCE);
            if (d < CASTLE_CLEARANCE + 16) near++;
          }
        }
      }
    }
    process.stdout.write(`${castles.length} castles checked, ${near} props just outside their clearance\n`);
    expect(near).toBeGreaterThan(0);
  });

  it('stops tracks and footpaths at castle walls', () => {
    const world = createSampler(SEED);
    let inside = 0;
    for (let rz = -10; rz < 10; rz++) {
      for (let rx = -10; rx < 10; rx++) {
        const castle = landmarkForRegion(SEED, rx, rz, world);
        if (!castle || castle.kind !== 'castle') continue;
        const ccx = Math.floor(castle.x / CHUNK_SIZE);
        const ccz = Math.floor(castle.z / CHUNK_SIZE);
        for (let cz = ccz - 1; cz <= ccz + 1; cz++) {
          for (let cx = ccx - 1; cx <= ccx + 1; cx++) {
            const roads = roadsOf(generateChunk(SEED, cx, cz, world));
            for (let j = 0; j < N; j++) {
              for (let i = 0; i < N; i++) {
                const dx = cx * CHUNK_SIZE + i * 2 - castle.x;
                const dz = cz * CHUNK_SIZE + j * 2 - castle.z;
                if (dx * dx + dz * dz >= CASTLE_KEEP * CASTLE_KEEP) continue;
                const v = j * N + i;
                expect(channel(roads, v, 1)).toBe(0);
                expect(channel(roads, v, 3)).toBe(0);
                inside++;
              }
            }
          }
        }
      }
    }
    expect(inside).toBeGreaterThan(0);
  });

  it('runs spurs from landmarks down onto a main track', () => {
    const world = createSampler(SEED);
    let spurs = 0;
    for (let rz = -12; rz < 12; rz++) {
      for (let rx = -12; rx < 12; rx++) {
        const region = regionRoads(SEED, rx, rz, world);
        const spur = region.spur;
        if (spur === null || region.home === null) continue;
        spurs++;
        if (region.home.kind === 'castle') {
          const gate = castleGate(region.home);
          expect(spur.x).toBeCloseTo(gate.x, 6);
          expect(spur.z).toBeCloseTo(gate.z, 6);
          expect(spur.dx * gate.dx + spur.dz * gate.dz).toBeGreaterThan(0.3);
        } else {
          expect(spur.x).toBe(region.home.x);
          expect(spur.z).toBe(region.home.z);
        }
        const ex = spur.x + spur.dx * spur.length;
        const ez = spur.z + spur.dz * spur.length;
        expect(Math.floor(ex / REGION_SIZE)).toBe(rx);
        expect(Math.floor(ez / REGION_SIZE)).toBe(rz);
        const cx = Math.floor(ex / CHUNK_SIZE);
        const cz = Math.floor(ez / CHUNK_SIZE);
        const roads = roadsOf(generateChunk(SEED, cx, cz, world));
        const lx = (ex - cx * CHUNK_SIZE) / 2;
        const lz = (ez - cz * CHUNK_SIZE) / 2;
        const v = Math.min(N - 1, Math.round(lz)) * N + Math.min(N - 1, Math.round(lx));
        expect(Math.abs(channel(roads, v, 0))).toBeLessThan(2);
        expect(roadEdge(roads, ex - cx * CHUNK_SIZE, ez - cz * CHUNK_SIZE)).toBeLessThan(0);
      }
    }
    process.stdout.write(`${spurs} landmark spurs in 24 x 24 regions\n`);
    expect(spurs).toBeGreaterThan(0);
  });

  it('hands the lanes to the terrain mesh as interpolated attributes', () => {
    const chunk = generateChunk(SEED, 0, 0, createSampler(SEED));
    const roads = roadsOf(chunk);
    const geometry = buildTerrainGeometry(chunk);
    const names = ['roadMain', 'roadPath', 'roadSpur'];
    for (let a = 0; a < names.length; a++) {
      const attribute = geometry.getAttribute(names[a]) as InterleavedBufferAttribute;
      expect(attribute.itemSize).toBe(2);
      expect(attribute.count).toBe(N * N);
      for (const v of [0, 17, N * N - 1]) {
        expect(attribute.getX(v)).toBe(channel(roads, v, a * 2));
        expect(attribute.getY(v)).toBe(channel(roads, v, a * 2 + 1));
      }
    }
    const bare = buildTerrainGeometry({ ...chunk, roads: undefined });
    expect(bare.getAttribute('roadMain').getY(5)).toBe(0);
    const material = createTerrainMaterial();
    const defaults = material.defaultAttributeValues as unknown as Record<string, number[]>;
    for (const name of names) expect(defaults[name]).toEqual([0, 0]);
    geometry.dispose();
    bare.dispose();
    material.dispose();
  });

  it('generates a chunk with its roads well inside the frame budget', () => {
    const world = createSampler(SEED);
    for (let i = 0; i < 16; i++) generateChunk(SEED, 700 + i, -700, world);
    const runs = 64;
    let worst = 0;
    const start = performance.now();
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      generateChunk(SEED, 300 + (i % 8), 300 + Math.floor(i / 8), world);
      const dt = performance.now() - t0;
      if (dt > worst) worst = dt;
    }
    const mean = (performance.now() - start) / runs;
    process.stdout.write(
      `generateChunk with roads: mean ${mean.toFixed(2)} ms, worst ${worst.toFixed(2)} ms over ${runs} chunks\n`,
    );
    expect(mean).toBeLessThan(10);
  });
});
