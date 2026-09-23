export const GEN_VERSION = 1;

export const CHUNK_SIZE = 64;
export const VERTEX_SPACING = 2;
export const CHUNK_VERTS = CHUNK_SIZE / VERTEX_SPACING + 1;
export const RENDER_RADIUS = 6;
export const PREFETCH_RADIUS = 7;
export const KEEP_MULTIPLIER = 2;
export const BUILDS_PER_FRAME = 2;

export const FOG_NEAR = 120;
export const FOG_FAR = 360;
export const SEA_LEVEL = 0;
export const REGION_SIZE = 512;

export const EYE_HEIGHT = 1.6;
export const WALK_SPEED = 2.5;
export const STROLL_SPEED = 1.2;
export const ACCEL_TIME = 0.6;
export const DECEL_TIME = 0.4;
export const CAMERA_LAG = 0.15;
export const LOOK_SENSITIVITY = 0.0022;
export const MAX_WADE_DEPTH = 1.2;

export const CELL_W = 10;
export const CELL_H = 18;
export const CELL_MIN = [8, 14] as const;
export const CELL_MAX = [14, 26] as const;
export const SCENE_PX_PER_CELL = 2;

export const DAY_LENGTH_S = 24 * 60;
export const TWILIGHT_S = 90;

export const MATERIAL = {
  GRASS: 0,
  FOREST: 1,
  STONE: 2,
  SAND: 3,
  SNOW: 4,
  WATER: 5,
  LETTER: 6,
  NONE: 7,
} as const;
export type MaterialId = (typeof MATERIAL)[keyof typeof MATERIAL];
export const MATERIAL_COUNT = 8;

export const PROP = { TREE: 0, ROCK: 1 } as const;

export const WORKER_MIN = 2;
export const WORKER_MAX = 4;
