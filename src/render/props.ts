import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  Object3D,
  ShaderMaterial,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHUNK_SIZE, CHUNK_VERTS, MATERIAL, PROP, VERTEX_SPACING } from '../config';
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

  const props = data.props;
  let treeCount = 0;
  let rockCount = 0;
  for (let i = 0; i + 3 < props.length; i += 4) {
    if (props[i + 2] === PROP.TREE) treeCount++;
    else rockCount++;
  }

  const dummy = new Object3D();

  let pines: InstancedMesh | null = null;
  let rocks: InstancedMesh | null = null;

  if (treeCount > 0) {
    pines = new InstancedMesh(PINE, material, treeCount);
  }
  if (rockCount > 0) {
    rocks = new InstancedMesh(ROCK, material, rockCount);
  }

  let treeAt = 0;
  let rockAt = 0;
  for (let i = 0; i + 3 < props.length; i += 4) {
    const x = props[i];
    const z = props[i + 1];
    const kind = props[i + 2];
    const scale = props[i + 3];
    const y = heightAt(data, x, z);

    dummy.position.set(x, y, z);
    dummy.rotation.set(0, (x * 0.7 + z * 1.3) % (Math.PI * 2), 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();

    if (kind === PROP.TREE && pines !== null) {
      pines.setMatrixAt(treeAt, dummy.matrix);
      treeAt++;
    } else if (rocks !== null) {
      dummy.scale.set(scale, scale * 0.7, scale);
      dummy.updateMatrix();
      rocks.setMatrixAt(rockAt, dummy.matrix);
      rockAt++;
    }
  }

  for (const mesh of [pines, rocks]) {
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
    }
  }

  group.userData.pines = pines;
  group.userData.dispose = (): void => {
    for (const geometry of geometries) geometry.dispose();
    for (const clone of clones) clone.dispose();
    for (const mesh of instanced) mesh.dispose();
    group.clear();
  };

  return group;
}
