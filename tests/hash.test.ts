import { describe, expect, it } from 'vitest';
import { chunkRng, hash01, mix32, seedFromString, sfc32 } from '../src/world/hash';

const SAMPLES = 100000;
const BUCKETS = 16;
const TOLERANCE = 0.08;

function bucketCounts(pick: (i: number) => number): number[] {
  const counts = new Array<number>(BUCKETS).fill(0);
  for (let i = 0; i < SAMPLES; i++) counts[pick(i)]++;
  return counts;
}

function expectUniform(counts: number[]): void {
  const expected = SAMPLES / BUCKETS;
  for (let b = 0; b < BUCKETS; b++) {
    const drift = Math.abs(counts[b] - expected) / expected;
    expect(drift, `bucket ${b} had ${counts[b]}`).toBeLessThan(TOLERANCE);
  }
}

describe('mix32', () => {
  it('is deterministic', () => {
    expect(mix32(1, 2, 3, 4)).toBe(mix32(1, 2, 3, 4));
    expect(mix32(0)).toBe(mix32(0, 0, 0, 0));
  });

  it('returns unsigned 32-bit integers', () => {
    for (let i = 0; i < 1000; i++) {
      const v = mix32(i, -i, i * 7, 0x7fffffff);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(4294967296);
    }
  });

  it('spreads low bits evenly over 16 buckets', () => {
    expectUniform(bucketCounts((i) => mix32(i) % BUCKETS));
  });

  it('spreads high bits evenly over 16 buckets', () => {
    expectUniform(bucketCounts((i) => Math.floor(hash01(1234, i) * BUCKETS)));
  });

  it('spreads evenly over a 2d coordinate field', () => {
    const side = Math.ceil(Math.sqrt(SAMPLES));
    expectUniform(
      bucketCounts((i) => mix32(99, i % side, Math.floor(i / side), 7) % BUCKETS),
    );
  });

  it('changes when any argument changes', () => {
    const base = mix32(5, 5, 5, 5);
    expect(mix32(6, 5, 5, 5)).not.toBe(base);
    expect(mix32(5, 6, 5, 5)).not.toBe(base);
    expect(mix32(5, 5, 6, 5)).not.toBe(base);
    expect(mix32(5, 5, 5, 6)).not.toBe(base);
  });
});

describe('hash01', () => {
  it('stays inside [0, 1)', () => {
    let min = 1;
    let max = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const v = hash01(i, i * 3, 0, 11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(min).toBeLessThan(0.001);
    expect(max).toBeGreaterThan(0.999);
  });
});

describe('chunkRng', () => {
  const take = (rng: () => number, n: number): number[] =>
    Array.from({ length: n }, () => rng());

  it('repeats for the same seed, chunk and salt', () => {
    expect(take(chunkRng(7, -3, 12, 2), 16)).toEqual(take(chunkRng(7, -3, 12, 2), 16));
  });

  it('differs for different salts', () => {
    const a = take(chunkRng(7, -3, 12, 0), 16);
    for (let salt = 1; salt < 12; salt++) {
      const b = take(chunkRng(7, -3, 12, salt), 16);
      expect(b).not.toEqual(a);
    }
  });

  it('differs for different chunks and seeds', () => {
    const a = take(chunkRng(7, 0, 0, 0), 16);
    expect(take(chunkRng(7, 1, 0, 0), 16)).not.toEqual(a);
    expect(take(chunkRng(7, 0, 1, 0), 16)).not.toEqual(a);
    expect(take(chunkRng(8, 0, 0, 0), 16)).not.toEqual(a);
  });

  it('produces values in [0, 1) that fill 16 buckets evenly', () => {
    const rng = chunkRng(42, 4, -4, 3);
    expectUniform(
      bucketCounts(() => {
        const v = rng();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
        return Math.floor(v * BUCKETS);
      }),
    );
  });
});

describe('seeding helpers', () => {
  it('turns strings into stable unsigned seeds', () => {
    expect(seedFromString('tilde')).toBe(seedFromString('tilde'));
    expect(seedFromString('tilde')).not.toBe(seedFromString('tilde '));
    expect(seedFromString('tilde')).toBeGreaterThanOrEqual(0);
  });

  it('gives sfc32 a reproducible stream', () => {
    const a = sfc32(1, 2, 3, 4);
    const b = sfc32(1, 2, 3, 4);
    for (let i = 0; i < 64; i++) expect(a()).toBe(b());
  });
});
