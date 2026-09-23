import {
  BufferAttribute,
  BufferGeometry,
  FrontSide,
  GLSL3,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import terrainVert from './shaders/terrain.vert.glsl?raw';
import terrainFrag from './shaders/terrain.frag.glsl?raw';
import { CHUNK_SIZE, CHUNK_VERTS, FOG_FAR, FOG_NEAR, MATERIAL, SEA_LEVEL, VERTEX_SPACING } from '../config';
import type { ChunkData } from '../world/types';

export function buildTerrainGeometry(data: ChunkData): BufferGeometry {
  const n = CHUNK_VERTS;
  const vertexCount = n * n;
  const positions = new Float32Array(vertexCount * 3);
  const materials = new Float32Array(vertexCount);

  const originX = data.cx * CHUNK_SIZE;
  const originZ = data.cz * CHUNK_SIZE;

  for (let j = 0; j < n; j++) {
    const z = originZ + j * VERTEX_SPACING;
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const o = k * 3;
      positions[o] = originX + i * VERTEX_SPACING;
      positions[o + 1] = data.heights[k];
      positions[o + 2] = z;
      materials[k] = data.materials[k];
    }
  }

  const quads = (n - 1) * (n - 1);
  const indices = new Uint16Array(quads * 6);
  let w = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices[w] = a;
      indices[w + 1] = c;
      indices[w + 2] = b;
      indices[w + 3] = b;
      indices[w + 4] = c;
      indices[w + 5] = d;
      w += 6;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('material', new BufferAttribute(materials, 1));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createTerrainMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: terrainVert,
    fragmentShader: terrainFrag,
    side: FrontSide,
    transparent: false,
    depthTest: true,
    depthWrite: true,
    uniforms: {
      uSunDir: { value: new Vector3(-0.37, 0.83, 0.45) },
      uSunStrength: { value: 1 },
      uFogNear: { value: FOG_NEAR },
      uFogFar: { value: FOG_FAR },
      uTime: { value: 0 },
      uIsWater: { value: 0 },
      uLetterIndex: { value: -1 },
    },
  });
}

export function createWaterMesh(size: number): Mesh {
  const geometry = new PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI / 2);

  const count = geometry.getAttribute('position').count;
  const materials = new Float32Array(count);
  materials.fill(MATERIAL.WATER);
  geometry.setAttribute('material', new BufferAttribute(materials, 1));

  const material = createTerrainMaterial();
  material.uniforms.uIsWater.value = 1;

  const mesh = new Mesh(geometry, material);
  mesh.position.y = SEA_LEVEL;
  mesh.frustumCulled = false;
  return mesh;
}
