import { Color, LinearSRGBColorSpace } from 'three';
import { describe, expect, it } from 'vitest';
import { MATERIAL, MATERIAL_COUNT } from '../src/config';
import { RAMPS } from '../src/render/glyph-atlas';
import { skyAt } from '../src/render/sky';

function channelLight(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(c: Color): number {
  return 0.2126 * channelLight(c.r) + 0.7152 * channelLight(c.g) + 0.0722 * channelLight(c.b);
}

function contrast(a: Color, b: Color): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

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

  it('paints dirt as muted warm earth, apart from grass and sand', () => {
    const noon = skyAt(0.5);
    expect(MATERIAL.DIRT).toBe(12);
    expect(MATERIAL_COUNT).toBe(13);
    expect(noon.bgLit[MATERIAL.DIRT].getHexString(LinearSRGBColorSpace)).toBe('8b7355');
    expect(noon.bgShade[MATERIAL.DIRT].getHexString(LinearSRGBColorSpace)).toBe('6a5842');
    const lit = noon.bgLit[MATERIAL.DIRT];
    expect(lit.r).toBeGreaterThan(lit.g);
    expect(lit.g).toBeGreaterThan(lit.b);
    for (const other of [MATERIAL.GRASS, MATERIAL.SAND]) {
      const o = noon.bgLit[other];
      const apart = Math.abs(o.r - lit.r) + Math.abs(o.g - lit.g) + Math.abs(o.b - lit.b);
      expect(apart).toBeGreaterThan(0.2);
    }
  });

  it('sets dirt glyphs at about the two to one contrast of the other land rows', () => {
    const noon = skyAt(0.5);
    for (const m of [MATERIAL.GRASS, MATERIAL.SAND, MATERIAL.STONE, MATERIAL.DIRT]) {
      expect(contrast(noon.bgLit[m], noon.inks[m])).toBeGreaterThan(1.7);
      expect(contrast(noon.bgLit[m], noon.inks[m])).toBeLessThan(2.3);
      expect(contrast(noon.bgShade[m], noon.glyphShade[m])).toBeGreaterThan(1.5);
      expect(contrast(noon.bgShade[m], noon.glyphShade[m])).toBeLessThan(2.3);
    }
  });

  it('derives the dawn, dusk and night dirt rows like the others', () => {
    const noon = skyAt(0.5);
    const night = skyAt(0);
    const dawn = skyAt(0.25);
    const dusk = skyAt(0.75);
    for (const sky of [night, dawn, dusk]) {
      expect(sky.bgLit[MATERIAL.DIRT].getHexString(LinearSRGBColorSpace))
        .not.toBe(noon.bgLit[MATERIAL.DIRT].getHexString(LinearSRGBColorSpace));
    }
    expect(night.bgLit[MATERIAL.DIRT].getHexString(LinearSRGBColorSpace)).toBe('44423e');
    const bg = night.bgLit[MATERIAL.DIRT];
    const glyph = night.inks[MATERIAL.DIRT];
    expect(glyph.r + glyph.g + glyph.b).toBeGreaterThan(bg.r + bg.g + bg.b);
    const warm = dawn.bgLit[MATERIAL.DIRT];
    expect(warm.r).toBeGreaterThan(warm.b);
  });

  it('gives dirt a sparse ramp of small glyphs', () => {
    const ramp = RAMPS[MATERIAL.DIRT];
    expect(ramp[0]).toBe(' ');
    expect(ramp.length).toBeGreaterThanOrEqual(3);
    expect(ramp.length).toBeLessThanOrEqual(6);
    for (const glyph of ramp) expect(' .,-_').toContain(glyph);
  });

  it('lifts night glyphs above their background', () => {
    const sky = skyAt(0);
    for (const m of [MATERIAL.GRASS, MATERIAL.TREE, MATERIAL.WATER, MATERIAL.STONE, MATERIAL.DIRT]) {
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
