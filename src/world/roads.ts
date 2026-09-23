import { CHUNK_SIZE, CHUNK_VERTS, REGION_SIZE, VERTEX_SPACING } from '../config';
import { hash01, mix32 } from './hash';
import { landmarkForRegion } from './landmarks';
import { createNoise2, fbm } from './noise';
import { castleGate } from './structures';
import type { Landmark, LandmarkKind, WorldSampler } from './types';

export const ROAD_CHANNELS = 6;
export const ROAD_STRIDE = CHUNK_VERTS * CHUNK_VERTS;
export const ROAD_LENGTH = ROAD_STRIDE * (1 + ROAD_CHANNELS);
export const ROAD_FAR = 32;
export const ROAD_PRESENT = 0.02;
export const MAIN_HALF_WIDTH = 1.75;
export const PATH_HALF_WIDTH = 0.7;
export const SPUR_HALF_WIDTH = 0.8;
export const ROAD_MIN_HEIGHT = 0.5;
export const ROAD_MAX_SLOPE = 0.45;
export const ROAD_SLOPE_REACH = 16;
export const ROAD_SLOPE_GRID = 16;

const MAIN_FREQ = 1 / 800;
const MAIN_ROUGHNESS = 0.3;
const MAIN_WARP_FREQ = 1 / 330;
const MAIN_WARP = 55;
const PATH_FREQ = 1 / 170;
const PATH_ROUGHNESS = 0.25;
const PATH_WARP_FREQ = 1 / 150;
const PATH_WARP = 18;
const MASK_FREQ = 1 / 900;
const MASK_LOW = -0.3;
const MASK_HIGH = -0.05;
const SHORE_FULL = 1.3;
const SLOPE_FULL = 0.4;

const SPUR_MIN = 14;
const SPUR_MAX = 140;
const SPUR_BEND = 0.12;
const SPUR_RAMP = 4;
const SPUR_END = 2;
const SPUR_MARGIN = 2;
const SPUR_STEP = 6;
const SPUR_GROUND = 0.9;
const SPUR_SLOPE = 0.4;
const SPUR_GENTLE = 0.5;
const NEWTON_STEPS = 14;
const NEWTON_REACH = 60;
const NEWTON_DONE = 0.02;
const SPUR_INSET = 4;
const CASTLE_HEADING = 0.35;
export const CASTLE_KEEP = 19;
const CASTLE_KEEP_RAMP = 4;

const SPUR_START: Record<LandmarkKind, number> = {
  letter: 2.5,
  castle: 0,
  ring: 1.5,
  tree: 3.5,
  pool: 3,
  shelter: 3.5,
};

const EXT = CHUNK_VERTS + 2;
const NODE_SPACING = ROAD_SLOPE_GRID;
const NODE_STEP = NODE_SPACING / VERTEX_SPACING;
const NODE_REACH = ROAD_SLOPE_REACH / NODE_SPACING;
const INNER = CHUNK_SIZE / NODE_SPACING + 1;
const NODES = INNER + 2 * NODE_REACH;
const LATTICE = 2 * VERTEX_SPACING;
const LATTICE_NODES = CHUNK_SIZE / LATTICE + 3;

export interface Spur {
  x: number;
  z: number;
  dx: number;
  dz: number;
  length: number;
  start: number;
  bend: number;
  minX: number;
  minZ: number;
}

export interface RegionRoads {
  home: Landmark | null;
  spur: Spur | null;
}

interface Network {
  main(x: number, z: number): number;
  path(x: number, z: number): number;
  mask(x: number, z: number): number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function createNetwork(seed: number): Network {
  const warpX = createNoise2(mix32(seed, 0x40ad, 1));
  const warpZ = createNoise2(mix32(seed, 0x40ad, 2));
  const mainNoise = createNoise2(mix32(seed, 0x40ad, 3));
  const pathWarpX = createNoise2(mix32(seed, 0x40ad, 4));
  const pathWarpZ = createNoise2(mix32(seed, 0x40ad, 5));
  const pathNoise = createNoise2(mix32(seed, 0x40ad, 6));
  const maskNoise = createNoise2(mix32(seed, 0x40ad, 7));

  return {
    main(x: number, z: number): number {
      const u = x * MAIN_WARP_FREQ;
      const v = z * MAIN_WARP_FREQ;
      const qx = x + fbm(warpX, u, v, 2) * MAIN_WARP;
      const qz = z + fbm(warpZ, u, v, 2) * MAIN_WARP;
      return fbm(mainNoise, qx * MAIN_FREQ, qz * MAIN_FREQ, 2, 2, MAIN_ROUGHNESS);
    },
    path(x: number, z: number): number {
      const u = x * PATH_WARP_FREQ;
      const v = z * PATH_WARP_FREQ;
      const qx = x + pathWarpX(u, v) * PATH_WARP;
      const qz = z + pathWarpZ(u, v) * PATH_WARP;
      return fbm(pathNoise, qx * PATH_FREQ, qz * PATH_FREQ, 2, 2, PATH_ROUGHNESS);
    },
    mask(x: number, z: number): number {
      return fbm(maskNoise, x * MASK_FREQ, z * MASK_FREQ, 2);
    },
  };
}

let cachedSeed = 0;
let cachedNetwork: Network | null = null;

function networkFor(seed: number): Network {
  if (cachedNetwork === null || cachedSeed !== seed) {
    cachedNetwork = createNetwork(seed);
    cachedSeed = seed;
  }
  return cachedNetwork;
}

export function groundTaper(height: number, slope: number): number {
  return smoothstep(ROAD_MIN_HEIGHT, SHORE_FULL, height) * (1 - smoothstep(SLOPE_FULL, ROAD_MAX_SLOPE, slope));
}

function roadSlope(world: WorldSampler, x: number, z: number): number {
  const gx = (world.height(x + ROAD_SLOPE_REACH, z) - world.height(x - ROAD_SLOPE_REACH, z)) / (2 * ROAD_SLOPE_REACH);
  const gz = (world.height(x, z + ROAD_SLOPE_REACH) - world.height(x, z - ROAD_SLOPE_REACH)) / (2 * ROAD_SLOPE_REACH);
  return Math.sqrt(gx * gx + gz * gz);
}

function bulge(spur: Spur, along: number): number {
  const u = Math.min(1, Math.max(0, along / spur.length));
  return spur.bend * 4 * u * (1 - u);
}

function spurLimit(spur: Spur): number {
  return spur.length + SPUR_END + SPUR_MARGIN;
}

function spurOffset(spur: Spur, x: number, z: number): number {
  const rx = x - spur.x;
  const rz = z - spur.z;
  const along = rx * spur.dx + rz * spur.dz;
  const across = spur.dx * rz - spur.dz * rx;
  if (along < -SPUR_MARGIN || along > spurLimit(spur)) return ROAD_FAR;
  if (Math.abs(across) > ROAD_FAR + Math.abs(spur.bend)) return ROAD_FAR;
  if (x <= spur.minX || x >= spur.minX + REGION_SIZE) return ROAD_FAR;
  if (z <= spur.minZ || z >= spur.minZ + REGION_SIZE) return ROAD_FAR;
  const inside = along > 0 && along < spur.length;
  const lean = inside ? (spur.bend * 4 * (1 - (2 * along) / spur.length)) / spur.length : 0;
  const s = (across - bulge(spur, along)) / Math.sqrt(1 + lean * lean);
  return s > ROAD_FAR ? ROAD_FAR : s < -ROAD_FAR ? -ROAD_FAR : s;
}

function spurReach(spur: Spur, x: number, z: number): number {
  const along = (x - spur.x) * spur.dx + (z - spur.z) * spur.dz;
  return smoothstep(spur.start, spur.start + SPUR_RAMP, along)
    * (1 - smoothstep(spur.length, spur.length + SPUR_END, along));
}

function insideRegion(spur: Spur, x: number, z: number): boolean {
  const reach = SPUR_INSET + SPUR_HALF_WIDTH;
  return x > spur.minX + reach && x < spur.minX + REGION_SIZE - reach
    && z > spur.minZ + reach && z < spur.minZ + REGION_SIZE - reach;
}

function spurFits(world: WorldSampler, spur: Spur): boolean {
  const nx = -spur.dz;
  const nz = spur.dx;
  const tip = spur.length + SPUR_END;
  if (!insideRegion(spur, spur.x + spur.dx * tip, spur.z + spur.dz * tip)) return false;
  const steps = Math.ceil((spur.length - spur.start) / SPUR_STEP);
  let gentle = 0;
  for (let k = 0; k <= steps; k++) {
    const along = Math.min(spur.length, spur.start + k * SPUR_STEP);
    const side = bulge(spur, along);
    const x = spur.x + spur.dx * along + nx * side;
    const z = spur.z + spur.dz * along + nz * side;
    if (!insideRegion(spur, x, z)) return false;
    if (world.height(x, z) < SPUR_GROUND) return false;
    const easy = roadSlope(world, x, z) <= SPUR_SLOPE;
    if (k === steps && !easy) return false;
    if (easy) gentle++;
  }
  return gentle >= SPUR_GENTLE * (steps + 1);
}

function findSpur(
  network: Network,
  world: WorldSampler,
  home: Landmark,
  seed: number,
  rx: number,
  rz: number,
): Spur | null {
  const castle = home.kind === 'castle';
  const gate = castle ? castleGate(home) : null;
  const ox = gate !== null ? gate.x : home.x;
  const oz = gate !== null ? gate.z : home.z;
  let px = ox;
  let pz = oz;
  let settled = false;
  for (let k = 0; k < NEWTON_STEPS; k++) {
    const f = network.main(px, pz);
    const gx = (network.main(px + 1, pz) - network.main(px - 1, pz)) * 0.5;
    const gz = (network.main(px, pz + 1) - network.main(px, pz - 1)) * 0.5;
    const g2 = gx * gx + gz * gz;
    if (!(g2 > 1e-18)) return null;
    let sx = (-f * gx) / g2;
    let sz = (-f * gz) / g2;
    const step = Math.sqrt(sx * sx + sz * sz);
    if (step > NEWTON_REACH) {
      sx *= NEWTON_REACH / step;
      sz *= NEWTON_REACH / step;
    }
    px += sx;
    pz += sz;
    if (step < NEWTON_DONE) {
      settled = true;
      break;
    }
  }
  if (!settled) return null;
  const dx = px - ox;
  const dz = pz - oz;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length < SPUR_MIN || length > SPUR_MAX) return null;
  const ux = dx / length;
  const uz = dz / length;
  if (gate !== null && ux * gate.dx + uz * gate.dz < CASTLE_HEADING) return null;
  const bend = castle ? 0 : (hash01(seed, rx, rz, 0x5b0) * 2 - 1) * SPUR_BEND * length;
  const spur: Spur = {
    x: ox,
    z: oz,
    dx: ux,
    dz: uz,
    length,
    start: SPUR_START[home.kind],
    bend,
    minX: rx * REGION_SIZE,
    minZ: rz * REGION_SIZE,
  };
  return spurFits(world, spur) ? spur : null;
}

const regionMemo = new WeakMap<WorldSampler, Map<string, RegionRoads>>();

export function regionRoads(seed: number, rx: number, rz: number, world: WorldSampler): RegionRoads {
  let memo = regionMemo.get(world);
  if (memo === undefined) {
    memo = new Map();
    regionMemo.set(world, memo);
  }
  const key = `${seed}:${rx},${rz}`;
  const known = memo.get(key);
  if (known !== undefined) return known;
  const home = landmarkForRegion(seed, rx, rz, world);
  const found: RegionRoads = {
    home,
    spur: home === null ? null : findSpur(networkFor(seed), world, home, seed, rx, rz),
  };
  memo.set(key, found);
  return found;
}

const mainField = new Float64Array(EXT * EXT);
const pathField = new Float64Array(EXT * EXT);
const mainLattice = new Float64Array(LATTICE_NODES * LATTICE_NODES);
const pathLattice = new Float64Array(LATTICE_NODES * LATTICE_NODES);
const nodeHeights = new Float32Array(NODES * NODES);
const nodeSlopes = new Float64Array(INNER * INNER);
const nodeMasks = new Float64Array(INNER * INNER);

function fromLattice(lattice: Float64Array, i: number, j: number): number {
  const a = (i >> 1) + 1;
  const b = (j >> 1) + 1;
  const k = b * LATTICE_NODES + a;
  const halfX = (i & 1) === 0;
  const halfZ = (j & 1) === 0;
  if (!halfX && !halfZ) return lattice[k];
  if (halfX && !halfZ) return 0.5 * (lattice[k - 1] + lattice[k]);
  if (!halfX && halfZ) return 0.5 * (lattice[k - LATTICE_NODES] + lattice[k]);
  return 0.25 * ((lattice[k - LATTICE_NODES - 1] + lattice[k - LATTICE_NODES]) + (lattice[k - 1] + lattice[k]));
}

function blend(grid: Float64Array, n: number, tx: number, tz: number): number {
  const low = grid[n] * (1 - tx) + grid[n + 1] * tx;
  const high = grid[n + INNER] * (1 - tx) + grid[n + INNER + 1] * tx;
  return low * (1 - tz) + high * tz;
}

function centreOffset(field: Float64Array, k: number): number {
  const gx = field[k + 1] - field[k - 1];
  const gz = field[k + EXT] - field[k - EXT];
  const g = Math.sqrt(gx * gx + gz * gz) / (2 * VERTEX_SPACING);
  if (!(g > 0)) return ROAD_FAR;
  const s = field[k] / g;
  return s > ROAD_FAR ? ROAD_FAR : s < -ROAD_FAR ? -ROAD_FAR : s;
}

function edgeOf(s: number, w: number, best: number): number {
  if (!(w > ROAD_PRESENT)) return best;
  const e = Math.abs(s) - w;
  return e < best ? e : best;
}

export function buildRoads(
  seed: number,
  cx: number,
  cz: number,
  world: WorldSampler,
  ring: Float32Array,
  region: RegionRoads,
): Float32Array {
  const network = networkFor(seed);
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;

  for (let b = 0; b < LATTICE_NODES; b++) {
    const z = z0 + (b - 1) * LATTICE;
    const rim = b === 0 || b === LATTICE_NODES - 1;
    for (let a = 0; a < LATTICE_NODES; a++) {
      if (rim && (a === 0 || a === LATTICE_NODES - 1)) continue;
      const x = x0 + (a - 1) * LATTICE;
      mainLattice[b * LATTICE_NODES + a] = network.main(x, z);
      pathLattice[b * LATTICE_NODES + a] = network.path(x, z);
    }
  }
  for (let j = 0; j < EXT; j++) {
    const rim = j === 0 || j === EXT - 1;
    for (let i = 0; i < EXT; i++) {
      if (rim && (i === 0 || i === EXT - 1)) continue;
      mainField[j * EXT + i] = fromLattice(mainLattice, i, j);
      pathField[j * EXT + i] = fromLattice(pathLattice, i, j);
    }
  }

  for (let b = 0; b < NODES; b++) {
    const outerB = b < NODE_REACH || b >= NODE_REACH + INNER;
    for (let a = 0; a < NODES; a++) {
      const outerA = a < NODE_REACH || a >= NODE_REACH + INNER;
      if (outerA && outerB) continue;
      const k = b * NODES + a;
      if (!outerA && !outerB) {
        nodeHeights[k] = ring[((b - NODE_REACH) * NODE_STEP + 1) * EXT + (a - NODE_REACH) * NODE_STEP + 1];
      } else {
        nodeHeights[k] = world.height(x0 + (a - NODE_REACH) * NODE_SPACING, z0 + (b - NODE_REACH) * NODE_SPACING);
      }
    }
  }
  const across = NODE_REACH;
  const down = NODE_REACH * NODES;
  for (let b = 0; b < INNER; b++) {
    for (let a = 0; a < INNER; a++) {
      const k = (b + NODE_REACH) * NODES + a + NODE_REACH;
      const gx = (nodeHeights[k + across] - nodeHeights[k - across]) / (2 * ROAD_SLOPE_REACH);
      const gz = (nodeHeights[k + down] - nodeHeights[k - down]) / (2 * ROAD_SLOPE_REACH);
      nodeSlopes[b * INNER + a] = Math.sqrt(gx * gx + gz * gz);
      nodeMasks[b * INNER + a] = smoothstep(
        MASK_LOW,
        MASK_HIGH,
        network.mask(x0 + a * NODE_SPACING, z0 + b * NODE_SPACING),
      );
    }
  }

  const keep = region.home !== null && region.home.kind === 'castle' ? region.home : null;
  const keepReach = CASTLE_KEEP + CASTLE_KEEP_RAMP;
  const spur = region.spur;
  let spurNear = false;
  if (spur !== null) {
    const reach = spurLimit(spur) + ROAD_FAR + Math.abs(spur.bend);
    const mx = Math.max(x0 - spur.x, 0, spur.x - (x0 + CHUNK_SIZE));
    const mz = Math.max(z0 - spur.z, 0, spur.z - (z0 + CHUNK_SIZE));
    spurNear = mx * mx + mz * mz < reach * reach;
  }

  const out = new Float32Array(ROAD_LENGTH);
  for (let j = 0; j < CHUNK_VERTS; j++) {
    const z = z0 + j * VERTEX_SPACING;
    const nb = Math.min(INNER - 2, Math.floor(j / NODE_STEP));
    const tz = j / NODE_STEP - nb;
    for (let i = 0; i < CHUNK_VERTS; i++) {
      const x = x0 + i * VERTEX_SPACING;
      const v = j * CHUNK_VERTS + i;
      const k = (j + 1) * EXT + i + 1;
      const na = Math.min(INNER - 2, Math.floor(i / NODE_STEP));
      const tx = i / NODE_STEP - na;
      const n = nb * INNER + na;
      const ground = groundTaper(ring[k], blend(nodeSlopes, n, tx, tz));

      const sMain = centreOffset(mainField, k);
      const sPath = centreOffset(pathField, k);
      let wMain = 0;
      let wPath = 0;
      let sSpur = ROAD_FAR;
      let wSpur = 0;
      if (ground > 0) {
        let walls = 1;
        if (keep !== null) {
          const kx = x - keep.x;
          const kz = z - keep.z;
          const k2 = kx * kx + kz * kz;
          if (k2 < keepReach * keepReach) walls = smoothstep(CASTLE_KEEP, keepReach, Math.sqrt(k2));
        }
        wMain = MAIN_HALF_WIDTH * ground * walls;
        wPath = PATH_HALF_WIDTH * ground * walls * blend(nodeMasks, n, tx, tz);
      }
      if (spurNear && spur !== null) {
        sSpur = spurOffset(spur, x, z);
        if (ground > 0 && sSpur !== ROAD_FAR) wSpur = SPUR_HALF_WIDTH * ground * spurReach(spur, x, z);
      }

      let edge = ROAD_FAR;
      edge = edgeOf(sMain, wMain, edge);
      edge = edgeOf(sPath, wPath, edge);
      edge = edgeOf(sSpur, wSpur, edge);
      out[v] = edge;
      const c = ROAD_STRIDE + v * ROAD_CHANNELS;
      out[c] = sMain;
      out[c + 1] = wMain;
      out[c + 2] = sPath;
      out[c + 3] = wPath;
      out[c + 4] = sSpur;
      out[c + 5] = wSpur;
    }
  }
  return out;
}

export function roadEdge(roads: Float32Array, lx: number, lz: number): number {
  if (roads.length < ROAD_LENGTH) return ROAD_FAR;
  const fx = lx / VERTEX_SPACING;
  const fz = lz / VERTEX_SPACING;
  const i = Math.min(CHUNK_VERTS - 2, Math.max(0, Math.floor(fx)));
  const j = Math.min(CHUNK_VERTS - 2, Math.max(0, Math.floor(fz)));
  const tx = Math.min(1, Math.max(0, fx - i));
  const tz = Math.min(1, Math.max(0, fz - j));
  const a = ROAD_STRIDE + (j * CHUNK_VERTS + i) * ROAD_CHANNELS;
  const b = a + ROAD_CHANNELS;
  const c = a + CHUNK_VERTS * ROAD_CHANNELS;
  const d = c + ROAD_CHANNELS;
  let edge = ROAD_FAR;
  for (let o = 0; o < ROAD_CHANNELS; o += 2) {
    const s = (roads[a + o] * (1 - tx) + roads[b + o] * tx) * (1 - tz)
      + (roads[c + o] * (1 - tx) + roads[d + o] * tx) * tz;
    const w = (roads[a + o + 1] * (1 - tx) + roads[b + o + 1] * tx) * (1 - tz)
      + (roads[c + o + 1] * (1 - tx) + roads[d + o + 1] * tx) * tz;
    edge = edgeOf(s, w, edge);
  }
  return edge;
}
