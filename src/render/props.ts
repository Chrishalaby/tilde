import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  ShaderMaterial,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHUNK_SIZE, CHUNK_VERTS, MATERIAL, PROP, VERTEX_SPACING } from '../config';
import { hash01, mix32 } from '../world/hash';
import type { ChunkData } from '../world/types';
import type { GlyphAtlas } from './glyph-atlas';

function tagMaterial<T extends BufferGeometry>(geometry: T, material: number): T {
  const count = geometry.getAttribute('position').count;
  const values = new Float32Array(count);
  values.fill(material);
  geometry.setAttribute('material', new BufferAttribute(values, 1));
  return geometry;
}

function buildPine(): BufferGeometry {
  const trunk = new BoxGeometry(0.45, 1.6, 0.45);
  trunk.translate(0, 0.8, 0);
  tagMaterial(trunk, MATERIAL.TRUNK);
  const lower = new ConeGeometry(1.15, 3.0, 6, 1, true);
  lower.translate(0, 2.8, 0);
  tagMaterial(lower, MATERIAL.TREE);
  const upper = new ConeGeometry(0.8, 4.4, 6, 1, true);
  upper.translate(0, 5.6, 0);
  tagMaterial(upper, MATERIAL.TREE);
  const merged = mergeGeometries([trunk, lower, upper], false) as BufferGeometry | null;
  trunk.dispose();
  lower.dispose();
  upper.dispose();
  if (merged === null) throw new Error('pine geometry could not be merged');
  merged.computeBoundingSphere();
  return merged;
}

const PINE = buildPine();

const ROCK = tagMaterial(new IcosahedronGeometry(1, 0), MATERIAL.STONE);
const STONE_BOX = tagMaterial(new BoxGeometry(1, 1, 1), MATERIAL.STONE);
const LETTER_BOX = tagMaterial(new BoxGeometry(1, 1, 1), MATERIAL.LETTER);

const TRUNK_BOX = tagMaterial(new BoxGeometry(1, 1, 1), MATERIAL.TRUNK);

const FIRE_BOX = tagMaterial(new BoxGeometry(1, 1, 1), MATERIAL.FIRE);

const TAU = Math.PI * 2;
const WRECK_KEEL = 5;
const WRECK_RIBS = 7;
const WRECK_ARC = 3.6;
const WRECK_RISE = 0.6;
const FIRE_RING = 8;
const FIRE_STUBS = 3;
const DOOR_PARTS = 3;
const CAIRN_BASE = 4;
const CAIRN_RADIUS = 0.3;
const CAIRN_TAPER = 0.045;
const CAIRN_PACK = 0.92;
const STEP_BASE = 5;
const STEP_GAP = 1.2;
const STUMP_BASE = 6;
const STUMP_SPAN = 5;
const STUMP_NEAR = 1.2;
const STUMP_FAR = 3.6;
const STUMP_H = 0.5;

function traceHash(x: number, z: number, salt: number, k = 0): number {
  return hash01(Math.round(x), Math.round(z), salt, k);
}

function cairnStones(x: number, z: number): number {
  return CAIRN_BASE + (traceHash(x, z, 41) < 0.5 ? 0 : 1);
}

function steppingStones(x: number, z: number): number {
  return STEP_BASE + (traceHash(x, z, 42) < 0.5 ? 0 : 1);
}

function stumpCount(x: number, z: number): number {
  return STUMP_BASE + Math.floor(traceHash(x, z, 43) * STUMP_SPAN);
}

const CASTLE_HALF = 11;
const CASTLE_WALL_H = 4;
const CASTLE_WALL_T = 1.2;
const CASTLE_GATE = 4;
const CASTLE_SINK = 1;
const CASTLE_SEGMENT = CASTLE_HALF - CASTLE_GATE / 2;
const TOWER_SIZE = 4;
const TOWER_H = 9;
const KEEP_SIZE = 8;
const KEEP_H = 12;
const KEEP_OFFSET = 5;
const TORCH_W = 0.3;
const TORCH_H = 0.5;
const POST_H = 1.2;
const POST_T = 0.18;
const GATE_TORCH_H = 2.5;
const CASTLE_STONES = 16;
const CASTLE_TORCHES = 6;
const PIT_W = 0.6;
const PIT_H = 0.3;
const PIT_OFFSET = 2.4;

const POOL_DISC = new CircleGeometry(2.5, 20);
POOL_DISC.rotateX(-Math.PI / 2);
tagMaterial(POOL_DISC, MATERIAL.WATER);

function heightAt(data: ChunkData, x: number, z: number): number {
  const n = CHUNK_VERTS;
  const fx = (x - data.cx * CHUNK_SIZE) / VERTEX_SPACING;
  const fz = (z - data.cz * CHUNK_SIZE) / VERTEX_SPACING;
  const i0 = Math.min(n - 2, Math.max(0, Math.floor(fx)));
  const j0 = Math.min(n - 2, Math.max(0, Math.floor(fz)));
  const tx = Math.min(1, Math.max(0, fx - i0));
  const tz = Math.min(1, Math.max(0, fz - j0));
  const row0 = j0 * n + i0;
  const row1 = row0 + n;
  const top = data.heights[row0] + (data.heights[row0 + 1] - data.heights[row0]) * tx;
  const bottom = data.heights[row1] + (data.heights[row1 + 1] - data.heights[row1]) * tx;
  return top + (bottom - top) * tz;
}

function sunkBlock(
  data: ChunkData,
  dummy: Object3D,
  mesh: InstancedMesh,
  at: number,
  x: number,
  z: number,
  sx: number,
  sz: number,
  base: number,
  rise: number,
): void {
  const floor = Math.min(base, heightAt(data, x, z)) - CASTLE_SINK;
  const height = Math.max(0.5, base + rise - floor);
  dummy.position.set(x, floor + height / 2, z);
  dummy.rotation.set(0, 0, 0);
  dummy.scale.set(sx, height, sz);
  dummy.updateMatrix();
  mesh.setMatrixAt(at, dummy.matrix);
}

function shareUniforms(base: ShaderMaterial, overrides: Record<string, number>): ShaderMaterial {
  const clone = base.clone();
  const uniforms: Record<string, { value: unknown }> = { ...base.uniforms };
  for (const key of Object.keys(overrides)) uniforms[key] = { value: overrides[key] };
  clone.uniforms = uniforms;
  return clone;
}

export function buildProps(data: ChunkData, material: ShaderMaterial, atlas: GlyphAtlas): Object3D {
  const group = new Object3D();
  const geometries: BufferGeometry[] = [];
  const clones: ShaderMaterial[] = [];
  const instanced: InstancedMesh[] = [];
  const fires: Array<{ x: number; y: number; z: number }> = [];

  const props = data.props;
  let treeCount = 0;
  let rockCount = 0;
  let trunkCount = 0;
  let stoneCount = 0;
  for (let i = 0; i + 3 < props.length; i += 4) {
    const x = props[i];
    const z = props[i + 1];
    const kind = props[i + 2];
    if (kind === PROP.TREE) treeCount++;
    else if (kind === PROP.ROCK) rockCount++;
    else if (kind === PROP.WRECK) trunkCount += WRECK_KEEL + WRECK_RIBS;
    else if (kind === PROP.CAIRN) stoneCount += cairnStones(x, z);
    else if (kind === PROP.STEPPING) stoneCount += steppingStones(x, z);
    else if (kind === PROP.STUMPS) trunkCount += stumpCount(x, z);
    else if (kind === PROP.DOOR) trunkCount += DOOR_PARTS;
    else if (kind === PROP.COLD_FIRE) {
      stoneCount += FIRE_RING;
      trunkCount += FIRE_STUBS;
    }
  }

  const dummy = new Object3D();
  const frame = new Object3D();
  const part = new Object3D();
  const world = new Matrix4();

  const emit = (mesh: InstancedMesh, at: number): void => {
    part.updateMatrix();
    world.multiplyMatrices(frame.matrix, part.matrix);
    mesh.setMatrixAt(at, world);
  };

  let pines: InstancedMesh | null = null;
  let rocks: InstancedMesh | null = null;
  let trunks: InstancedMesh | null = null;
  let stones: InstancedMesh | null = null;

  if (treeCount > 0) {
    pines = new InstancedMesh(PINE, material, treeCount);
  }
  if (rockCount > 0) {
    rocks = new InstancedMesh(ROCK, material, rockCount);
  }
  if (trunkCount > 0) {
    trunks = new InstancedMesh(TRUNK_BOX, material, trunkCount);
  }
  if (stoneCount > 0) {
    stones = new InstancedMesh(ROCK, material, stoneCount);
  }

  let treeAt = 0;
  let rockAt = 0;
  let trunkAt = 0;
  let stoneAt = 0;
  for (let i = 0; i + 3 < props.length; i += 4) {
    const x = props[i];
    const z = props[i + 1];
    const kind = props[i + 2];
    const scale = props[i + 3];
    const y = heightAt(data, x, z);

    if (kind === PROP.TREE) {
      if (pines === null) continue;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, (x * 0.7 + z * 1.3) % TAU, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      pines.setMatrixAt(treeAt, dummy.matrix);
      treeAt++;
    } else if (kind === PROP.ROCK) {
      if (rocks === null) continue;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, (x * 0.7 + z * 1.3) % TAU, 0);
      dummy.scale.set(scale, scale * 0.7, scale);
      dummy.updateMatrix();
      rocks.setMatrixAt(rockAt, dummy.matrix);
      rockAt++;
    } else if (kind === PROP.WRECK) {
      if (trunks === null) continue;
      const lean = (traceHash(x, z, 52) - 0.5) * 0.4;
      frame.position.set(x, y - 0.55 * scale, z);
      frame.rotation.set(lean * 0.7, traceHash(x, z, 51) * TAU, 0.18 + lean);
      frame.scale.setScalar(scale);
      frame.updateMatrix();
      for (let k = 0; k < WRECK_KEEL; k++) {
        const t = (2 * k) / (WRECK_KEEL - 1) - 1;
        part.position.set(t * WRECK_ARC, 0.3 + WRECK_RISE * t * t, 0);
        part.rotation.set(0, 0, t * 0.5);
        part.scale.set(2, 0.34, 0.5);
        emit(trunks, trunkAt);
        trunkAt++;
      }
      for (let k = 0; k < WRECK_RIBS; k++) {
        const t = (2 * k) / (WRECK_RIBS - 1) - 1;
        const tip = traceHash(x, z, 53, k) < 0.5 ? 0.75 : 1.9;
        const tilt = (k % 2 === 0 ? 1 : -1) * 0.5;
        part.position.set(
          t * (WRECK_ARC + 0.4),
          0.3 + WRECK_RISE * t * t + Math.cos(tilt) * tip * 0.5,
          Math.sin(tilt) * tip * 0.5,
        );
        part.rotation.set(tilt, 0, 0);
        part.scale.set(0.28, tip, 0.3);
        emit(trunks, trunkAt);
        trunkAt++;
      }
    } else if (kind === PROP.CAIRN) {
      if (stones === null) continue;
      const n = cairnStones(x, z);
      frame.position.set(x, y, z);
      frame.rotation.set(0, traceHash(x, z, 54) * TAU, 0);
      frame.scale.setScalar(scale);
      frame.updateMatrix();
      let rise = 0;
      for (let k = 0; k < n; k++) {
        const r = CAIRN_RADIUS - k * CAIRN_TAPER;
        const tall = r * 1.4;
        part.position.set(
          (traceHash(x, z, 55, k) - 0.5) * 0.12,
          rise + tall * 0.5,
          (traceHash(x, z, 56, k) - 0.5) * 0.12,
        );
        part.rotation.set(0, traceHash(x, z, 57, k) * TAU, 0);
        part.scale.set(r, tall * 0.5, r);
        rise += tall * CAIRN_PACK;
        emit(stones, stoneAt);
        stoneAt++;
      }
    } else if (kind === PROP.COLD_FIRE) {
      frame.position.set(x, y, z);
      frame.rotation.set(0, traceHash(x, z, 58) * TAU, 0);
      frame.scale.setScalar(scale);
      frame.updateMatrix();
      if (stones !== null) {
        for (let k = 0; k < FIRE_RING; k++) {
          const a = (k / FIRE_RING) * TAU;
          const r = 0.8 + (traceHash(x, z, 59, k) - 0.5) * 0.14;
          part.position.set(Math.cos(a) * r, 0.08, Math.sin(a) * r);
          part.rotation.set(0, a, 0);
          part.scale.set(0.17, 0.22, 0.15);
          emit(stones, stoneAt);
          stoneAt++;
        }
      }
      if (trunks !== null) {
        for (let k = 0; k < FIRE_STUBS; k++) {
          const a = traceHash(x, z, 60, k) * TAU;
          part.position.set(Math.cos(a) * 0.2, 0.07, Math.sin(a) * 0.2);
          part.rotation.set(0, a, 0);
          part.scale.set(0.9, 0.13, 0.15);
          emit(trunks, trunkAt);
          trunkAt++;
        }
      }
    } else if (kind === PROP.FALLEN) {
      const letter = String.fromCharCode(65 + (mix32(Math.round(x), Math.round(z), 61, 0) % 26));
      const glyph = atlas.index.get(letter) ?? -1;
      const letterMaterial = shareUniforms(material, { uLetterIndex: glyph });
      clones.push(letterMaterial);
      const pivot = new Object3D();
      pivot.position.set(x, y, z);
      pivot.rotation.set(0, traceHash(x, z, 62) * TAU, 0);
      pivot.scale.setScalar(scale);
      const slab = new Mesh(LETTER_BOX, letterMaterial);
      slab.position.set(0, 0.5, 0);
      slab.rotation.set(
        (traceHash(x, z, 63) - 0.5) * 0.24,
        0,
        -Math.PI / 2 + (traceHash(x, z, 64) - 0.5) * 0.22,
      );
      slab.scale.set(2, 9, 2);
      pivot.add(slab);
      group.add(pivot);
    } else if (kind === PROP.STEPPING) {
      if (stones === null) continue;
      const n = steppingStones(x, z);
      const yaw = traceHash(x, z, 65) * TAU;
      const ax = Math.cos(yaw);
      const az = Math.sin(yaw);
      for (let k = 0; k < n; k++) {
        const along = (k - (n - 1) / 2) * STEP_GAP * scale;
        const side = (traceHash(x, z, 66, k) - 0.5) * 0.5;
        const sx = x + ax * along - az * side;
        const sz = z + az * along + ax * side;
        dummy.position.set(sx, heightAt(data, sx, sz) + 0.04 * scale, sz);
        dummy.rotation.set(0, yaw + (traceHash(x, z, 67, k) - 0.5) * 0.8, 0);
        dummy.scale.set(0.5 * scale, 0.16 * scale, 0.42 * scale);
        dummy.updateMatrix();
        stones.setMatrixAt(stoneAt, dummy.matrix);
        stoneAt++;
      }
    } else if (kind === PROP.DOOR) {
      if (trunks === null) continue;
      frame.position.set(x, y, z);
      frame.rotation.set(0, traceHash(x, z, 68) * TAU, (traceHash(x, z, 69) - 0.5) * 0.12);
      frame.scale.setScalar(scale);
      frame.updateMatrix();
      for (let k = 0; k < 2; k++) {
        part.position.set(k === 0 ? -0.62 : 0.62, 0.95, 0);
        part.rotation.set(0, 0, 0);
        part.scale.set(0.22, 2.5, 0.24);
        emit(trunks, trunkAt);
        trunkAt++;
      }
      part.position.set(0, 2.31, 0);
      part.rotation.set(0, 0, 0);
      part.scale.set(1.6, 0.22, 0.3);
      emit(trunks, trunkAt);
      trunkAt++;
    } else if (kind === PROP.STUMPS) {
      if (trunks === null) continue;
      const n = stumpCount(x, z);
      const tall = STUMP_H * scale;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + (traceHash(x, z, 70, k) - 0.5) * 0.9;
        const r = (STUMP_NEAR + traceHash(x, z, 71, k) * STUMP_FAR) * scale;
        const sx = x + Math.cos(a) * r;
        const sz = z + Math.sin(a) * r;
        const w = 0.4 + traceHash(x, z, 72, k) * 0.22;
        dummy.position.set(sx, heightAt(data, sx, sz) + tall * 0.4, sz);
        dummy.rotation.set(0, traceHash(x, z, 73, k) * TAU, 0);
        dummy.scale.set(w * scale, tall, w * scale);
        dummy.updateMatrix();
        trunks.setMatrixAt(trunkAt, dummy.matrix);
        trunkAt++;
      }
    }
  }

  for (const mesh of [pines, rocks, trunks, stones]) {
    if (mesh === null) continue;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    instanced.push(mesh);
    group.add(mesh);
  }

  const landmark = data.landmark;
  if (landmark !== null) {
    if (landmark.kind === 'letter') {
      const glyph = landmark.letter === null ? -1 : atlas.index.get(landmark.letter) ?? -1;
      const letterMaterial = shareUniforms(material, { uLetterIndex: glyph });
      clones.push(letterMaterial);
      const monolith = new Mesh(LETTER_BOX, letterMaterial);
      monolith.scale.set(2, 9, 2);
      monolith.position.set(landmark.x, landmark.y + 4.5, landmark.z);
      group.add(monolith);
    } else if (landmark.kind === 'castle') {
      const mx = landmark.x;
      const mz = landmark.z;
      const base = landmark.y;
      const stones = new InstancedMesh(STONE_BOX, material, CASTLE_STONES);
      const torches = new InstancedMesh(FIRE_BOX, material, CASTLE_TORCHES);
      let at = 0;
      const wall = (x: number, z: number, sx: number, sz: number): void => {
        sunkBlock(data, dummy, stones, at, x, z, sx, sz, base, CASTLE_WALL_H);
        at++;
      };
      const span = CASTLE_HALF * 2;
      wall(mx, mz - CASTLE_HALF, span, CASTLE_WALL_T);
      wall(mx - CASTLE_HALF, mz, CASTLE_WALL_T, span);
      wall(mx + CASTLE_HALF, mz, CASTLE_WALL_T, span);
      const gateSide = CASTLE_GATE / 2 + CASTLE_SEGMENT / 2;
      wall(mx - gateSide, mz + CASTLE_HALF, CASTLE_SEGMENT, CASTLE_WALL_T);
      wall(mx + gateSide, mz + CASTLE_HALF, CASTLE_SEGMENT, CASTLE_WALL_T);
      sunkBlock(data, dummy, stones, at, mx, mz - KEEP_OFFSET, KEEP_SIZE, KEEP_SIZE, base, KEEP_H);
      at++;

      let lit = 0;
      const torch = (x: number, y: number, z: number): void => {
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(TORCH_W, TORCH_H, TORCH_W);
        dummy.updateMatrix();
        torches.setMatrixAt(lit, dummy.matrix);
        lit++;
        dummy.position.set(x, y - TORCH_H / 2 - POST_H / 2, z);
        dummy.scale.set(POST_T, POST_H, POST_T);
        dummy.updateMatrix();
        stones.setMatrixAt(at, dummy.matrix);
        at++;
        fires.push({ x, y, z });
      };

      for (let k = 0; k < 4; k++) {
        const sx = k === 0 || k === 3 ? -1 : 1;
        const sz = k < 2 ? -1 : 1;
        const tx = mx + sx * CASTLE_HALF;
        const tz = mz + sz * CASTLE_HALF;
        sunkBlock(data, dummy, stones, at, tx, tz, TOWER_SIZE, TOWER_SIZE, base, TOWER_H);
        at++;
        torch(tx, base + TOWER_H + POST_H + TORCH_H / 2, tz);
      }
      const gateZ = mz + CASTLE_HALF + CASTLE_WALL_T / 2 + TORCH_W;
      torch(mx - CASTLE_GATE / 2 - TORCH_W, base + GATE_TORCH_H, gateZ);
      torch(mx + CASTLE_GATE / 2 + TORCH_W, base + GATE_TORCH_H, gateZ);

      for (const mesh of [stones, torches]) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        instanced.push(mesh);
        group.add(mesh);
      }
    } else if (landmark.kind === 'ring') {
      const ring = new InstancedMesh(STONE_BOX, material, 8);
      for (let k = 0; k < 8; k++) {
        const angle = (k / 8) * Math.PI * 2;
        const x = landmark.x + Math.cos(angle) * 6;
        const z = landmark.z + Math.sin(angle) * 6;
        dummy.position.set(x, heightAt(data, x, z) + 1.1, z);
        dummy.rotation.set(0, -angle, 0);
        dummy.scale.set(0.9, 2.2, 0.9);
        dummy.updateMatrix();
        ring.setMatrixAt(k, dummy.matrix);
      }
      ring.instanceMatrix.needsUpdate = true;
      ring.computeBoundingSphere();
      instanced.push(ring);
      group.add(ring);
    } else if (landmark.kind === 'tree') {
      const pine = new Mesh(PINE, material);
      pine.scale.setScalar(3);
      pine.position.set(landmark.x, landmark.y, landmark.z);
      group.add(pine);
    } else if (landmark.kind === 'pool') {
      const poolMaterial = shareUniforms(material, { uIsWater: 1 });
      clones.push(poolMaterial);
      const pool = new Mesh(POOL_DISC, poolMaterial);
      pool.position.set(landmark.x, landmark.y + 0.06, landmark.z);
      group.add(pool);
    } else {
      const shelter = new InstancedMesh(STONE_BOX, material, 3);
      const base = landmark.y;
      dummy.position.set(landmark.x - 1.6, base + 1.1, landmark.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(0.5, 2.2, 2.6);
      dummy.updateMatrix();
      shelter.setMatrixAt(0, dummy.matrix);
      dummy.position.set(landmark.x + 1.6, base + 0.6, landmark.z);
      dummy.scale.set(0.5, 1.2, 2.6);
      dummy.updateMatrix();
      shelter.setMatrixAt(1, dummy.matrix);
      dummy.position.set(landmark.x, base + 1.9, landmark.z);
      dummy.rotation.set(0, 0, 0.3);
      dummy.scale.set(3.8, 0.35, 2.8);
      dummy.updateMatrix();
      shelter.setMatrixAt(2, dummy.matrix);
      shelter.instanceMatrix.needsUpdate = true;
      shelter.computeBoundingSphere();
      instanced.push(shelter);
      group.add(shelter);

      const pitX = landmark.x;
      const pitZ = landmark.z + PIT_OFFSET;
      const pitY = heightAt(data, pitX, pitZ) + PIT_H / 2;
      const pit = new Mesh(FIRE_BOX, material);
      pit.scale.set(PIT_W, PIT_H, PIT_W);
      pit.position.set(pitX, pitY, pitZ);
      group.add(pit);
      fires.push({ x: pitX, y: pitY, z: pitZ });
    }
  }

  group.userData.pines = pines;
  group.userData.fires = fires;
  group.userData.dispose = (): void => {
    for (const geometry of geometries) geometry.dispose();
    for (const clone of clones) clone.dispose();
    for (const mesh of instanced) mesh.dispose();
    group.clear();
  };

  return group;
}
