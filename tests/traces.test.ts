import { InstancedMesh, Matrix4, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, CHUNK_VERTS, MATERIAL, PROP } from '../src/config';
import type { GlyphAtlas } from '../src/render/glyph-atlas';
import { buildProps } from '../src/render/props';
import { CAIRN_HEIGHT, WRECK_SHALLOW, WRECK_SHORE, generateChunk } from '../src/world/chunk-gen';
import { createSampler } from '../src/world/sampler';
import type { ChunkData } from '../src/world/types';

declare const process: { stdout: { write(text: string): void } };

const SEED = 20260923;
const SWEEP = 32;
const SIGHT = 60;
const MIN_METRES = 150;
const MAX_METRES = 500;

const TRACE_KINDS: ReadonlyArray<readonly [string, number]> = [
  ['wreck', PROP.WRECK],
  ['cairn', PROP.CAIRN],
  ['cold fire', PROP.COLD_FIRE],
  ['fallen', PROP.FALLEN],
  ['stepping', PROP.STEPPING],
  ['door', PROP.DOOR],
  ['stumps', PROP.STUMPS],
];

const ATLAS = {
  index: new Map<string, number>([['A', 1], ['B', 2], ['C', 3]]),
} as unknown as GlyphAtlas;

function isTrace(kind: number): boolean {
  return kind !== PROP.TREE && kind !== PROP.ROCK;
}

function materialAt(chunk: ChunkData, x: number, z: number): number {
  const lx = x - chunk.cx * CHUNK_SIZE;
  const lz = z - chunk.cz * CHUNK_SIZE;
  const i = Math.min(CHUNK_VERTS - 1, Math.max(0, Math.round(lx / 2)));
  const j = Math.min(CHUNK_VERTS - 1, Math.max(0, Math.round(lz / 2)));
  return chunk.materials[j * CHUNK_VERTS + i];
}

function sweep(): { counts: Map<number, number>; chunks: number } {
  const sampler = createSampler(SEED);
  const counts = new Map<number, number>();
  const half = SWEEP / 2;
  for (let cz = -half; cz < half; cz++) {
    for (let cx = -half; cx < half; cx++) {
      const chunk = generateChunk(SEED, cx, cz, sampler);
      for (let p = 0; p < chunk.props.length; p += 4) {
        const kind = chunk.props[p + 2];
        if (!isTrace(kind)) continue;
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
      }
    }
  }
  return { counts, chunks: SWEEP * SWEEP };
}

describe('traces', () => {
  it('scatters every kind at a findable density', () => {
    const { counts, chunks } = sweep();
    const area = chunks * CHUNK_SIZE * CHUNK_SIZE;
    let total = 0;
    const lines: string[] = [];
    for (const [name, kind] of TRACE_KINDS) {
      const n = counts.get(kind) ?? 0;
      total += n;
      lines.push(`  ${name.padEnd(10)} ${String(n).padStart(5)}`);
    }
    const metres = area / (total * SIGHT);
    process.stdout.write(
      `traces over ${(Math.sqrt(area) / 1000).toFixed(2)} km square, ${chunks} chunks:\n`
      + `${lines.join('\n')}\n`
      + `  ${'total'.padEnd(10)} ${String(total).padStart(5)}`
      + `  (one per ${metres.toFixed(0)} m walked, ${SIGHT} m corridor)\n`,
    );
    for (const [, kind] of TRACE_KINDS) expect(counts.get(kind) ?? 0).toBeGreaterThan(0);
    expect(metres).toBeGreaterThan(MIN_METRES);
    expect(metres).toBeLessThan(MAX_METRES);
  });

  it('repeats trace bytes for the same seed and chunk', () => {
    let traced = 0;
    for (const [cx, cz] of [[0, 0], [5, -7], [-12, 31], [104, 208], [-3, -9]]) {
      const a = generateChunk(SEED, cx, cz, createSampler(SEED));
      const b = generateChunk(SEED, cx, cz, createSampler(SEED));
      const c = generateChunk(SEED, cx, cz);
      const x = new Uint8Array(a.props.buffer, a.props.byteOffset, a.props.byteLength);
      const y = new Uint8Array(b.props.buffer, b.props.byteOffset, b.props.byteLength);
      const w = new Uint8Array(c.props.buffer, c.props.byteOffset, c.props.byteLength);
      expect(y.length).toBe(x.length);
      expect(w.length).toBe(x.length);
      for (let i = 0; i < x.length; i++) {
        expect(y[i]).toBe(x[i]);
        expect(w[i]).toBe(x[i]);
      }
      for (let p = 0; p < a.props.length; p += 4) if (isTrace(a.props[p + 2])) traced++;
    }
    expect(traced).toBeGreaterThan(0);
  });

  it('beaches wrecks at the waterline and nowhere else', () => {
    const sampler = createSampler(SEED);
    let seen = 0;
    for (let cz = -12; cz < 12; cz++) {
      for (let cx = -12; cx < 12; cx++) {
        const chunk = generateChunk(SEED, cx, cz, sampler);
        for (let p = 0; p < chunk.props.length; p += 4) {
          if (chunk.props[p + 2] !== PROP.WRECK) continue;
          const x = chunk.props[p];
          const z = chunk.props[p + 1];
          const h = sampler.height(x, z);
          expect(h).toBeGreaterThan(WRECK_SHALLOW);
          expect(h).toBeLessThan(WRECK_SHORE);
          const m = materialAt(chunk, x, z);
          expect(m === MATERIAL.SAND || m === MATERIAL.WATER).toBe(true);
          seen++;
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('cuts stumps only in forest and clears the trees inside them', () => {
    const sampler = createSampler(SEED);
    let seen = 0;
    for (let cz = -12; cz < 12; cz++) {
      for (let cx = -12; cx < 12; cx++) {
        const chunk = generateChunk(SEED, cx, cz, sampler);
        for (let p = 0; p < chunk.props.length; p += 4) {
          if (chunk.props[p + 2] !== PROP.STUMPS) continue;
          const x = chunk.props[p];
          const z = chunk.props[p + 1];
          expect(materialAt(chunk, x, z)).toBe(MATERIAL.FOREST);
          for (let q = 0; q < chunk.props.length; q += 4) {
            if (chunk.props[q + 2] !== PROP.TREE) continue;
            const dx = chunk.props[q] - x;
            const dz = chunk.props[q + 1] - z;
            expect(Math.sqrt(dx * dx + dz * dz)).toBeGreaterThanOrEqual(6);
          }
          seen++;
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('stacks cairns only on high ground', () => {
    const sampler = createSampler(SEED);
    let seen = 0;
    for (let cz = -12; cz < 12; cz++) {
      for (let cx = -12; cx < 12; cx++) {
        const chunk = generateChunk(SEED, cx, cz, sampler);
        for (let p = 0; p < chunk.props.length; p += 4) {
          if (chunk.props[p + 2] !== PROP.CAIRN) continue;
          expect(sampler.height(chunk.props[p], chunk.props[p + 1]))
            .toBeGreaterThan(CAIRN_HEIGHT - 2);
          seen++;
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('fills every instanced slot the renderer allocates', () => {
    const sampler = createSampler(SEED);
    const material = new ShaderMaterial();
    const identity = new Matrix4();
    const probe = new Matrix4();
    let meshes = 0;
    let instances = 0;
    for (let cz = -5; cz < 5; cz++) {
      for (let cx = -5; cx < 5; cx++) {
        const chunk = generateChunk(SEED, cx, cz, sampler);
        const group = buildProps(chunk, material, ATLAS);
        group.traverse((child) => {
          const mesh = child as InstancedMesh;
          if (!mesh.isInstancedMesh) return;
          meshes++;
          for (let i = 0; i < mesh.count; i++) {
            mesh.getMatrixAt(i, probe);
            expect(probe.equals(identity)).toBe(false);
            instances++;
          }
        });
        const dispose = group.userData.dispose as () => void;
        dispose();
      }
    }
    material.dispose();
    expect(meshes).toBeGreaterThan(0);
    expect(instances).toBeGreaterThan(0);
  });

  it('keeps every trace on the chunk it was generated for', () => {
    const sampler = createSampler(SEED);
    for (let cz = -6; cz < 6; cz++) {
      for (let cx = -6; cx < 6; cx++) {
        const chunk = generateChunk(SEED, cx, cz, sampler);
        for (let p = 0; p < chunk.props.length; p += 4) {
          if (!isTrace(chunk.props[p + 2])) continue;
          expect(chunk.props[p]).toBeGreaterThanOrEqual(cx * CHUNK_SIZE);
          expect(chunk.props[p]).toBeLessThan((cx + 1) * CHUNK_SIZE);
          expect(chunk.props[p + 1]).toBeGreaterThanOrEqual(cz * CHUNK_SIZE);
          expect(chunk.props[p + 1]).toBeLessThan((cz + 1) * CHUNK_SIZE);
          expect(chunk.props[p + 3]).toBeGreaterThanOrEqual(0.85);
          expect(chunk.props[p + 3]).toBeLessThanOrEqual(1.2);
        }
      }
    }
  });
});
