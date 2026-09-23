import { Color, Vector3 } from 'three';
import { MATERIAL, MATERIAL_COUNT } from '../config';
import { hash01 } from '../world/hash';

export interface SkyState {
  paper: Color;
  ink: Color;
  inks: Color[];
  bgLit: Color[];
  bgShade: Color[];
  glyphShade: Color[];
  sunDir: Vector3;
  sunStrength: number;
  night: number;
  zenith: Color;
  band: Color;
  horizon: Color;
  horizonSun: Color;
  fogNear: Color;
  seaFar: Color;
  sunPos: Vector3;
  moonPos: Vector3;
  twilight: number;
  sunTint: Color;
  moonTint: Color;
  moonGlow: Color;
  star: Color;
  stars: Vector3[];
  cloudBright: Color;
  cloudLit: Color;
  cloudShade: Color;
  cloudCover: number;
  shallow: Color;
  foam: Color;
}

function rgb(hex: number): Color {
  const c = new Color();
  c.r = ((hex >> 16) & 255) / 255;
  c.g = ((hex >> 8) & 255) / 255;
  c.b = (hex & 255) / 255;
  return c;
}

function mul(a: Color, b: Color): Color {
  const c = new Color();
  c.r = a.r * b.r;
  c.g = a.g * b.g;
  c.b = a.b * b.b;
  return c;
}

function lerp(a: Color, b: Color, t: number): Color {
  const c = new Color();
  c.r = a.r + (b.r - a.r) * t;
  c.g = a.g + (b.g - a.g) * t;
  c.b = a.b + (b.b - a.b) * t;
  return c;
}

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

function blendScalar(keys: number[], mixes: number[]): number {
  let out = keys[0];
  for (let i = 0; i < mixes.length; i++) out += (keys[i + 1] - out) * mixes[i];
  return out;
}

interface Keyed<T> {
  night: T;
  dawn: T;
  day: T;
  dusk: T;
}

function keys<T>(k: Keyed<T>): T[] {
  return [k.night, k.dawn, k.day, k.dusk, k.night];
}

function colourKeys(k: Keyed<number>): Color[] {
  return keys({ night: rgb(k.night), dawn: rgb(k.dawn), day: rgb(k.day), dusk: rgb(k.dusk) });
}

const ZENITH = colourKeys({ night: 0x0f1530, dawn: 0x56679b, day: 0x4a6fb0, dusk: 0x4e5a8e });
const BAND = colourKeys({ night: 0x1e2841, dawn: 0xc9aab4, day: 0x8fa5c6, dusk: 0xbf9aa4 });
const HORIZON = colourKeys({ night: 0x2e3b55, dawn: 0xd8c2b0, day: 0xb8c4d2, dusk: 0xd1b2a4 });
const HORIZON_SUN = colourKeys({ night: 0x2e3b55, dawn: 0xf0b98c, day: 0xc9cdd2, dusk: 0xf0a470 });
const SEA_FAR = colourKeys({ night: 0x1c2840, dawn: 0x8c8a96, day: 0x6c7f93, dusk: 0x7e7590 });
const SUN_TINT = colourKeys({ night: 0xffb477, dawn: 0xffc48a, day: 0xfff4dc, dusk: 0xffb477 });
const CLOUD_BRIGHT = colourKeys({ night: 0x4c5670, dawn: 0xfbe6d2, day: 0xf5f4ef, dusk: 0xf7d9c0 });
const CLOUD_LIT = colourKeys({ night: 0x3e4760, dawn: 0xf2c6a0, day: 0xe9e0cb, dusk: 0xf0b48c });
const CLOUD_SHADE = colourKeys({ night: 0x1c2233, dawn: 0x8c8ca8, day: 0xa4adba, dusk: 0x7f7c9c });
const CLOUD_COVER = keys({ night: 0.58, dawn: 0.56, day: 0.54, dusk: 0.56 });
const INK = colourKeys({ night: 0xd2dae6, dawn: 0x2a2a36, day: 0x1e2733, dusk: 0x2b2733 });
const SHALLOW = colourKeys({ night: 0x3d5f7b, dawn: 0x7e896d, day: 0x7ea6a8, dusk: 0x7e7c5c });
const FOAM = colourKeys({ night: 0x6b84a9, dawn: 0xdcbe97, day: 0xdce6e8, dusk: 0xdcab7f });

const KEY_TINT = { dawn: rgb(0xffe0c2), dusk: rgb(0xffd2ae), night: rgb(0x7c92ba) };
const FILL_TINT = { dawn: rgb(0xb9c3de), dusk: rgb(0xb4add0), night: rgb(0x4a5a80) };
const MOON_GLYPH = rgb(0xc4d0e8);

const MOON_TINT = rgb(0xe9eef5);
const MOON_GLOW = rgb(0x8fa3c8);
const STAR = rgb(0xdce3f0);

type Row = [number, number, number, number];

const NOON: Record<number, Row> = {
  [MATERIAL.GRASS]: [0x5a7f4a, 0x3f5f3a, 0x395231, 0x26402a],
  [MATERIAL.FOREST]: [0x4e7343, 0x365235, 0x314a2d, 0x213524],
  [MATERIAL.STONE]: [0x8a8678, 0x5c5f62, 0x585a55, 0x3a3f44],
  [MATERIAL.SAND]: [0xc9b98e, 0x9b9375, 0x857e64, 0x655f4d],
  [MATERIAL.SNOW]: [0xeef0f2, 0xaebcd0, 0xb0b9c2, 0x8191a6],
  [MATERIAL.WATER]: [0x3d6478, 0x34576a, 0x7a9dac, 0x64879a],
  [MATERIAL.LETTER]: [0x2b2e33, 0x1f2226, 0xe8e4d8, 0xc9c5ba],
  [MATERIAL.NONE]: [0xb8c4d2, 0xb8c4d2, 0xb8c4d2, 0xb8c4d2],
  [MATERIAL.TREE]: [0x2f4d36, 0x223a2a, 0x152a1c, 0x0f2016],
  [MATERIAL.TRUNK]: [0x4a3a2b, 0x33291f, 0x2a2016, 0x1a140e],
  [MATERIAL.FIRE]: [0xe0893a, 0xe0893a, 0xffe2a6, 0xffe2a6],
  [MATERIAL.FIGURE]: [0xb8a48c, 0x8a7a68, 0x4a3f34, 0x332c24],
  [MATERIAL.DIRT]: [0x8b7355, 0x6a5842, 0x54473a, 0x3b3128],
};

const NIGHT_GLYPH: Record<number, [number, number]> = {
  [MATERIAL.LETTER]: [0xb8c4dc, 0x98a4bc],
  [MATERIAL.FIGURE]: [0xc8d2e4, 0xa8b2c4],
  [MATERIAL.SNOW]: [0x5c7199, 0x28365a],
};

const FALLBACK_ROW: Row = [0xb8c4d2, 0xb8c4d2, 0xb8c4d2, 0xb8c4d2];

function noonRow(m: number): Color[] {
  const row = NOON[m] ?? FALLBACK_ROW;
  return row.map(rgb);
}

function tintedRow(noon: Color[], key: Color, fill: Color): Color[] {
  return [mul(noon[0], key), mul(noon[1], fill), mul(noon[2], key), mul(noon[3], fill)];
}

function nightRow(m: number, noon: Color[]): Color[] {
  const bgLit = mul(noon[0], KEY_TINT.night);
  const bgShade = mul(noon[1], FILL_TINT.night);
  const explicit = NIGHT_GLYPH[m];
  if (explicit) return [bgLit, bgShade, rgb(explicit[0]), rgb(explicit[1])];
  const lift = m === MATERIAL.WATER ? 0.3 : 0.22;
  return [bgLit, bgShade, lerp(bgLit, MOON_GLYPH, lift), lerp(bgShade, MOON_GLYPH, lift)];
}

const MATERIAL_KEYS: Color[][][] = [];
for (let m = 0; m < MATERIAL_COUNT; m++) {
  const noon = noonRow(m);
  const dawn = m === MATERIAL.FIRE ? noon : tintedRow(noon, KEY_TINT.dawn, FILL_TINT.dawn);
  const dusk = m === MATERIAL.FIRE ? noon : tintedRow(noon, KEY_TINT.dusk, FILL_TINT.dusk);
  const night = m === MATERIAL.FIRE ? noon : nightRow(m, noon);
  const columns: Color[][] = [];
  for (let k = 0; k < 4; k++) columns.push([night[k], dawn[k], noon[k], dusk[k], night[k]]);
  MATERIAL_KEYS.push(columns);
}

const STARS: Vector3[] = [];
for (let i = 0; i < 64; i++) {
  const y = 0.05 + 0.95 * hash01(7, i, 0, 1);
  const azimuth = Math.PI * 2 * hash01(7, i, 0, 2);
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  STARS.push(new Vector3(r * Math.cos(azimuth), y, r * Math.sin(azimuth)).normalize());
}

function raise(v: Vector3): Vector3 {
  return new Vector3(v.x, Math.max(v.y, 0) + 0.35, v.z).normalize();
}

let lastT = Number.NaN;
let lastState: SkyState | null = null;

export function skyAt(timeOfDay: number): SkyState {
  const raw = Number.isFinite(timeOfDay) ? timeOfDay : 0;
  const t = Math.round((raw - Math.floor(raw)) * 8192) / 8192;
  if (lastState !== null && t === lastT) return lastState;

  const mixes = [
    smoothstep(0.2, 0.25, t),
    smoothstep(0.25, 0.31, t),
    smoothstep(0.69, 0.75, t),
    smoothstep(0.75, 0.8, t),
  ];

  const day = smoothstep(0.2, 0.31, t) - smoothstep(0.69, 0.8, t);
  const night = Math.min(1, Math.max(0, 1 - day));

  const zenith = blend(ZENITH, mixes);
  const band = blend(BAND, mixes);
  const horizon = blend(HORIZON, mixes);
  const horizonSun = blend(HORIZON_SUN, mixes);
  const seaFar = blend(SEA_FAR, mixes);
  const fogNear = lerp(horizon, band, 0.5);
  const sunTint = blend(SUN_TINT, mixes);
  const cloudBright = blend(CLOUD_BRIGHT, mixes);
  const cloudLit = blend(CLOUD_LIT, mixes);
  const cloudShade = blend(CLOUD_SHADE, mixes);
  const cloudCover = blendScalar(CLOUD_COVER, mixes);
  const ink = blend(INK, mixes);
  const shallow = blend(SHALLOW, mixes);
  const foam = blend(FOAM, mixes);

  const bgLit: Color[] = [];
  const bgShade: Color[] = [];
  const inks: Color[] = [];
  const glyphShade: Color[] = [];
  for (let m = 0; m < MATERIAL_COUNT; m++) {
    const columns = MATERIAL_KEYS[m];
    bgLit.push(blend(columns[0], mixes));
    bgShade.push(blend(columns[1], mixes));
    inks.push(blend(columns[2], mixes));
    glyphShade.push(blend(columns[3], mixes));
  }

  const a = (t - 0.25) * Math.PI * 2;
  const across = Math.cos(a);
  const elevation = Math.sin(a);
  const sunPos = new Vector3(across - 0.45, elevation * 0.95 - 0.02, 0.55).normalize();
  const moonPos = new Vector3(0.3 - across, 0.1 - elevation * 0.8, -0.5).normalize();
  const twilight = Math.min(1, Math.max(0, 1 - Math.abs(sunPos.y) / 0.22));
  const toMoon = 1 - smoothstep(-0.12, 0.02, sunPos.y);
  const sunDir = raise(sunPos).lerp(raise(moonPos), toMoon).normalize();
  const sunStrength = 1 - 0.15 * night;

  const state: SkyState = {
    paper: horizon,
    ink,
    inks,
    bgLit,
    bgShade,
    glyphShade,
    sunDir,
    sunStrength,
    night,
    zenith,
    band,
    horizon,
    horizonSun,
    fogNear,
    seaFar,
    sunPos,
    moonPos,
    twilight,
    sunTint,
    moonTint: MOON_TINT,
    moonGlow: MOON_GLOW,
    star: STAR,
    stars: STARS,
    cloudBright,
    cloudLit,
    cloudShade,
    cloudCover,
    shallow,
    foam,
  };
  lastT = t;
  lastState = state;
  return state;
}
