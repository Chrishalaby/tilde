import { DataTexture, LinearFilter, NearestFilter, RedFormat, UnsignedByteType } from 'three';
import { MATERIAL, MATERIAL_COUNT } from '../config';

const SYMBOLS = " .,'\":;!?*+-_=/\\|()[]{}<>#%&$@^~°≈";
const DIGITS = '0123456789';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const GLYPHS = SYMBOLS + DIGITS + LETTERS;
export const EDGE_GLYPHS = '|-/\\';

export const RAMPS: Record<number, string> = {
  [MATERIAL.GRASS]: " .,':;",
  [MATERIAL.FOREST]: " .'^YT",
  [MATERIAL.STONE]: '.:%#@',
  [MATERIAL.SAND]: ' .:°',
  [MATERIAL.SNOW]: '  .*+',
  [MATERIAL.WATER]: '~-≈_',
  [MATERIAL.LETTER]: 'A',
  [MATERIAL.NONE]: ' ',
};

export const ATLAS_COLS = 16;
export const GLYPH_W = 20;
export const GLYPH_H = 36;
export const RAMP_STEPS = 16;

const FONT_FAMILY = 'IBM Plex Mono';
const FONT_FILE = 'fonts/IBMPlexMono-Medium.woff2';
const FONT_SPEC = '500 30px "IBM Plex Mono"';

export interface GlyphAtlas {
  texture: DataTexture;
  cols: number;
  rows: number;
  glyphW: number;
  glyphH: number;
  index: Map<string, number>;
  coverage: Float32Array;
  ramps: Uint8Array;
  rampTexture: DataTexture;
}

async function loadFont(fontFamily: string): Promise<void> {
  if (typeof document === 'undefined' || typeof document.fonts === 'undefined') return;
  try {
    if (fontFamily === FONT_FAMILY) {
      const url = `url(${import.meta.env.BASE_URL}${FONT_FILE})`;
      const face = new FontFace(FONT_FAMILY, url, { weight: '500' });
      document.fonts.add(face);
      await face.load();
    }
    await document.fonts.load(`500 30px "${fontFamily}"`);
    await document.fonts.load(FONT_SPEC);
  } catch {
    return;
  }
}

function buildRamps(index: Map<string, number>): Uint8Array {
  const out = new Uint8Array(RAMP_STEPS * MATERIAL_COUNT);
  const blank = index.get(' ') ?? 0;
  for (let m = 0; m < MATERIAL_COUNT; m++) {
    const ramp = RAMPS[m] ?? ' ';
    const len = Math.max(1, ramp.length);
    for (let s = 0; s < RAMP_STEPS; s++) {
      const pos = Math.min(len - 1, Math.floor((s * len) / RAMP_STEPS));
      out[m * RAMP_STEPS + s] = index.get(ramp[pos]) ?? blank;
    }
  }
  return out;
}

export async function buildGlyphAtlas(fontFamily: string = FONT_FAMILY): Promise<GlyphAtlas> {
  await loadFont(fontFamily);

  const cols = ATLAS_COLS;
  const rows = Math.ceil(GLYPHS.length / cols);
  const width = cols * GLYPH_W;
  const height = rows * GLYPH_H;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) throw new Error('glyph atlas needs a 2d canvas context');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.font = `500 30px "${fontFamily}", ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const index = new Map<string, number>();
  for (let i = 0; i < GLYPHS.length; i++) {
    const ch = GLYPHS[i];
    index.set(ch, i);
    if (ch === ' ') continue;
    const x = (i % cols) * GLYPH_W + GLYPH_W * 0.5;
    const y = Math.floor(i / cols) * GLYPH_H + GLYPH_H * 0.5 + 1;
    ctx.fillText(ch, x, y);
  }

  const image = ctx.getImageData(0, 0, width, height);
  const data = new Uint8Array(width * height);
  for (let p = 0; p < data.length; p++) data[p] = image.data[p * 4];

  const coverage = new Float32Array(GLYPHS.length);
  for (let i = 0; i < GLYPHS.length; i++) {
    const gx = (i % cols) * GLYPH_W;
    const gy = Math.floor(i / cols) * GLYPH_H;
    let sum = 0;
    for (let y = 0; y < GLYPH_H; y++) {
      const row = (gy + y) * width + gx;
      for (let x = 0; x < GLYPH_W; x++) sum += data[row + x];
    }
    coverage[i] = sum / (GLYPH_W * GLYPH_H * 255);
  }

  const texture = new DataTexture(data, width, height, RedFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.flipY = false;
  texture.needsUpdate = true;

  const ramps = buildRamps(index);
  const rampTexture = new DataTexture(ramps, RAMP_STEPS, MATERIAL_COUNT, RedFormat, UnsignedByteType);
  rampTexture.minFilter = NearestFilter;
  rampTexture.magFilter = NearestFilter;
  rampTexture.generateMipmaps = false;
  rampTexture.unpackAlignment = 1;
  rampTexture.flipY = false;
  rampTexture.needsUpdate = true;

  return { texture, cols, rows, glyphW: GLYPH_W, glyphH: GLYPH_H, index, coverage, ramps, rampTexture };
}
