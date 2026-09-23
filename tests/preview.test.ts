import { describe, expect, it } from 'vitest';
import { MATERIAL, MATERIAL_COUNT, type MaterialId } from '../src/config';
import { materialFor } from '../src/world/biomes';
import { createSampler } from '../src/world/sampler';

declare const process: { stdout: { write(text: string): void } };

const SEED = 1234;
const GRID = 200;
const SPACING = 20;
const PROBE = 2;

const GLYPH: Record<number, string> = {
  [MATERIAL.WATER]: '~',
  [MATERIAL.SAND]: '.',
  [MATERIAL.GRASS]: ',',
  [MATERIAL.FOREST]: 'T',
  [MATERIAL.STONE]: '#',
  [MATERIAL.SNOW]: '*',
};

const NAME: Record<number, string> = {
  [MATERIAL.WATER]: 'water',
  [MATERIAL.SAND]: 'sand',
  [MATERIAL.GRASS]: 'grass',
  [MATERIAL.FOREST]: 'forest',
  [MATERIAL.STONE]: 'stone',
  [MATERIAL.SNOW]: 'snow',
};

describe('world preview', () => {
  it('reads as coastlines and hills', () => {
    const sampler = createSampler(SEED);
    const counts = new Array<number>(MATERIAL_COUNT).fill(0);
    const rows: string[] = [];
    const half = (GRID * SPACING) / 2;
    let minHeight = Infinity;
    let maxHeight = -Infinity;

    for (let j = 0; j < GRID; j++) {
      const z = j * SPACING - half;
      let row = '';
      for (let i = 0; i < GRID; i++) {
        const x = i * SPACING - half;
        const h = sampler.height(x, z);
        const dx = (sampler.height(x + PROBE, z) - sampler.height(x - PROBE, z)) / (2 * PROBE);
        const dz = (sampler.height(x, z + PROBE) - sampler.height(x, z - PROBE)) / (2 * PROBE);
        const m: MaterialId = materialFor(
          h,
          Math.sqrt(dx * dx + dz * dz),
          sampler.moisture(x, z),
          sampler.temperature(x, z),
        );
        counts[m]++;
        row += GLYPH[m];
        if (h < minHeight) minHeight = h;
        if (h > maxHeight) maxHeight = h;
      }
      rows.push(row);
    }

    const lines: string[] = [];
    for (let j = 0; j < rows.length; j += 2) lines.push(rows[j]);

    const total = GRID * GRID;
    const fraction = (m: number): number => counts[m] / total;
    const report = Object.keys(NAME)
      .map((k) => Number(k))
      .map((m) => `${NAME[m]} ${(fraction(m) * 100).toFixed(2)}%`)
      .join('  ');
    lines.push(report);
    lines.push(`height ${minHeight.toFixed(1)}..${maxHeight.toFixed(1)} m`);
    process.stdout.write(`${lines.join('\n')}\n`);

    const water = fraction(MATERIAL.WATER);
    const green = fraction(MATERIAL.FOREST) + fraction(MATERIAL.GRASS);
    expect(water).toBeGreaterThan(0.2);
    expect(water).toBeLessThan(0.5);
    expect(green).toBeGreaterThan(fraction(MATERIAL.SAND));
    expect(green).toBeGreaterThan(fraction(MATERIAL.STONE));
    expect(green).toBeGreaterThan(fraction(MATERIAL.SNOW));
  });
});
