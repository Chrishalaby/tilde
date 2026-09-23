import { LinearSRGBColorSpace } from 'three';
import { describe, expect, it } from 'vitest';
import { MATERIAL, MATERIAL_COUNT } from '../src/config';
import { skyAt } from '../src/render/sky';

describe('skyAt', () => {
  it('uses the day horizon as paper at noon', () => {
    expect(skyAt(0.5).paper.getHexString(LinearSRGBColorSpace)).toBe('b8c4d2');
  });

  it('uses the night horizon as paper at midnight', () => {
    expect(skyAt(0).paper.getHexString(LinearSRGBColorSpace)).toBe('2e3b55');
  });

  it('gives one glyph ink per material', () => {
    expect(skyAt(0.5).inks).toHaveLength(MATERIAL_COUNT);
    expect(skyAt(0).inks).toHaveLength(MATERIAL_COUNT);
  });

  it('gives four palette columns per material', () => {
    const sky = skyAt(0.5);
    expect(sky.bgLit).toHaveLength(MATERIAL_COUNT);
    expect(sky.bgShade).toHaveLength(MATERIAL_COUNT);
    expect(sky.glyphShade).toHaveLength(MATERIAL_COUNT);
  });

  it('paints lit grass with the noon table at noon', () => {
    expect(skyAt(0.5).bgLit[MATERIAL.GRASS].getHexString(LinearSRGBColorSpace)).toBe('5a7f4a');
  });

  it('derives the tinted rows from the noon table', () => {
    expect(skyAt(0).bgLit[MATERIAL.GRASS].getHexString(LinearSRGBColorSpace)).toBe('2c4936');
    expect(skyAt(0).inks[MATERIAL.GRASS].getHexString(LinearSRGBColorSpace)).toBe('4d665d');
    expect(skyAt(0).bgLit[MATERIAL.FIRE].getHexString(LinearSRGBColorSpace)).toBe('e0893a');
  });

  it('lifts night glyphs above their background', () => {
    const sky = skyAt(0);
    for (const m of [MATERIAL.GRASS, MATERIAL.TREE, MATERIAL.WATER, MATERIAL.STONE]) {
      const bg = sky.bgLit[m];
      const glyph = sky.inks[m];
      expect(glyph.r + glyph.g + glyph.b).toBeGreaterThan(bg.r + bg.g + bg.b);
    }
  });

  it('raises the sun at noon and sinks it at midnight', () => {
    expect(skyAt(0.5).sunPos.y).toBeGreaterThan(0.7);
    expect(skyAt(0).sunPos.y).toBeLessThan(-0.7);
    expect(skyAt(0).moonPos.y).toBeGreaterThan(0.7);
  });

  it('keeps the lighting direction above the horizon all day', () => {
    for (let i = 0; i <= 48; i++) {
      const sky = skyAt(i / 48);
      expect(sky.sunDir.y).toBeGreaterThan(0.2);
      expect(sky.sunDir.length()).toBeCloseTo(1, 5);
    }
  });

  it('holds 64 unit star directions above the horizon', () => {
    const stars = skyAt(0).stars;
    expect(stars).toHaveLength(64);
    for (const s of stars) {
      expect(s.length()).toBeCloseTo(1, 5);
      expect(s.y).toBeGreaterThan(0);
    }
  });

  it('memoises the last time of day', () => {
    const a = skyAt(0.5);
    const b = skyAt(0.5);
    expect(b).toBe(a);
    expect(skyAt(0.51)).not.toBe(a);
  });

  it('is fully night at midnight and fully day at noon', () => {
    expect(skyAt(0).night).toBe(1);
    expect(skyAt(0.5).night).toBe(0);
    expect(skyAt(0.5).sunStrength).toBe(1);
    expect(skyAt(0).sunStrength).toBeCloseTo(0.85, 5);
  });

  it('keeps the key light leaning toward the sun at the twilight peaks', () => {
    for (const t of [0.25, 0.75]) {
      const sky = skyAt(t);
      const across = sky.sunDir.x * sky.sunPos.x + sky.sunDir.z * sky.sunPos.z;
      expect(across).toBeGreaterThan(0.2);
    }
  });

  it('puts a luminous mid band between horizon and zenith', () => {
    for (const t of [0, 0.25, 0.5, 0.75]) {
      const sky = skyAt(t);
      const band = sky.band.r + sky.band.g + sky.band.b;
      const zenith = sky.zenith.r + sky.zenith.g + sky.zenith.b;
      const horizon = sky.horizon.r + sky.horizon.g + sky.horizon.b;
      expect(band).toBeGreaterThan(zenith);
      expect(band).toBeLessThan(horizon);
    }
  });
});
