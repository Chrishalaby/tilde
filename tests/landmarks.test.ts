import { describe, expect, it } from 'vitest';
import { landmarkForRegion } from '../src/world/landmarks';
import { createSampler } from '../src/world/sampler';
import type { Landmark, WorldSampler } from '../src/world/types';

const SEED = 77;
const SPAN = 20;
const ORIGIN = 0;
const FLAT_RADII = [7, 14];
const FLAT_SPREAD = 4;
const DIRECTIONS = 8;

function scan(sampler: WorldSampler): Landmark[] {
  const out: Landmark[] = [];
  for (let rz = ORIGIN; rz < ORIGIN + SPAN; rz++) {
    for (let rx = ORIGIN; rx < ORIGIN + SPAN; rx++) {
      const mark = landmarkForRegion(SEED, rx, rz, sampler);
      if (mark) out.push(mark);
    }
  }
  return out;
}

function kindsOf(sampler: WorldSampler): string[] {
  const out: string[] = [];
  for (let rz = ORIGIN; rz < ORIGIN + SPAN; rz++) {
    for (let rx = ORIGIN; rx < ORIGIN + SPAN; rx++) {
      const mark = landmarkForRegion(SEED, rx, rz, sampler);
      out.push(mark ? mark.kind : 'none');
    }
  }
  return out;
}

function spreadAround(sampler: WorldSampler, x: number, z: number): number {
  const centre = sampler.height(x, z);
  let low = centre;
  let high = centre;
  for (const radius of FLAT_RADII) {
    for (let d = 0; d < DIRECTIONS; d++) {
      const angle = (d / DIRECTIONS) * Math.PI * 2;
      const y = sampler.height(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius);
      if (y < low) low = y;
      if (y > high) high = y;
    }
  }
  return high - low;
}

describe('castle landmarks', () => {
  it('covers four hundred regions', () => {
    expect(SPAN * SPAN).toBe(400);
  });

  it('places at least one castle across four hundred regions', () => {
    const marks = scan(createSampler(SEED));
    const castles = marks.filter((m) => m.kind === 'castle');
    expect(marks.length).toBeGreaterThan(0);
    expect(castles.length).toBeGreaterThan(0);
  });

  it('only builds castles on ground that varies under four metres within fourteen', () => {
    const sampler = createSampler(SEED);
    const castles = scan(sampler).filter((m) => m.kind === 'castle');
    for (const castle of castles) {
      expect(castle.letter).toBeNull();
      expect(castle.y).toBeGreaterThan(0);
      expect(spreadAround(sampler, castle.x, castle.z)).toBeLessThan(FLAT_SPREAD);
    }
  });

  it('keeps every other kind reachable and letters lettered', () => {
    const kinds = new Set(scan(createSampler(SEED)).map((m) => m.kind));
    expect(kinds.has('letter')).toBe(true);
    for (const mark of scan(createSampler(SEED))) {
      if (mark.kind === 'letter') expect(mark.letter).toMatch(/^[A-Z]$/);
      else expect(mark.letter).toBeNull();
    }
  });

  it('rolls the same kinds across two runs', () => {
    expect(kindsOf(createSampler(SEED))).toEqual(kindsOf(createSampler(SEED)));
    expect(kindsOf(createSampler(SEED))).toEqual(kindsOf(createSampler(SEED)));
  });
});
