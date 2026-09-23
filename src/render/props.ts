import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  ShaderMaterial,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHUNK_SIZE, CHUNK_VERTS, MATERIAL, PROP, VERTEX_SPACING } from '../config';
import { mix32 } from '../world/hash';
import {
  BROADLEAF,
  CAIRN_RADIUS,
  CONE_SEGMENTS,
  DISC_SEGMENTS,
  DOOR_POST_D,
  DOOR_POST_W,
  DOOR_POST_X,
  FALLEN_LENGTH,
  FALLEN_WIDTH,
  KEEL_BEND,
  KEEL_DEPTH,
  KEEL_LENGTH,
  KEEL_WIDTH,
  PINE,
  STUMP_H,
  TOWER_SEGMENTS,
  WRECK_ARC,
  WRECK_KEEL,
  WRECK_RIBS,
  WRECK_RISE,
  WRECK_ROLL,
  cairnStones,
  doorYaw,
  fallenYaw,
  landmarkLayout,
  steppingStones,
  stumpsOf,
  traceHash,
  treeVariant,
  wreckLean,
  wreckYaw,
} from '../world/structures';
import type { Ground, Part, PartShape, TreeVariant } from '../world/structures';
import type { ChunkData } from '../world/types';
import type { GlyphAtlas } from './glyph-atlas';

function tagMaterial<T extends BufferGeometry>(geometry: T, material: number): T {
  const count = geometry.getAttribute('position').count;
  const values = new Float32Array(count);
  values.fill(material);
  geometry.setAttribute('material', new BufferAttribute(values, 1));
  return geometry;
}

function merged(parts: BufferGeometry[], name: string): BufferGeometry {
  const out = mergeGeometries(parts, false) as BufferGeometry | null;
  for (const part of parts) part.dispose();
  if (out === null) throw new Error(name + ' geometry could not be merged');
  out.computeBoundingSphere();
  return out;
}

function buildPine(): BufferGeometry {
  const trunkHeight = PINE.trunkTop - PINE.trunkBottom;
  const trunk = new BoxGeometry(PINE.trunkWidth, trunkHeight, PINE.trunkWidth);
  trunk.translate(0, PINE.trunkBottom + trunkHeight / 2, 0);
  tagMaterial(trunk, MATERIAL.TRUNK);
  const lower = new ConeGeometry(PINE.lowerRadius, PINE.lowerHeight, PINE.segments, 1, false);
  lower.translate(0, PINE.lowerBase + PINE.lowerHeight / 2, 0);
  tagMaterial(lower, MATERIAL.TREE);
  const upper = new ConeGeometry(PINE.upperRadius, PINE.upperHeight, PINE.segments, 1, true);
  upper.translate(0, PINE.upperBase + PINE.upperHeight / 2, 0);
  tagMaterial(upper, MATERIAL.TREE);
  return merged([trunk, lower, upper], 'pine');
}

function buildBroadleaf(): BufferGeometry {
  const trunkHeight = BROADLEAF.trunkTop - BROADLEAF.trunkBottom;
  const box = new BoxGeometry(BROADLEAF.trunkWidth, trunkHeight, BROADLEAF.trunkWidth);
  const trunk = box.toNonIndexed();
  box.dispose();
  trunk.translate(0, BROADLEAF.trunkBottom + trunkHeight / 2, 0);
  tagMaterial(trunk, MATERIAL.TRUNK);
  const crown = BROADLEAF.crown.map((blob) => {
    const geometry = new IcosahedronGeometry(1, 0);
    geometry.scale(blob.radius, blob.rise, blob.radius);
    geometry.translate(blob.x, blob.y, blob.z);
    return tagMaterial(geometry, MATERIAL.TREE);
  });
  return merged([trunk, ...crown], 'broadleaf');
}

function buildGable(): BufferGeometry {
  const ridgeL = [-0.5, 0.5, 0];
  const ridgeR = [0.5, 0.5, 0];
  const frontL = [-0.5, -0.5, 0.5];
  const frontR = [0.5, -0.5, 0.5];
  const backL = [-0.5, -0.5, -0.5];
  const backR = [0.5, -0.5, -0.5];
  const triangles = [
    frontL, frontR, ridgeR, frontL, ridgeR, ridgeL,
    backR, backL, ridgeL, backR, ridgeL, ridgeR,
    frontR, backR, ridgeR,
    backL, frontL, ridgeL,
    backL, backR, frontR, backL, frontR, frontL,
  ];
  const positions = new Float32Array(triangles.length * 3);
  triangles.forEach((vertex, i) => positions.set(vertex, i * 3));
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  return geometry;
}

function unitShape(shape: PartShape): BufferGeometry {
  switch (shape) {
    case 'cylinder':
      return new CylinderGeometry(0.5, 0.5, 1, TOWER_SEGMENTS);
    case 'cone':
      return new ConeGeometry(0.5, 1, CONE_SEGMENTS);
    case 'gable':
      return buildGable();
    case 'disc': {
      const disc = new CircleGeometry(0.5, DISC_SEGMENTS);
      disc.rotateX(-Math.PI / 2);
      return disc;
    }
    default:
      return new BoxGeometry(1, 1, 1);
  }
}

const UNITS = new Map<string, BufferGeometry>();

function unitGeometry(shape: PartShape, material: number): BufferGeometry {
  const key = shape + ':' + material;
  let geometry = UNITS.get(key);
  if (geometry === undefined) {
    geometry = tagMaterial(unitShape(shape), material);
    geometry.computeBoundingSphere();
    UNITS.set(key, geometry);
  }
  return geometry;
}

const PINE_GEOMETRY = buildPine();
const BROADLEAF_GEOMETRY = buildBroadleaf();
const ROCK = tagMaterial(new IcosahedronGeometry(1, 0), MATERIAL.STONE);
const LETTER_BOX = tagMaterial(new BoxGeometry(1, 1, 1), MATERIAL.LETTER);
const TRUNK_BOX = tagMaterial(new BoxGeometry(1, 1, 1), MATERIAL.TRUNK);

const TAU = Math.PI * 2;
const FIRE_RING = 8;
const FIRE_STUBS = 3;
const DOOR_PARTS = 3;
const DOOR_POST_Y = 0.95;
const DOOR_POST_H = 2.5;
const DOOR_LINTEL_Y = 2.31;
const DOOR_LINTEL = [1.6, 0.22, 0.3] as const;
const CAIRN_TAPER = 0.045;
const CAIRN_PACK = 0.92;
const STEP_GAP = 1.2;

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

function shareUniforms(base: ShaderMaterial, overrides: Record<string, number>): ShaderMaterial {
  const clone = base.clone();
  const uniforms: Record<string, { value: unknown }> = { ...base.uniforms };
  for (const key of Object.keys(overrides)) uniforms[key] = { value: overrides[key] };
  clone.uniforms = uniforms;
  return clone;
}

export function buildProps(
  data: ChunkData,
  material: ShaderMaterial,
  atlas: GlyphAtlas,
  ground?: Ground,
): Object3D {
  const group = new Object3D();
  const clones: ShaderMaterial[] = [];
  const instanced: InstancedMesh[] = [];
  const fires: Array<{ x: number; y: number; z: number; hearth: boolean }> = [];

  const props = data.props;
  const variants: TreeVariant[] = [];
  let pineCount = 0;
  let broadleafCount = 0;
  let rockCount = 0;
  let trunkCount = 0;
  let stoneCount = 0;
  for (let i = 0; i + 3 < props.length; i += 4) {
    const x = props[i];
    const z = props[i + 1];
    const kind = props[i + 2];
    if (kind === PROP.TREE) {
      const variant = treeVariant(x, z);
      variants.push(variant);
      if (variant.broadleaf) broadleafCount++;
      else pineCount++;
    } else if (kind === PROP.ROCK) rockCount++;
    else if (kind === PROP.WRECK) trunkCount += WRECK_KEEL + WRECK_RIBS;
    else if (kind === PROP.CAIRN) stoneCount += cairnStones(x, z);
    else if (kind === PROP.STEPPING) stoneCount += steppingStones(x, z);
    else if (kind === PROP.STUMPS) trunkCount += stumpsOf(x, z, props[i + 3]).length;
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

  const pines = pineCount > 0 ? new InstancedMesh(PINE_GEOMETRY, material, pineCount) : null;
  const broadleaves = broadleafCount > 0 ? new InstancedMesh(BROADLEAF_GEOMETRY, material, broadleafCount) : null;
  const rocks = rockCount > 0 ? new InstancedMesh(ROCK, material, rockCount) : null;
  const trunks = trunkCount > 0 ? new InstancedMesh(TRUNK_BOX, material, trunkCount) : null;
  const stones = stoneCount > 0 ? new InstancedMesh(ROCK, material, stoneCount) : null;

  let treeAt = 0;
  let pineAt = 0;
  let broadleafAt = 0;
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
      const variant = variants[treeAt];
      treeAt++;
      const target = variant.broadleaf ? broadleaves : pines;
      if (target === null) continue;
      const width = scale * variant.width;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, variant.yaw, 0);
      dummy.scale.set(width, scale * variant.height, width);
      dummy.updateMatrix();
      if (variant.broadleaf) {
        target.setMatrixAt(broadleafAt, dummy.matrix);
        broadleafAt++;
      } else {
        target.setMatrixAt(pineAt, dummy.matrix);
        pineAt++;
      }
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
      const lean = wreckLean(x, z);
      frame.position.set(x, y - 0.55 * scale, z);
      frame.rotation.set(lean * 0.7, wreckYaw(x, z), WRECK_ROLL + lean);
      frame.scale.setScalar(scale);
      frame.updateMatrix();
      for (let k = 0; k < WRECK_KEEL; k++) {
        const t = (2 * k) / (WRECK_KEEL - 1) - 1;
        part.position.set(t * WRECK_ARC, 0.3 + WRECK_RISE * t * t, 0);
        part.rotation.set(0, 0, t * KEEL_BEND);
        part.scale.set(KEEL_LENGTH, KEEL_DEPTH, KEEL_WIDTH);
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
      pivot.rotation.set(0, fallenYaw(x, z), 0);
      pivot.scale.setScalar(scale);
      const slab = new Mesh(LETTER_BOX, letterMaterial);
      slab.position.set(0, 0.5, 0);
      slab.rotation.set(
        (traceHash(x, z, 63) - 0.5) * 0.24,
        0,
        -Math.PI / 2 + (traceHash(x, z, 64) - 0.5) * 0.22,
      );
      slab.scale.set(FALLEN_WIDTH, FALLEN_LENGTH, FALLEN_WIDTH);
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
      frame.rotation.set(0, doorYaw(x, z), (traceHash(x, z, 69) - 0.5) * 0.12);
      frame.scale.setScalar(scale);
      frame.updateMatrix();
      for (const side of [-1, 1]) {
        part.position.set(side * DOOR_POST_X, DOOR_POST_Y, 0);
        part.rotation.set(0, 0, 0);
        part.scale.set(DOOR_POST_W, DOOR_POST_H, DOOR_POST_D);
        emit(trunks, trunkAt);
        trunkAt++;
      }
      part.position.set(0, DOOR_LINTEL_Y, 0);
      part.rotation.set(0, 0, 0);
      part.scale.set(DOOR_LINTEL[0], DOOR_LINTEL[1], DOOR_LINTEL[2]);
      emit(trunks, trunkAt);
      trunkAt++;
    } else if (kind === PROP.STUMPS) {
      if (trunks === null) continue;
      const tall = STUMP_H * scale;
      for (const stump of stumpsOf(x, z, scale)) {
        dummy.position.set(stump.x, heightAt(data, stump.x, stump.z) + tall * 0.4, stump.z);
        dummy.rotation.set(0, stump.yaw, 0);
        dummy.scale.set(stump.width, tall, stump.width);
        dummy.updateMatrix();
        trunks.setMatrixAt(trunkAt, dummy.matrix);
        trunkAt++;
      }
    }
  }

  let trees: Object3D | null = null;
  for (const mesh of [pines, broadleaves]) {
    if (mesh === null) continue;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    instanced.push(mesh);
    if (trees === null) {
      trees = new Object3D();
      group.add(trees);
    }
    trees.add(mesh);
  }

  for (const mesh of [rocks, trunks, stones]) {
    if (mesh === null) continue;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    instanced.push(mesh);
    group.add(mesh);
  }

  const landmark = data.landmark;
  if (landmark !== null) {
    const layout = landmarkLayout(landmark, ground ?? ((x, z) => heightAt(data, x, z)));
    const buckets = new Map<string, Part[]>();
    for (const piece of layout.parts) {
      const key = piece.shape + ':' + piece.material;
      const bucket = buckets.get(key);
      if (bucket === undefined) buckets.set(key, [piece]);
      else bucket.push(piece);
    }
    let letterMaterial: ShaderMaterial | null = null;
    let waterMaterial: ShaderMaterial | null = null;
    for (const bucket of buckets.values()) {
      const first = bucket[0];
      let surface = material;
      if (first.material === MATERIAL.LETTER) {
        if (letterMaterial === null) {
          const glyph = landmark.letter === null ? -1 : atlas.index.get(landmark.letter) ?? -1;
          letterMaterial = shareUniforms(material, { uLetterIndex: glyph });
          clones.push(letterMaterial);
        }
        surface = letterMaterial;
      } else if (first.material === MATERIAL.WATER) {
        if (waterMaterial === null) {
          waterMaterial = shareUniforms(material, { uIsWater: 1 });
          clones.push(waterMaterial);
        }
        surface = waterMaterial;
      }
      const mesh = new InstancedMesh(unitGeometry(first.shape, first.material), surface, bucket.length);
      for (let k = 0; k < bucket.length; k++) {
        const piece = bucket[k];
        dummy.position.set(piece.x, piece.y, piece.z);
        dummy.rotation.set(0, piece.yaw, piece.tilt);
        dummy.scale.set(piece.sx, piece.shape === 'disc' ? 1 : piece.sy, piece.sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(k, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      instanced.push(mesh);
      group.add(mesh);
    }
    for (const fire of layout.fires) fires.push({ x: fire.x, y: fire.y, z: fire.z, hearth: fire.hearth });
  }

  group.userData.pines = trees;
  group.userData.fires = fires;
  group.userData.dispose = (): void => {
    for (const clone of clones) clone.dispose();
    for (const mesh of instanced) mesh.dispose();
    group.clear();
  };

  return group;
}
