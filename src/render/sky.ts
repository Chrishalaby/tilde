import { Color, Vector3 } from 'three';
import { MATERIAL, MATERIAL_COUNT } from '../config';

export interface SkyState {
  paper: Color;
  ink: Color;
  inks: Color[];
  sunDir: Vector3;
  sunStrength: number;
  night: number;
}

function rgb(hex: number): Color {
  const c = new Color();
  c.r = ((hex >> 16) & 255) / 255;
  c.g = ((hex >> 8) & 255) / 255;
  c.b = (hex & 255) / 255;
  return c;
}

const DAY_PAPER = rgb(0xebe9e2);
const DAY_INK = rgb(0x26292a);
const DUSK_PAPER = rgb(0xd9d3c6);
const DUSK_INK = rgb(0x3a3b3e);
const NIGHT_PAPER = rgb(0x1a1c1b);
const NIGHT_INK = rgb(0xd6d4cc);
const DAWN_PAPER = rgb(0xdddad2);
const DAWN_INK = rgb(0x2e3133);

const PAPER_KEYS = [NIGHT_PAPER, DAWN_PAPER, DAY_PAPER, DUSK_PAPER, NIGHT_PAPER];
const INK_KEYS = [NIGHT_INK, DAWN_INK, DAY_INK, DUSK_INK, NIGHT_INK];

const BIOME_INKS: Record<number, Color> = {
  [MATERIAL.GRASS]: rgb(0x68796c),
  [MATERIAL.FOREST]: rgb(0x4f5f52),
  [MATERIAL.STONE]: rgb(0x7a746c),
  [MATERIAL.SAND]: rgb(0xa8956a),
  [MATERIAL.SNOW]: rgb(0x969b9e),
  [MATERIAL.WATER]: rgb(0x6a7f8f),
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0;
  const t = span === 0 ? (x < edge0 ? 0 : 1) : Math.min(1, Math.max(0, (x - edge0) / span));
  return t * t * (3 - 2 * t);
}

function towards(out: Color, target: Color, amount: number): Color {
  if (amount <= 0) return out;
  if (amount >= 1) return out.copy(target);
  out.r += (target.r - out.r) * amount;
  out.g += (target.g - out.g) * amount;
  out.b += (target.b - out.b) * amount;
  return out;
}

function blend(keys: Color[], mixes: number[]): Color {
  const out = keys[0].clone();
  for (let i = 0; i < mixes.length; i++) towards(out, keys[i + 1], mixes[i]);
  return out;
}

export function skyAt(timeOfDay: number): SkyState {
  const raw = Number.isFinite(timeOfDay) ? timeOfDay : 0;
  const t = raw - Math.floor(raw);

  const mixes = [
    smoothstep(0.22, 0.25, t),
    smoothstep(0.25, 0.28, t),
    smoothstep(0.72, 0.75, t),
    smoothstep(0.75, 0.78, t),
  ];

  const paper = blend(PAPER_KEYS, mixes);
  const ink = blend(INK_KEYS, mixes);

  const day = smoothstep(0.22, 0.28, t) - smoothstep(0.72, 0.78, t);
  const night = Math.min(1, Math.max(0, 1 - day));

  const inks: Color[] = [];
  for (let m = 0; m < MATERIAL_COUNT; m++) {
    if (m === MATERIAL.LETTER) {
      inks.push(ink.clone());
    } else if (m === MATERIAL.NONE) {
      inks.push(paper.clone());
    } else {
      const base = BIOME_INKS[m];
      inks.push(towards((base ?? ink).clone(), NIGHT_INK, 0.65 * night));
    }
  }

  const angle = (t - 0.25) * Math.PI * 2;
  const across = Math.cos(angle);
  const elevation = Math.sin(angle);
  const sun = new Vector3(across - 0.45, elevation * 0.9 + 0.1, 0.55).normalize();
  const moon = new Vector3(0.3 - across, 0.15 - elevation * 0.7, -0.5).normalize();
  const sunDir = sun.lerp(moon, night).normalize();
  const sunStrength = 0.35 + 0.65 * (1 - night);

  return { paper, ink, inks, sunDir, sunStrength, night };
}
