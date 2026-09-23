import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, CHUNK_VERTS, GEN_VERSION, MATERIAL_COUNT, PROP } from '../src/config';
import { generateChunk } from '../src/world/chunk-gen';
import { landmarkForRegion, landmarkInChunk } from '../src/world/landmarks';
import { createSampler } from '../src/world/sampler';
import type { ChunkData } from '../src/world/types';

declare const process: { stdout: { write(text: string): void } };

const SEED = 20260923;
const N = CHUNK_VERTS;

function bytes(view: Float32Array | Uint8Array): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function firstDiff(a: Float32Array | Uint8Array, b: Float32Array | Uint8Array): number {
  const x = bytes(a);
  const y = bytes(b);
  if (x.length !== y.length) return -2;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return i;
  return -1;
}

function expectSameBytes(a: ChunkData, b: ChunkData): void {
  expect(firstDiff(a.heights, b.heights)).toBe(-1);
  expect(firstDiff(a.materials, b.materials)).toBe(-1);
  expect(a.props.length).toBe(b.props.length);
  expect(firstDiff(a.props, b.props)).toBe(-1);
  expect(a.landmark).toEqual(b.landmark);
}

describe('chunk generation', () => {
  it('fills the contracted shapes', () => {
    const chunk = generateChunk(SEED, 3, -2, createSampler(SEED));
    expect(chunk.cx).toBe(3);
    expect(chunk.cz).toBe(-2);
    expect(chunk.genVersion).toBe(GEN_VERSION);
    expect(chunk.heights).toBeInstanceOf(Float32Array);
    expect(chunk.materials).toBeInstanceOf(Uint8Array);
    expect(chunk.props).toBeInstanceOf(Float32Array);
    expect(chunk.heights.length).toBe(N * N);
    expect(chunk.materials.length).toBe(N * N);
    expect(chunk.props.length % 4).toBe(0);
    for (let i = 0; i < chunk.heights.length; i++) {
      expect(Number.isFinite(chunk.heights[i])).toBe(true);
      expect(chunk.materials[i]).toBeLessThan(MATERIAL_COUNT);
    }
  });

  it('repeats byte for byte across calls and across samplers', () => {
    for (const [cx, cz] of [[0, 0], [5, -7], [-12, 31], [104, 208]]) {
      const a = generateChunk(SEED, cx, cz, createSampler(SEED));
      const b = generateChunk(SEED, cx, cz, createSampler(SEED));
      const shared = createSampler(SEED);
      const c = generateChunk(SEED, cx, cz, shared);
      const d = generateChunk(SEED, cx, cz, shared);
      const e = generateChunk(SEED, cx, cz);
      expectSameBytes(a, b);
      expectSameBytes(a, c);
      expectSameBytes(c, d);
      expectSameBytes(a, e);
    }
  });

  it('separates worlds by seed', () => {
    const a = generateChunk(1, 0, 0, createSampler(1));
    const b = generateChunk(2, 0, 0, createSampler(2));
    expect(firstDiff(a.heights, b.heights)).not.toBe(-1);
  });

  it('shares border vertices with its neighbours', () => {
    const sampler = createSampler(SEED);
    for (const [cx, cz] of [[0, 0], [-4, 9], [17, -23]]) {
      const here = generateChunk(SEED, cx, cz, sampler);
      const east = generateChunk(SEED, cx + 1, cz, sampler);
      const south = generateChunk(SEED, cx, cz + 1, sampler);
      for (let j = 0; j < N; j++) {
        expect(here.heights[j * N + (N - 1)]).toBe(east.heights[j * N]);
        expect(here.materials[j * N + (N - 1)]).toBe(east.materials[j * N]);
      }
      for (let i = 0; i < N; i++) {
        expect(here.heights[(N - 1) * N + i]).toBe(south.heights[i]);
        expect(here.materials[(N - 1) * N + i]).toBe(south.materials[i]);
      }
    }
  });

  it('places vertices on the contracted world grid', () => {
    const sampler = createSampler(SEED);
    const cx = 6;
    const cz = -5;
    const chunk = generateChunk(SEED, cx, cz, sampler);
    for (const [i, j] of [[0, 0], [32, 0], [0, 32], [32, 32], [7, 19]]) {
      const x = cx * CHUNK_SIZE + i * 2;
      const z = cz * CHUNK_SIZE + j * 2;
      expect(chunk.heights[j * N + i]).toBeCloseTo(sampler.height(x, z), 3);
    }
  });

  it('keeps props inside the chunk, out of the water and clear of the landmark', () => {
    const sampler = createSampler(SEED);
    let seen = 0;
    for (let cz = -6; cz <= 6; cz++) {
      for (let cx = -6; cx <= 6; cx++) {
        const chunk = generateChunk(SEED, cx, cz, sampler);
        const x0 = cx * CHUNK_SIZE;
        const z0 = cz * CHUNK_SIZE;
        for (let p = 0; p < chunk.props.length; p += 4) {
          const x = chunk.props[p];
          const z = chunk.props[p + 1];
          const kind = chunk.props[p + 2];
          const scale = chunk.props[p + 3];
          expect(x).toBeGreaterThanOrEqual(x0);
          expect(x).toBeLessThan(x0 + CHUNK_SIZE);
          expect(z).toBeGreaterThanOrEqual(z0);
          expect(z).toBeLessThan(z0 + CHUNK_SIZE);
          expect(Number.isInteger(kind)).toBe(true);
          expect(kind).toBeGreaterThanOrEqual(PROP.TREE);
          expect(kind).toBeLessThanOrEqual(PROP.STUMPS);
          if (kind === PROP.TREE) {
            expect(scale).toBeGreaterThanOrEqual(0.8);
            expect(scale).toBeLessThanOrEqual(1.4);
          } else if (kind === PROP.ROCK) {
            expect(scale).toBeGreaterThanOrEqual(0.5);
            expect(scale).toBeLessThanOrEqual(1.5);
          } else {
            expect(scale).toBeGreaterThanOrEqual(0.85);
            expect(scale).toBeLessThanOrEqual(1.2);
          }
          expect(sampler.height(x, z)).toBeGreaterThan(-2);
          if (chunk.landmark) {
            const dx = x - chunk.landmark.x;
            const dz = z - chunk.landmark.z;
            expect(Math.sqrt(dx * dx + dz * dz)).toBeGreaterThanOrEqual(6);
          }
          seen++;
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('generates one chunk well inside the frame budget', () => {
    const sampler = createSampler(SEED);
    for (let i = 0; i < 8; i++) generateChunk(SEED, 900 + i, 900, sampler);

    const runs = 24;
    let worst = 0;
    const start = performance.now();
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      generateChunk(SEED, i, i * 3, sampler);
      const dt = performance.now() - t0;
      if (dt > worst) worst = dt;
    }
    const mean = (performance.now() - start) / runs;
    process.stdout.write(
      `generateChunk: mean ${mean.toFixed(2)} ms, worst ${worst.toFixed(2)} ms over ${runs} chunks\n`,
    );
    expect(mean).toBeLessThan(40);
  });
});

describe('landmarks', () => {
  it('repeats for the same region', () => {
    const sampler = createSampler(SEED);
    for (let rz = -3; rz <= 3; rz++) {
      for (let rx = -3; rx <= 3; rx++) {
        expect(landmarkForRegion(SEED, rx, rz, sampler)).toEqual(
          landmarkForRegion(SEED, rx, rz, createSampler(SEED)),
        );
      }
    }
  });

  it('appears in roughly one region in five', () => {
    const sampler = createSampler(SEED);
    let marks = 0;
    let regions = 0;
    for (let rz = -10; rz < 10; rz++) {
      for (let rx = -10; rx < 10; rx++) {
        regions++;
        if (landmarkForRegion(SEED, rx, rz, sampler)) marks++;
      }
    }
    expect(marks / regions).toBeGreaterThan(0.1);
    expect(marks / regions).toBeLessThan(0.3);
  });

  it('sits above sea level with a valid kind and letter', () => {
    const sampler = createSampler(SEED);
    let checked = 0;
    for (let rz = -8; rz < 8; rz++) {
      for (let rx = -8; rx < 8; rx++) {
        const mark = landmarkForRegion(SEED, rx, rz, sampler);
        if (!mark) continue;
        checked++;
        expect(mark.y).toBeGreaterThan(0);
        expect(mark.y).toBeCloseTo(sampler.height(mark.x, mark.z), 3);
        expect(mark.regionKey).toBe(`${rx},${rz}`);
        expect(Math.abs(mark.x - (rx * 512 + 256))).toBeLessThanOrEqual(100);
        expect(Math.abs(mark.z - (rz * 512 + 256))).toBeLessThanOrEqual(100);
        if (mark.kind === 'letter') expect(mark.letter).toMatch(/^[A-Z]$/);
        else expect(mark.letter).toBeNull();
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('reports the same landmark through the chunk it falls in', () => {
    const sampler = createSampler(SEED);
    let matched = 0;
    for (let rz = -6; rz < 6; rz++) {
      for (let rx = -6; rx < 6; rx++) {
        const mark = landmarkForRegion(SEED, rx, rz, sampler);
        if (!mark) continue;
        const cx = Math.floor(mark.x / CHUNK_SIZE);
        const cz = Math.floor(mark.z / CHUNK_SIZE);
        expect(landmarkInChunk(SEED, cx, cz, sampler)).toEqual(mark);
        expect(generateChunk(SEED, cx, cz, sampler).landmark).toEqual(mark);
        expect(landmarkInChunk(SEED, cx + 3, cz, sampler)).not.toEqual(mark);
        matched++;
      }
    }
    expect(matched).toBeGreaterThan(0);
  });
});
