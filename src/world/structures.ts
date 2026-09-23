import { MATERIAL, PROP } from '../config';
import { hash01, mix32 } from './hash';
import type { Landmark } from './types';

export type Ground = (x: number, z: number) => number;

export type PartShape = 'box' | 'cylinder' | 'cone' | 'gable' | 'disc';

export type PartRole =
  | 'wall'
  | 'tower'
  | 'parapet'
  | 'merlon'
  | 'fallen'
  | 'rubble'
  | 'gatehouse'
  | 'lintel'
  | 'portcullis'
  | 'gate'
  | 'keep'
  | 'roof'
  | 'door'
  | 'window'
  | 'torch'
  | 'bonfire'
  | 'monolith'
  | 'standing'
  | 'trunk'
  | 'foliage'
  | 'pool'
  | 'rim'
  | 'shelter'
  | 'hearth';

export interface Part {
  role: PartRole;
  shape: PartShape;
  material: number;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  tilt: number;
  blocks: boolean;
}

export interface FireSpot {
  x: number;
  y: number;
  z: number;
  hearth: boolean;
}

export interface Layout {
  parts: Part[];
  fires: FireSpot[];
}

export interface Gate {
  x: number;
  z: number;
  dx: number;
  dz: number;
}

export interface CastleRuin {
  breachRun: number;
  breachFrom: number;
  breachTo: number;
  collapsedRun: number;
  brokenTower: number;
}

export interface TreeVariant {
  broadleaf: boolean;
  height: number;
  width: number;
  yaw: number;
}

export interface Stump {
  x: number;
  z: number;
  width: number;
  yaw: number;
}

export interface Point {
  x: number;
  z: number;
}

export interface ColliderSet {
  count: number;
  shapes: Float64Array;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  cols: number;
  rows: number;
  start: Int32Array;
  items: Int32Array;
}

export const STRUCTURE_REACH = 19;
export const SETTLE_PASSES = 4;
export const TOWER_SEGMENTS = 12;
export const CONE_SEGMENTS = 8;
export const DISC_SEGMENTS = 20;

const TAU = Math.PI * 2;
const QUARTER = Math.PI / 2;
const TURN_COS = [1, 0, -1, 0];
const TURN_SIN = [0, 1, 0, -1];
const SAMPLE_STEP = 2;
const RIM_SAMPLES = 8;
const STONE = MATERIAL.STONE;
const TRUNK = MATERIAL.TRUNK;
const FIRE = MATERIAL.FIRE;

export const PINE = {
  trunkWidth: 0.42,
  trunkBottom: -0.3,
  trunkTop: 2.5,
  lowerBase: 2.2,
  lowerHeight: 3.2,
  lowerRadius: 1.2,
  upperBase: 4.4,
  upperHeight: 4.4,
  upperRadius: 0.85,
  segments: 6,
} as const;

export const BROADLEAF = {
  trunkWidth: 0.5,
  trunkBottom: -0.3,
  trunkTop: 3.1,
  crown: [
    { x: 0, y: 4.4, z: 0, radius: 2, rise: 1.7 },
    { x: 0.95, y: 5.6, z: -0.45, radius: 1.3, rise: 1.15 },
    { x: -0.85, y: 5.3, z: 0.6, radius: 1.2, rise: 1.05 },
  ],
} as const;

const TREE_QUANT = 16;
const TALL_SHARE = 0.15;
const YOUNG_SHARE = 0.2;
const BROADLEAF_SHARE = 0.16;
const TALL_HEIGHT_MIN = 1.6;
const TALL_HEIGHT_SPAN = 0.6;
const TALL_WIDTH_MIN = 1.1;
const TALL_WIDTH_SPAN = 0.15;
const YOUNG_HEIGHT_MIN = 0.45;
const YOUNG_HEIGHT_SPAN = 0.3;
const YOUNG_WIDTH_MIN = 0.62;
const YOUNG_WIDTH_SPAN = 0.2;
const GROWN_HEIGHT_MIN = 0.85;
const GROWN_HEIGHT_SPAN = 0.4;
const GROWN_WIDTH_MIN = 0.9;
const GROWN_WIDTH_SPAN = 0.2;
const EYE_LOW = 1.2;
const EYE_HIGH = 1.9;
const FOLIAGE_GIVE = 0.2;
const SOLID_CAP = 1;

export const WRECK_KEEL = 5;
export const WRECK_RIBS = 7;
export const WRECK_ARC = 3.6;
export const WRECK_RISE = 0.6;
export const WRECK_ROLL = 0.18;
export const KEEL_LENGTH = 2;
export const KEEL_DEPTH = 0.34;
export const KEEL_WIDTH = 0.5;
export const KEEL_BEND = 0.5;
export const CAIRN_RADIUS = 0.3;
export const CAIRN_JITTER = 0.06;
export const DOOR_POST_X = 0.62;
export const DOOR_POST_W = 0.22;
export const DOOR_POST_D = 0.24;
export const FALLEN_LENGTH = 9;
export const FALLEN_WIDTH = 2;
export const STUMP_H = 0.5;

const ROCK_SOLID = 0.9;
const CAIRN_BASE = 4;
const STEP_BASE = 5;
const STUMP_BASE = 6;
const STUMP_SPAN = 5;
const STUMP_NEAR = 1.2;
const STUMP_FAR = 3.6;

const HALF = 11;
const WALL_T = 1.5;
const WALL_H = 4.8;
const WALL_TUCK = 0.2;
const SINK = 1;
const MERLON_W = 0.9;
const MERLON_H = 0.9;
const MERLON_D = 0.55;
const MERLON_STEP = 1.8;
const TOWER_R = 2.5;
const TOWER_H = 9.2;
const PARAPET_R = 2.75;
const PARAPET_H = 0.6;
const TOWER_MERLONS = 8;
const GATE_HALF = 1.8;
const FLANK_W = 3;
const FLANK_OUTER = GATE_HALF + FLANK_W;
const GATE_FRONT = 13.8;
const GATE_BACK = 8.6;
const GATE_Z = (GATE_FRONT + GATE_BACK) / 2;
const GATE_DEPTH = GATE_FRONT - GATE_BACK;
const GATE_CLEAR = 3.5;
const GATE_H = 7.6;
const GATE_ATTIC = 2.4;
const LINTEL_BITE = 0.9;
const LINTEL_D = 0.4;
const LINTEL_DROP = 0.12;
const LINTEL_H = 0.6;
const PORTCULLIS_BARS = 6;
const PORTCULLIS_EDGE = 0.3;
const PORTCULLIS_INSET = 0.5;
const PORTCULLIS_DROP = 0.75;
const BAR = 0.14;
const LEAF_T = 0.16;
const LEAF_W = 1.7;
const LEAF_H = 3.1;
const LEAF_INSET = 0.25;
const LEAF_SINK = 0.35;
const KEEP_W = 8.4;
const KEEP_D = 6.6;
const KEEP_Z = -11.8;
const KEEP_H = 11;
const BAND_H = 0.55;
const BAND_OUT = 0.18;
const ROOF_H = 3.8;
const ROOF_OVER = 0.45;
const DOOR_W = 1.5;
const DOOR_H = 2.5;
const DOOR_D = 0.16;
const SLIT_W = 0.3;
const SLIT_H = 1.25;
const SLIT_D = 0.16;
const SLIT_PROUD = 0.03;
const TOWER_SLIT_LOW = 3.4;
const TOWER_SLIT_HIGH = 6.2;
const TOWER_SLIT_TURN = Math.PI / 6;
const POST_H = 1.2;
const POST_T = 0.2;
const TORCH_W = 0.3;
const TORCH_H = 0.5;
const SCONCE_T = 0.2;
const SCONCE_REACH = 0.44;
const GATE_TORCH_X = GATE_HALF + 0.75;
const GATE_TORCH_DROP = 0.55;
const BONFIRE_STONES = 9;
const BONFIRE_RING = 1.05;
const BONFIRE_LOGS = 4;
const LOG_LENGTH = 1.4;
const LOG_T = 0.16;
const LOG_PITCH = 0.95;
const FLAME_R = 0.55;
const FLAME_H = 1.35;
const FLAME_SINK = 0.3;
const EMBER_R = 0.28;
const EMBER_H = 0.85;
const EMBERS: ReadonlyArray<readonly [number, number]> = [[0.3, 0.15], [-0.25, -0.2]];
const RUIN_CHANCE = 0.25;
const BREACH_SPREAD = 6;
const BREACH_MIN = 2.4;
const BREACH_RANGE = 1.2;
const COLLAPSE_CHANCE = 0.5;
const STUB = 1.2;
const STUB_HIGH = 0.62;
const STUB_LOW = 0.28;
const STUB_JITTER = 0.2;
const BROKEN_MIN = 0.5;
const BROKEN_RANGE = 0.12;
const TEETH = 7;
const TOOTH_GAP = 0.3;
const TOOTH_W = 1.3;
const TOOTH_D = 1;
const TOOTH_IN = 0.55;
const TOOTH_MIN = 0.4;
const TOOTH_RANGE = 1.9;
const MERLON_LOSS = 0.3;
const TOWER_MERLON_LOSS = 0.25;
const FALL_CHANCE = 0.65;
const FALL_NEAR = 0.9;
const FALL_SPAN = 1.7;
const FALL_SLIDE = 0.8;
const FALL_TILT = 0.7;
const RUBBLE = 5;
const RUBBLE_BACK = 0.6;
const RUBBLE_OUT = 2.8;
const RUBBLE_MIN = 0.6;
const RUBBLE_RANGE = 0.6;
const CASTLE_SALT = 0xca57;

const ROLL = {
  ruin: 1,
  breachRun: 2,
  breachAt: 3,
  breachWidth: 4,
  collapse: 5,
  collapseRun: 6,
  broken: 7,
  brokenHeight: 8,
  stub: 9,
  merlon: 10,
  fall: 11,
  fallOut: 12,
  fallSlide: 13,
  fallYaw: 14,
  fallTilt: 15,
  towerMerlon: 16,
  tooth: 17,
  toothRise: 18,
  toothTurn: 19,
  rubbleAt: 20,
  rubbleOut: 21,
  rubbleSize: 22,
  rubbleYaw: 23,
  rubbleTilt: 24,
} as const;

const MONOLITH_W = 2;
const MONOLITH_H = 9;
const MONOLITH_SINK = 0.6;
const RING_STONES = 8;
const RING_RADIUS = 6;
const RING_STONE_W = 0.9;
const RING_STONE_H = 2.2;
const RING_SINK = 0.4;
const LONE_TREE_SCALE = 3;
const LONE_TREE_SINK = 0.4;
const POOL_RADIUS = 2.5;
const POOL_LIFT = 0.06;
const POOL_RIM = 12;
const RIM_OUT = 0.25;
const RIM_W = 1.1;
const RIM_D = 0.45;
const RIM_SINK = 0.15;
const RIM_LIP = 0.12;
const SHELTER_SIDE = 1.6;
const SHELTER_WALL_T = 0.5;
const SHELTER_DEPTH = 2.6;
const SHELTER_HIGH = 2.2;
const SHELTER_LOW = 1.2;
const SHELTER_SINK = 0.6;
const SHELTER_ROOF_W = 3.8;
const SHELTER_ROOF_D = 2.8;
const SHELTER_ROOF_T = 0.35;
const SHELTER_ROOF_Y = 1.9;
const SHELTER_PITCH = 0.3;
const PIT_W = 0.6;
const PIT_H = 0.3;
const PIT_OFFSET = 2.4;

const GRID_CELL = 4;
const STRIDE = 7;
const CIRCLE = 0;
const BOX = 1;
const SKIN = 1e-6;

export const CASTLE = {
  half: HALF,
  wallThickness: WALL_T,
  wallHeight: WALL_H,
  towerRadius: TOWER_R,
  towerHeight: TOWER_H,
  gateHalf: GATE_HALF,
  gateFront: GATE_FRONT,
  gateBack: GATE_BACK,
  gateClear: GATE_CLEAR,
  keepFront: KEEP_Z + KEEP_D / 2,
  flameRadius: FLAME_R,
} as const;

export function treeVariant(x: number, z: number): TreeVariant {
  const qx = Math.floor(x * TREE_QUANT);
  const qz = Math.floor(z * TREE_QUANT);
  const roll = hash01(qx, qz, 91);
  const a = hash01(qx, qz, 92);
  const b = hash01(qx, qz, 93);
  const yaw = hash01(qx, qz, 94) * TAU;
  if (roll < TALL_SHARE) {
    return {
      broadleaf: false,
      height: TALL_HEIGHT_MIN + TALL_HEIGHT_SPAN * a,
      width: TALL_WIDTH_MIN + TALL_WIDTH_SPAN * b,
      yaw,
    };
  }
  if (roll < TALL_SHARE + YOUNG_SHARE) {
    return {
      broadleaf: false,
      height: YOUNG_HEIGHT_MIN + YOUNG_HEIGHT_SPAN * a,
      width: YOUNG_WIDTH_MIN + YOUNG_WIDTH_SPAN * b,
      yaw,
    };
  }
  return {
    broadleaf: hash01(qx, qz, 95) < BROADLEAF_SHARE,
    height: GROWN_HEIGHT_MIN + GROWN_HEIGHT_SPAN * a,
    width: GROWN_WIDTH_MIN + GROWN_WIDTH_SPAN * b,
    yaw,
  };
}

function coneWithin(base: number, height: number, radius: number): number {
  const top = base + height;
  const y = Math.max(EYE_LOW, base);
  if (y > EYE_HIGH || y >= top) return 0;
  return (radius * (top - y)) / height;
}

export function treeTrunkRadius(variant: TreeVariant, scale: number): number {
  const width = variant.broadleaf ? BROADLEAF.trunkWidth : PINE.trunkWidth;
  return width * Math.SQRT1_2 * scale * variant.width;
}

export function treeSolidRadius(variant: TreeVariant, scale: number): number {
  const w = scale * variant.width;
  const h = scale * variant.height;
  let foliage: number;
  if (variant.broadleaf) {
    const crown = BROADLEAF.crown[0];
    const centre = crown.y * h;
    const rise = crown.rise * h;
    const y = Math.min(EYE_HIGH, Math.max(EYE_LOW, centre));
    const t = (y - centre) / rise;
    foliage = t * t < 1 ? crown.radius * w * Math.sqrt(1 - t * t) : 0;
  } else {
    const lower = coneWithin(PINE.lowerBase * h, PINE.lowerHeight * h, PINE.lowerRadius * w);
    const upper = coneWithin(PINE.upperBase * h, PINE.upperHeight * h, PINE.upperRadius * w);
    foliage = Math.max(lower, upper);
  }
  return Math.min(SOLID_CAP, Math.max(treeTrunkRadius(variant, scale), foliage - FOLIAGE_GIVE));
}

export function traceHash(x: number, z: number, salt: number, k = 0): number {
  return hash01(Math.round(x), Math.round(z), salt, k);
}

export function cairnStones(x: number, z: number): number {
  return CAIRN_BASE + (traceHash(x, z, 41) < 0.5 ? 0 : 1);
}

export function steppingStones(x: number, z: number): number {
  return STEP_BASE + (traceHash(x, z, 42) < 0.5 ? 0 : 1);
}

export function stumpsOf(x: number, z: number, scale: number): Stump[] {
  const n = STUMP_BASE + Math.floor(traceHash(x, z, 43) * STUMP_SPAN);
  const out: Stump[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + (traceHash(x, z, 70, k) - 0.5) * 0.9;
    const r = (STUMP_NEAR + traceHash(x, z, 71, k) * STUMP_FAR) * scale;
    out.push({
      x: x + Math.cos(a) * r,
      z: z + Math.sin(a) * r,
      width: (0.4 + traceHash(x, z, 72, k) * 0.22) * scale,
      yaw: traceHash(x, z, 73, k) * TAU,
    });
  }
  return out;
}

export function wreckYaw(x: number, z: number): number {
  return traceHash(x, z, 51) * TAU;
}

export function wreckLean(x: number, z: number): number {
  return (traceHash(x, z, 52) - 0.5) * 0.4;
}

export function doorYaw(x: number, z: number): number {
  return traceHash(x, z, 68) * TAU;
}

export function fallenYaw(x: number, z: number): number {
  return traceHash(x, z, 62) * TAU;
}

interface Span {
  lo: number;
  hi: number;
}

interface Site {
  parts: Part[];
  fires: FireSpot[];
  ground(lx: number, lz: number): number;
  spanBox(lx: number, lz: number, sx: number, sz: number, yaw?: number): Span;
  spanCircle(lx: number, lz: number, radius: number): Span;
  box(
    role: PartRole,
    material: number,
    lx: number,
    lz: number,
    sx: number,
    sz: number,
    bottom: number,
    top: number,
    blocks: boolean,
    yaw?: number,
    tilt?: number,
  ): void;
  rounded(
    role: PartRole,
    shape: 'cylinder' | 'cone',
    material: number,
    lx: number,
    lz: number,
    diameter: number,
    bottom: number,
    top: number,
    blocks: boolean,
  ): void;
  gable(role: PartRole, material: number, lx: number, lz: number, sx: number, sz: number, bottom: number, top: number): void;
  disc(role: PartRole, material: number, lx: number, lz: number, diameter: number, y: number): void;
  fire(lx: number, y: number, lz: number, hearth: boolean): void;
}

function siteFor(mark: Landmark, turn: number, ground: Ground): Site {
  const c = TURN_COS[turn];
  const s = TURN_SIN[turn];
  const baseYaw = turn * QUARTER;
  const parts: Part[] = [];
  const fires: FireSpot[] = [];
  const wx = (lx: number, lz: number): number => mark.x + c * lx + s * lz;
  const wz = (lx: number, lz: number): number => mark.z - s * lx + c * lz;
  const at = (lx: number, lz: number): number => ground(wx(lx, lz), wz(lx, lz));
  const push = (
    role: PartRole,
    shape: PartShape,
    material: number,
    lx: number,
    lz: number,
    sx: number,
    sz: number,
    bottom: number,
    top: number,
    blocks: boolean,
    yaw: number,
    tilt: number,
  ): void => {
    parts.push({
      role,
      shape,
      material,
      x: wx(lx, lz),
      y: (bottom + top) / 2,
      z: wz(lx, lz),
      sx,
      sy: top - bottom,
      sz,
      yaw: baseYaw + yaw,
      tilt,
      blocks,
    });
  };
  return {
    parts,
    fires,
    ground: at,
    spanBox(lx, lz, sx, sz, yaw = 0) {
      const nx = Math.max(2, Math.ceil(sx / SAMPLE_STEP) + 1);
      const nz = Math.max(2, Math.ceil(sz / SAMPLE_STEP) + 1);
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      let lo = Infinity;
      let hi = -Infinity;
      for (let j = 0; j < nz; j++) {
        const v = (j / (nz - 1) - 0.5) * sz;
        for (let i = 0; i < nx; i++) {
          const u = (i / (nx - 1) - 0.5) * sx;
          const h = at(lx + cy * u + sy * v, lz - sy * u + cy * v);
          if (h < lo) lo = h;
          if (h > hi) hi = h;
        }
      }
      return { lo, hi };
    },
    spanCircle(lx, lz, radius) {
      let lo = at(lx, lz);
      let hi = lo;
      for (let k = 0; k < RIM_SAMPLES; k++) {
        const a = (k / RIM_SAMPLES) * TAU;
        const h = at(lx + Math.cos(a) * radius, lz + Math.sin(a) * radius);
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
      return { lo, hi };
    },
    box(role, material, lx, lz, sx, sz, bottom, top, blocks, yaw = 0, tilt = 0) {
      push(role, 'box', material, lx, lz, sx, sz, bottom, top, blocks, yaw, tilt);
    },
    rounded(role, shape, material, lx, lz, diameter, bottom, top, blocks) {
      push(role, shape, material, lx, lz, diameter, diameter, bottom, top, blocks, 0, 0);
    },
    gable(role, material, lx, lz, sx, sz, bottom, top) {
      push(role, 'gable', material, lx, lz, sx, sz, bottom, top, false, 0, 0);
    },
    disc(role, material, lx, lz, diameter, y) {
      push(role, 'disc', material, lx, lz, diameter, diameter, y, y, false, 0, 0);
    },
    fire(lx, y, lz, hearth) {
      fires.push({ x: wx(lx, lz), y, z: wz(lx, lz), hearth });
    },
  };
}

function castleId(mark: Landmark): number {
  return mix32(Math.round(mark.x), Math.round(mark.z), CASTLE_SALT);
}

export function castleTurn(mark: Landmark): number {
  return castleId(mark) & 3;
}

export function castleRuin(mark: Landmark): CastleRuin | null {
  const id = castleId(mark);
  if (hash01(id, ROLL.ruin) >= RUIN_CHANCE) return null;
  const mid = (hash01(id, ROLL.breachAt) - 0.5) * BREACH_SPREAD;
  const half = BREACH_MIN + hash01(id, ROLL.breachWidth) * BREACH_RANGE;
  return {
    breachRun: hash01(id, ROLL.breachRun) < 0.5 ? 0 : 1,
    breachFrom: mid - half,
    breachTo: mid + half,
    collapsedRun: hash01(id, ROLL.collapse) < COLLAPSE_CHANCE
      ? 2 + Math.floor(hash01(id, ROLL.collapseRun) * 4)
      : -1,
    brokenTower: Math.floor(hash01(id, ROLL.broken) * 4),
  };
}

export function castleRuined(mark: Landmark): boolean {
  return castleRuin(mark) !== null;
}

export function castleGate(mark: Landmark): Gate {
  const turn = castleTurn(mark);
  const c = TURN_COS[turn];
  const s = TURN_SIN[turn];
  return { x: mark.x + s * GATE_FRONT, z: mark.z + c * GATE_FRONT, dx: s, dz: c };
}

interface Run {
  alongX: boolean;
  at: number;
  from: number;
  to: number;
  out: number;
  crestFrom: number;
  crestTo: number;
}

type Piece = readonly [number, number, number];

const RUNS: ReadonlyArray<Run> = [
  { alongX: false, at: -HALF, from: -HALF, to: HALF, out: -1, crestFrom: -HALF + TOWER_R, crestTo: HALF - TOWER_R },
  { alongX: false, at: HALF, from: -HALF, to: HALF, out: 1, crestFrom: -HALF + TOWER_R, crestTo: HALF - TOWER_R },
  {
    alongX: true,
    at: -HALF,
    from: -HALF,
    to: -KEEP_W / 2 + WALL_TUCK,
    out: -1,
    crestFrom: -HALF + TOWER_R,
    crestTo: -KEEP_W / 2,
  },
  {
    alongX: true,
    at: -HALF,
    from: KEEP_W / 2 - WALL_TUCK,
    to: HALF,
    out: -1,
    crestFrom: KEEP_W / 2,
    crestTo: HALF - TOWER_R,
  },
  {
    alongX: true,
    at: HALF,
    from: -HALF,
    to: -FLANK_OUTER + WALL_TUCK,
    out: 1,
    crestFrom: -HALF + TOWER_R,
    crestTo: -FLANK_OUTER,
  },
  {
    alongX: true,
    at: HALF,
    from: FLANK_OUTER - WALL_TUCK,
    to: HALF,
    out: 1,
    crestFrom: FLANK_OUTER,
    crestTo: HALF - TOWER_R,
  },
];

const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [-HALF, -HALF],
  [HALF, -HALF],
  [HALF, HALF],
  [-HALF, HALF],
];

const FLANKS: ReadonlyArray<number> = [-(GATE_HALF + FLANK_W / 2), GATE_HALF + FLANK_W / 2];

function runX(run: Run, along: number, across: number): number {
  return run.alongX ? along : run.at + across;
}

function runZ(run: Run, along: number, across: number): number {
  return run.alongX ? run.at + across : along;
}

function runPieces(run: Run, index: number, ruin: CastleRuin | null, roll: (k: number, j?: number) => number): Piece[] {
  if (ruin === null) return [[run.from, run.to, 1]];
  if (index === ruin.collapsedRun) return [];
  if (index !== ruin.breachRun) return [[run.from, run.to, 1]];
  const g0 = ruin.breachFrom;
  const g1 = ruin.breachTo;
  return [
    [run.from, g0 - 2 * STUB, 1],
    [g0 - 2 * STUB, g0 - STUB, STUB_HIGH + STUB_JITTER * roll(ROLL.stub, 0)],
    [g0 - STUB, g0, STUB_LOW + STUB_JITTER * roll(ROLL.stub, 1)],
    [g1, g1 + STUB, STUB_LOW + STUB_JITTER * roll(ROLL.stub, 2)],
    [g1 + STUB, g1 + 2 * STUB, STUB_HIGH + STUB_JITTER * roll(ROLL.stub, 3)],
    [g1 + 2 * STUB, run.to, 1],
  ];
}

function standing(pieces: Piece[], a: number, b: number): boolean {
  for (const [from, to, factor] of pieces) {
    if (factor >= 1 && a >= from && b <= to) return true;
  }
  return false;
}

interface Crest {
  alongX: boolean;
  fixed: number;
  from: number;
  to: number;
  out: number;
  top: number;
  key: number;
  fall: boolean;
}

function crenellate(
  site: Site,
  crest: Crest,
  ruined: boolean,
  roll: (k: number, j?: number) => number,
  keep: (a: number, b: number) => boolean,
): void {
  const length = crest.to - crest.from;
  if (length < MERLON_W) return;
  const n = Math.floor((length - MERLON_W) / MERLON_STEP + 1e-9) + 1;
  const first = (crest.from + crest.to) / 2 - ((n - 1) * MERLON_STEP) / 2;
  const sx = crest.alongX ? MERLON_W : MERLON_D;
  const sz = crest.alongX ? MERLON_D : MERLON_W;
  for (let k = 0; k < n; k++) {
    const along = first + k * MERLON_STEP;
    if (!keep(along - MERLON_W / 2, along + MERLON_W / 2)) continue;
    const key = crest.key * 64 + k;
    if (ruined && roll(ROLL.merlon, key) < MERLON_LOSS) {
      if (!crest.fall || roll(ROLL.fall, key) >= FALL_CHANCE) continue;
      const across = crest.fixed + crest.out * (FALL_NEAR + FALL_SPAN * roll(ROLL.fallOut, key));
      const slide = along + (roll(ROLL.fallSlide, key) - 0.5) * FALL_SLIDE;
      const lx = crest.alongX ? slide : across;
      const lz = crest.alongX ? across : slide;
      const g = site.ground(lx, lz);
      site.box(
        'fallen',
        STONE,
        lx,
        lz,
        MERLON_W,
        MERLON_D,
        g - MERLON_H * 0.35,
        g + MERLON_H * 0.65,
        false,
        roll(ROLL.fallYaw, key) * TAU,
        (roll(ROLL.fallTilt, key) - 0.5) * FALL_TILT,
      );
      continue;
    }
    const lx = crest.alongX ? along : crest.fixed;
    const lz = crest.alongX ? crest.fixed : along;
    site.box('merlon', STONE, lx, lz, sx, sz, crest.top, crest.top + MERLON_H, false);
  }
}

function faceSlit(site: Site, lx: number, lz: number, facing: number, y: number): void {
  site.box(
    'window',
    TRUNK,
    lx + Math.cos(facing) * (SLIT_D / 2 - SLIT_PROUD),
    lz + Math.sin(facing) * (SLIT_D / 2 - SLIT_PROUD),
    SLIT_W,
    SLIT_D,
    y - SLIT_H / 2,
    y + SLIT_H / 2,
    false,
    QUARTER - facing,
  );
}

function towerSlit(site: Site, tx: number, tz: number, facing: number, y: number): void {
  const face = TOWER_R * Math.cos(Math.PI / TOWER_SEGMENTS);
  faceSlit(site, tx + Math.cos(facing) * face, tz + Math.sin(facing) * face, facing, y);
}

function rubble(site: Site, run: Run, from: number, to: number, key: number, roll: (k: number, j?: number) => number): void {
  for (let k = 0; k < RUBBLE; k++) {
    const j = key * 16 + k;
    const along = from + (to - from) * roll(ROLL.rubbleAt, j);
    const across = run.out * (-RUBBLE_BACK + RUBBLE_OUT * roll(ROLL.rubbleOut, j));
    const size = RUBBLE_MIN + RUBBLE_RANGE * roll(ROLL.rubbleSize, j);
    const lx = runX(run, along, across);
    const lz = runZ(run, along, across);
    const g = site.ground(lx, lz);
    site.box(
      'rubble',
      STONE,
      lx,
      lz,
      size,
      size * 0.8,
      g - 0.25,
      g + size * 0.4,
      false,
      roll(ROLL.rubbleYaw, j) * TAU,
      (roll(ROLL.rubbleTilt, j) - 0.5) * 0.5,
    );
  }
}

function castle(mark: Landmark, ground: Ground): Layout {
  const id = castleId(mark);
  const roll = (k: number, j = 0): number => hash01(id, k, j);
  const ruin = castleRuin(mark);
  const ruined = ruin !== null;
  const site = siteFor(mark, id & 3, ground);

  const runSpans = RUNS.map((run) => {
    const along = (run.from + run.to) / 2;
    const length = run.to - run.from;
    return site.spanBox(
      runX(run, along, 0),
      runZ(run, along, 0),
      run.alongX ? length : WALL_T,
      run.alongX ? WALL_T : length,
    );
  });
  const towerSpans = CORNERS.map(([tx, tz]) => site.spanCircle(tx, tz, TOWER_R));
  const flankSpans = FLANKS.map((fx) => site.spanBox(fx, GATE_Z, FLANK_W, GATE_DEPTH));
  const passage = site.spanBox(0, GATE_Z, 2 * GATE_HALF, GATE_DEPTH);
  const keepSpan = site.spanBox(0, KEEP_Z, KEEP_W, KEEP_D);
  let datum = mark.y;
  for (const span of [...runSpans, ...towerSpans, ...flankSpans, passage, keepSpan]) datum = Math.max(datum, span.hi);
  const wallTop = datum + WALL_H;

  for (let r = 0; r < RUNS.length; r++) {
    const run = RUNS[r];
    const pieces = runPieces(run, r, ruin, roll);
    for (const [a, b, factor] of pieces) {
      const along = (a + b) / 2;
      const length = b - a;
      const lx = runX(run, along, 0);
      const lz = runZ(run, along, 0);
      const sx = run.alongX ? length : WALL_T;
      const sz = run.alongX ? WALL_T : length;
      const span = site.spanBox(lx, lz, sx, sz);
      site.box('wall', STONE, lx, lz, sx, sz, span.lo - SINK, datum + WALL_H * factor, true);
    }
    crenellate(
      site,
      {
        alongX: run.alongX,
        fixed: run.at + run.out * (WALL_T / 2 - MERLON_D / 2),
        from: run.crestFrom,
        to: run.crestTo,
        out: run.out,
        top: wallTop,
        key: r,
        fall: true,
      },
      ruined,
      roll,
      (a, b) => standing(pieces, a, b),
    );
    if (ruin !== null && r === ruin.breachRun) rubble(site, run, ruin.breachFrom, ruin.breachTo, r, roll);
    if (ruin !== null && r === ruin.collapsedRun) rubble(site, run, run.crestFrom, run.crestTo, r, roll);
  }

  for (let k = 0; k < CORNERS.length; k++) {
    const [tx, tz] = CORNERS[k];
    const broken = ruin !== null && ruin.brokenTower === k;
    const top = broken
      ? datum + TOWER_H * (BROKEN_MIN + BROKEN_RANGE * roll(ROLL.brokenHeight))
      : datum + TOWER_H;
    const facing = Math.atan2(tz, tx);
    towerSlit(site, tx, tz, facing, datum + TOWER_SLIT_LOW);
    if (broken) {
      site.rounded('tower', 'cylinder', STONE, tx, tz, 2 * TOWER_R, towerSpans[k].lo - SINK, top, true);
      const twist = roll(ROLL.toothTurn, k) * TAU;
      for (let m = 0; m < TEETH; m++) {
        const j = k * 16 + m;
        if (roll(ROLL.tooth, j) < TOOTH_GAP) continue;
        const angle = twist + (m / TEETH) * TAU;
        const r = TOWER_R - TOOTH_IN;
        site.box(
          'tower',
          STONE,
          tx + Math.cos(angle) * r,
          tz + Math.sin(angle) * r,
          TOOTH_W,
          TOOTH_D,
          top - 0.2,
          top + TOOTH_MIN + TOOTH_RANGE * roll(ROLL.toothRise, j),
          false,
          QUARTER - angle,
        );
      }
      continue;
    }
    site.rounded('tower', 'cylinder', STONE, tx, tz, 2 * TOWER_R, towerSpans[k].lo - SINK, top - PARAPET_H, true);
    site.rounded('parapet', 'cylinder', STONE, tx, tz, 2 * PARAPET_R, top - PARAPET_H, top, false);
    towerSlit(site, tx, tz, facing + TOWER_SLIT_TURN, datum + TOWER_SLIT_HIGH);
    for (let m = 0; m < TOWER_MERLONS; m++) {
      if (ruined && roll(ROLL.towerMerlon, k * 16 + m) < TOWER_MERLON_LOSS) continue;
      const angle = ((m + 0.5) / TOWER_MERLONS) * TAU;
      const r = PARAPET_R - MERLON_D / 2;
      site.box(
        'merlon',
        STONE,
        tx + Math.cos(angle) * r,
        tz + Math.sin(angle) * r,
        MERLON_W,
        MERLON_D,
        top,
        top + MERLON_H,
        false,
        QUARTER - angle,
      );
    }
    site.box('torch', STONE, tx, tz, POST_T, POST_T, top, top + POST_H, false);
    site.box('torch', FIRE, tx, tz, TORCH_W, TORCH_W, top + POST_H, top + POST_H + TORCH_H, false);
    site.fire(tx, top + POST_H + TORCH_H / 2, tz, false);
  }

  const lintel = passage.hi + GATE_CLEAR;
  const gateTop = Math.max(datum + GATE_H, lintel + GATE_ATTIC);
  for (let f = 0; f < FLANKS.length; f++) {
    site.box('gatehouse', STONE, FLANKS[f], GATE_Z, FLANK_W, GATE_DEPTH, flankSpans[f].lo - SINK, gateTop, true);
  }
  site.box('gatehouse', STONE, 0, GATE_Z, 2 * GATE_HALF, GATE_DEPTH, lintel, gateTop, false);
  for (const face of [GATE_FRONT, GATE_BACK]) {
    site.box(
      'lintel',
      STONE,
      0,
      face,
      2 * GATE_HALF + LINTEL_BITE,
      LINTEL_D,
      lintel - LINTEL_DROP,
      lintel + LINTEL_H,
      false,
    );
  }
  const gateCrests: Crest[] = [
    { alongX: true, fixed: GATE_FRONT - MERLON_D / 2, from: -FLANK_OUTER, to: FLANK_OUTER, out: 1, top: gateTop, key: 8, fall: true },
    { alongX: true, fixed: GATE_BACK + MERLON_D / 2, from: -FLANK_OUTER, to: FLANK_OUTER, out: -1, top: gateTop, key: 9, fall: true },
    {
      alongX: false,
      fixed: -FLANK_OUTER + MERLON_D / 2,
      from: GATE_BACK + MERLON_D,
      to: GATE_FRONT - MERLON_D,
      out: -1,
      top: gateTop,
      key: 10,
      fall: false,
    },
    {
      alongX: false,
      fixed: FLANK_OUTER - MERLON_D / 2,
      from: GATE_BACK + MERLON_D,
      to: GATE_FRONT - MERLON_D,
      out: 1,
      top: gateTop,
      key: 11,
      fall: false,
    },
  ];
  for (const crest of gateCrests) crenellate(site, crest, ruined, roll, () => true);

  if (!ruined) {
    const pitch = (2 * (GATE_HALF - PORTCULLIS_EDGE)) / (PORTCULLIS_BARS - 1);
    const pz = GATE_FRONT - PORTCULLIS_INSET;
    for (let b = 0; b < PORTCULLIS_BARS; b++) {
      site.box('portcullis', TRUNK, -GATE_HALF + PORTCULLIS_EDGE + b * pitch, pz, BAR, BAR, lintel - PORTCULLIS_DROP, lintel + 0.2, false);
    }
    const rail = lintel - PORTCULLIS_DROP + 0.2;
    site.box('portcullis', TRUNK, 0, pz, 2 * GATE_HALF - 0.1, BAR, rail, rail + BAR, false);
    for (const side of [-1, 1]) {
      const lx = side * (GATE_HALF - LEAF_T / 2);
      const lz = GATE_BACK + LEAF_INSET + LEAF_W / 2;
      const span = site.spanBox(lx, lz, LEAF_T, LEAF_W);
      site.box('gate', TRUNK, lx, lz, LEAF_T, LEAF_W, span.lo - LEAF_SINK, Math.min(lintel - 0.2, span.lo + LEAF_H), true);
    }
  }

  for (const side of [-1, 1]) {
    const tx = side * GATE_TORCH_X;
    const flame = lintel - GATE_TORCH_DROP;
    site.box('torch', STONE, tx, GATE_FRONT + SCONCE_REACH / 2 - 0.02, SCONCE_T, SCONCE_REACH, flame - 0.5, flame - 0.28, false);
    site.box('torch', FIRE, tx, GATE_FRONT + 0.3, TORCH_W, TORCH_W, flame - TORCH_H / 2, flame + TORCH_H / 2, false);
    site.fire(tx, flame, GATE_FRONT + 0.3, false);
  }

  const front = KEEP_Z + KEEP_D / 2;
  const back = KEEP_Z - KEEP_D / 2;
  site.box('keep', STONE, 0, KEEP_Z, KEEP_W, KEEP_D, keepSpan.lo - SINK, datum + KEEP_H - BAND_H, true);
  site.box(
    'keep',
    STONE,
    0,
    KEEP_Z,
    KEEP_W + 2 * BAND_OUT,
    KEEP_D + 2 * BAND_OUT,
    datum + KEEP_H - BAND_H,
    datum + KEEP_H,
    false,
  );
  site.gable(
    'roof',
    TRUNK,
    0,
    KEEP_Z,
    KEEP_W + 2 * ROOF_OVER,
    KEEP_D + 2 * ROOF_OVER,
    datum + KEEP_H,
    datum + KEEP_H + ROOF_H,
  );
  const doorGround = site.ground(0, front + 0.6);
  site.box('door', TRUNK, 0, front + DOOR_D / 2 - 0.04, DOOR_W, DOOR_D, doorGround - 0.3, doorGround + DOOR_H, false);
  faceSlit(site, -2.3, front, QUARTER, datum + 6.8);
  faceSlit(site, 2.3, front, QUARTER, datum + 6.8);
  faceSlit(site, 0, front, QUARTER, datum + 4.6);
  faceSlit(site, -1.9, back, -QUARTER, datum + 7.2);
  faceSlit(site, 1.9, back, -QUARTER, datum + 7.2);
  faceSlit(site, KEEP_W / 2, KEEP_Z, 0, datum + 6.2);
  faceSlit(site, -KEEP_W / 2, KEEP_Z, Math.PI, datum + 6.2);

  const hearth = site.ground(0, 0);
  for (let k = 0; k < BONFIRE_STONES; k++) {
    const angle = (k / BONFIRE_STONES) * TAU + 0.2;
    const lx = Math.cos(angle) * BONFIRE_RING;
    const lz = Math.sin(angle) * BONFIRE_RING;
    const g = site.ground(lx, lz);
    site.box('bonfire', STONE, lx, lz, 0.42, 0.3, g - 0.12, g + 0.16, false, QUARTER - angle);
  }
  const reach = (LOG_LENGTH / 2) * Math.cos(LOG_PITCH);
  const rise = (LOG_LENGTH / 2) * Math.sin(LOG_PITCH);
  for (let k = 0; k < BONFIRE_LOGS; k++) {
    const angle = ((k + 0.5) / BONFIRE_LOGS) * TAU;
    site.box(
      'bonfire',
      TRUNK,
      Math.cos(angle) * reach,
      Math.sin(angle) * reach,
      LOG_LENGTH,
      LOG_T,
      hearth + rise - LOG_T / 2,
      hearth + rise + LOG_T / 2,
      false,
      -angle,
      -LOG_PITCH,
    );
  }
  const flameBed = site.spanCircle(0, 0, FLAME_R);
  site.rounded('bonfire', 'cone', FIRE, 0, 0, 2 * FLAME_R, flameBed.lo - FLAME_SINK, hearth + FLAME_H, true);
  for (const [ex, ez] of EMBERS) {
    site.rounded('bonfire', 'cone', FIRE, ex, ez, 2 * EMBER_R, hearth + 0.02, hearth + EMBER_H, false);
  }
  site.fire(0, hearth + FLAME_H * 0.6, 0, true);

  return { parts: site.parts, fires: site.fires };
}

function monolith(mark: Landmark, ground: Ground): Layout {
  const site = siteFor(mark, 0, ground);
  const span = site.spanBox(0, 0, MONOLITH_W, MONOLITH_W);
  site.box(
    'monolith',
    MATERIAL.LETTER,
    0,
    0,
    MONOLITH_W,
    MONOLITH_W,
    span.lo - MONOLITH_SINK,
    Math.max(mark.y, span.hi) + MONOLITH_H,
    true,
  );
  return { parts: site.parts, fires: site.fires };
}

function ring(mark: Landmark, ground: Ground): Layout {
  const site = siteFor(mark, 0, ground);
  for (let k = 0; k < RING_STONES; k++) {
    const angle = (k / RING_STONES) * TAU;
    const lx = Math.cos(angle) * RING_RADIUS;
    const lz = Math.sin(angle) * RING_RADIUS;
    const span = site.spanBox(lx, lz, RING_STONE_W, RING_STONE_W, -angle);
    site.box(
      'standing',
      STONE,
      lx,
      lz,
      RING_STONE_W,
      RING_STONE_W,
      span.lo - RING_SINK,
      site.ground(lx, lz) + RING_STONE_H,
      true,
      -angle,
    );
  }
  return { parts: site.parts, fires: site.fires };
}

function loneTree(mark: Landmark, ground: Ground): Layout {
  const site = siteFor(mark, 0, ground);
  const s = LONE_TREE_SCALE;
  const w = PINE.trunkWidth * s;
  const span = site.spanBox(0, 0, w, w);
  const y = mark.y;
  site.box(
    'trunk',
    TRUNK,
    0,
    0,
    w,
    w,
    Math.min(span.lo - LONE_TREE_SINK, y + PINE.trunkBottom * s),
    y + PINE.trunkTop * s,
    true,
  );
  site.rounded(
    'foliage',
    'cone',
    MATERIAL.TREE,
    0,
    0,
    2 * PINE.lowerRadius * s,
    y + PINE.lowerBase * s,
    y + (PINE.lowerBase + PINE.lowerHeight) * s,
    false,
  );
  site.rounded(
    'foliage',
    'cone',
    MATERIAL.TREE,
    0,
    0,
    2 * PINE.upperRadius * s,
    y + PINE.upperBase * s,
    y + (PINE.upperBase + PINE.upperHeight) * s,
    false,
  );
  return { parts: site.parts, fires: site.fires };
}

function pool(mark: Landmark, ground: Ground): Layout {
  const site = siteFor(mark, 0, ground);
  const surface = mark.y + POOL_LIFT;
  site.disc('pool', MATERIAL.WATER, 0, 0, 2 * POOL_RADIUS, surface);
  for (let k = 0; k < POOL_RIM; k++) {
    const angle = ((k + 0.5) / POOL_RIM) * TAU;
    const lx = Math.cos(angle) * (POOL_RADIUS + RIM_OUT);
    const lz = Math.sin(angle) * (POOL_RADIUS + RIM_OUT);
    const g = site.ground(lx, lz);
    site.box('rim', MATERIAL.STONE, lx, lz, RIM_W, RIM_D, g - RIM_SINK, Math.max(g + RIM_LIP, surface + POOL_LIFT), false, QUARTER - angle);
  }
  return { parts: site.parts, fires: site.fires };
}

function shelter(mark: Landmark, ground: Ground): Layout {
  const site = siteFor(mark, 0, ground);
  const left = site.spanBox(-SHELTER_SIDE, 0, SHELTER_WALL_T, SHELTER_DEPTH);
  const right = site.spanBox(SHELTER_SIDE, 0, SHELTER_WALL_T, SHELTER_DEPTH);
  const datum = Math.max(mark.y, left.hi, right.hi);
  site.box('shelter', STONE, -SHELTER_SIDE, 0, SHELTER_WALL_T, SHELTER_DEPTH, left.lo - SHELTER_SINK, datum + SHELTER_HIGH, true);
  site.box('shelter', STONE, SHELTER_SIDE, 0, SHELTER_WALL_T, SHELTER_DEPTH, right.lo - SHELTER_SINK, datum + SHELTER_LOW, true);
  site.box(
    'roof',
    TRUNK,
    0,
    0,
    SHELTER_ROOF_W,
    SHELTER_ROOF_D,
    datum + SHELTER_ROOF_Y - SHELTER_ROOF_T / 2,
    datum + SHELTER_ROOF_Y + SHELTER_ROOF_T / 2,
    false,
    0,
    -SHELTER_PITCH,
  );
  const g = site.ground(0, PIT_OFFSET);
  site.box('hearth', FIRE, 0, PIT_OFFSET, PIT_W, PIT_W, g, g + PIT_H, false);
  site.fire(0, g + PIT_H / 2, PIT_OFFSET, true);
  return { parts: site.parts, fires: site.fires };
}

export function landmarkLayout(mark: Landmark, ground: Ground): Layout {
  switch (mark.kind) {
    case 'letter':
      return monolith(mark, ground);
    case 'castle':
      return castle(mark, ground);
    case 'ring':
      return ring(mark, ground);
    case 'tree':
      return loneTree(mark, ground);
    case 'pool':
      return pool(mark, ground);
    case 'shelter':
      return shelter(mark, ground);
    default:
      return { parts: [], fires: [] };
  }
}

function pushCircle(out: number[], x: number, z: number, radius: number): void {
  out.push(CIRCLE, x, z, radius, radius, 1, 0);
}

function pushBox(out: number[], x: number, z: number, hx: number, hz: number, yaw: number): void {
  out.push(BOX, x, z, hx, hz, Math.cos(yaw), Math.sin(yaw));
}

export function partCollider(part: Part, out: number[]): void {
  if (part.shape === 'box' || part.shape === 'gable') pushBox(out, part.x, part.z, part.sx / 2, part.sz / 2, part.yaw);
  else pushCircle(out, part.x, part.z, Math.max(part.sx, part.sz) / 2);
}

export function propColliders(x: number, z: number, kind: number, scale: number, out: number[]): void {
  if (kind === PROP.TREE) {
    pushCircle(out, x, z, treeSolidRadius(treeVariant(x, z), scale));
  } else if (kind === PROP.ROCK) {
    pushCircle(out, x, z, ROCK_SOLID * scale);
  } else if (kind === PROP.CAIRN) {
    pushCircle(out, x, z, (CAIRN_RADIUS + CAIRN_JITTER) * scale);
  } else if (kind === PROP.FALLEN) {
    pushBox(out, x, z, (FALLEN_LENGTH / 2) * scale, (FALLEN_WIDTH / 2) * scale, fallenYaw(x, z));
  } else if (kind === PROP.DOOR) {
    const yaw = doorYaw(x, z);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (const side of [-1, 1]) {
      const offset = side * DOOR_POST_X * scale;
      pushBox(out, x + c * offset, z - s * offset, (DOOR_POST_W / 2) * scale, (DOOR_POST_D / 2) * scale, yaw);
    }
  } else if (kind === PROP.WRECK) {
    const span = WRECK_ARC + (KEEL_LENGTH / 2) * Math.cos(KEEL_BEND);
    const roll = WRECK_ROLL + wreckLean(x, z);
    pushBox(out, x, z, span * scale * Math.abs(Math.cos(roll)), (KEEL_WIDTH / 2) * scale, wreckYaw(x, z));
  } else if (kind === PROP.STUMPS) {
    for (const stump of stumpsOf(x, z, scale)) pushCircle(out, stump.x, stump.z, stump.width * Math.SQRT1_2);
  }
}

export function landmarkColliders(mark: Landmark, out: number[]): void {
  const layout = landmarkLayout(mark, () => mark.y);
  for (const part of layout.parts) if (part.blocks) partCollider(part, out);
}

function cellOf(value: number, min: number, last: number): number {
  const cell = Math.floor((value - min) / GRID_CELL);
  return cell < 0 ? 0 : cell > last ? last : cell;
}

export function packColliders(list: number[]): ColliderSet {
  const count = Math.floor(list.length / STRIDE);
  const shapes = new Float64Array(list.slice(0, count * STRIDE));
  if (count === 0) {
    return {
      count: 0,
      shapes,
      minX: 0,
      minZ: 0,
      maxX: 0,
      maxZ: 0,
      cols: 0,
      rows: 0,
      start: new Int32Array(1),
      items: new Int32Array(0),
    };
  }
  const bounds = new Float64Array(count * 4);
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const o = i * STRIDE;
    let ex = shapes[o + 3];
    let ez = shapes[o + 4];
    if (shapes[o] === BOX) {
      const c = Math.abs(shapes[o + 5]);
      const s = Math.abs(shapes[o + 6]);
      ex = shapes[o + 3] * c + shapes[o + 4] * s;
      ez = shapes[o + 3] * s + shapes[o + 4] * c;
    }
    const b = i * 4;
    bounds[b] = shapes[o + 1] - ex;
    bounds[b + 1] = shapes[o + 2] - ez;
    bounds[b + 2] = shapes[o + 1] + ex;
    bounds[b + 3] = shapes[o + 2] + ez;
    if (bounds[b] < minX) minX = bounds[b];
    if (bounds[b + 1] < minZ) minZ = bounds[b + 1];
    if (bounds[b + 2] > maxX) maxX = bounds[b + 2];
    if (bounds[b + 3] > maxZ) maxZ = bounds[b + 3];
  }
  const cols = Math.max(1, Math.ceil((maxX - minX) / GRID_CELL));
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / GRID_CELL));
  const cells = cols * rows;
  const reach = new Int32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const b = i * 4;
    reach[b] = cellOf(bounds[b], minX, cols - 1);
    reach[b + 1] = cellOf(bounds[b + 1], minZ, rows - 1);
    reach[b + 2] = cellOf(bounds[b + 2], minX, cols - 1);
    reach[b + 3] = cellOf(bounds[b + 3], minZ, rows - 1);
  }
  const start = new Int32Array(cells + 1);
  for (let i = 0; i < count; i++) {
    const b = i * 4;
    for (let row = reach[b + 1]; row <= reach[b + 3]; row++) {
      for (let col = reach[b]; col <= reach[b + 2]; col++) start[row * cols + col + 1]++;
    }
  }
  for (let c = 1; c <= cells; c++) start[c] += start[c - 1];
  const fill = start.slice(0, cells);
  const items = new Int32Array(start[cells]);
  for (let i = 0; i < count; i++) {
    const b = i * 4;
    for (let row = reach[b + 1]; row <= reach[b + 3]; row++) {
      for (let col = reach[b]; col <= reach[b + 2]; col++) items[fill[row * cols + col]++] = i;
    }
  }
  return { count, shapes, minX, minZ, maxX, maxZ, cols, rows, start, items };
}

export function chunkColliders(props: Float32Array, landmark: Landmark | null): ColliderSet {
  const list: number[] = [];
  for (let i = 0; i + 3 < props.length; i += 4) propColliders(props[i], props[i + 1], props[i + 2], props[i + 3], list);
  if (landmark !== null) landmarkColliders(landmark, list);
  return packColliders(list);
}

function resolveOne(shapes: Float64Array, index: number, at: Point, radius: number): boolean {
  const o = index * STRIDE;
  const cx = shapes[o + 1];
  const cz = shapes[o + 2];
  const a = shapes[o + 3];
  const dx = at.x - cx;
  const dz = at.z - cz;
  if (shapes[o] === CIRCLE) {
    const reach = a + radius;
    const d2 = dx * dx + dz * dz;
    if (d2 >= reach * reach) return false;
    const d = Math.sqrt(d2);
    if (d > SKIN) {
      const k = (reach + SKIN) / d;
      at.x = cx + dx * k;
      at.z = cz + dz * k;
    } else {
      at.x = cx + reach + SKIN;
    }
    return true;
  }
  const b = shapes[o + 4];
  const cos = shapes[o + 5];
  const sin = shapes[o + 6];
  const lx = cos * dx - sin * dz;
  const lz = sin * dx + cos * dz;
  if (lx >= a + radius || lx <= -a - radius || lz >= b + radius || lz <= -b - radius) return false;
  const qx = lx < -a ? -a : lx > a ? a : lx;
  const qz = lz < -b ? -b : lz > b ? b : lz;
  const ex = lx - qx;
  const ez = lz - qz;
  const e2 = ex * ex + ez * ez;
  let nx: number;
  let nz: number;
  if (e2 > 0) {
    if (e2 >= radius * radius) return false;
    const e = Math.sqrt(e2);
    const k = (radius + SKIN) / e;
    nx = qx + ex * k;
    nz = qz + ez * k;
  } else if (a - Math.abs(lx) < b - Math.abs(lz)) {
    nx = (lx < 0 ? -1 : 1) * (a + radius + SKIN);
    nz = lz;
  } else {
    nx = lx;
    nz = (lz < 0 ? -1 : 1) * (b + radius + SKIN);
  }
  at.x = cx + cos * nx + sin * nz;
  at.z = cz - sin * nx + cos * nz;
  return true;
}

export function pushOut(set: ColliderSet, at: Point, radius: number): boolean {
  if (set.count === 0) return false;
  const x = at.x;
  const z = at.z;
  if (x + radius < set.minX || x - radius > set.maxX || z + radius < set.minZ || z - radius > set.maxZ) return false;
  const c0 = cellOf(x - radius, set.minX, set.cols - 1);
  const c1 = cellOf(x + radius, set.minX, set.cols - 1);
  const r0 = cellOf(z - radius, set.minZ, set.rows - 1);
  const r1 = cellOf(z + radius, set.minZ, set.rows - 1);
  let hit = false;
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const cell = row * set.cols + col;
      const end = set.start[cell + 1];
      for (let k = set.start[cell]; k < end; k++) {
        if (resolveOne(set.shapes, set.items[k], at, radius)) hit = true;
      }
    }
  }
  return hit;
}

export function settle(sets: ReadonlyArray<ColliderSet>, x: number, z: number, radius: number): Point {
  const at = { x, z };
  for (let pass = 0; pass < SETTLE_PASSES; pass++) {
    let hit = false;
    for (let i = 0; i < sets.length; i++) if (pushOut(sets[i], at, radius)) hit = true;
    if (!hit) break;
  }
  return at;
}
