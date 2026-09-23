import {
  Color,
  LinearSRGBColorSpace,
  NearestFilter,
  NoToneMapping,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import {
  CELL_H,
  CELL_MAX,
  CELL_MIN,
  CELL_W,
  FOG_FAR,
  FOG_NEAR,
  MATERIAL,
  SCENE_PX_PER_CELL,
  SEA_LEVEL,
} from '../config';
import type { GlyphAtlas } from './glyph-atlas';
import { createGlyphPass } from './glyph-pass';
import { skyAt } from './sky';
import { createTerrainMaterial, createWaterMesh } from './terrain-mesh';

export interface Renderer {
  scene: Scene;
  camera: PerspectiveCamera;
  terrainMaterial: ShaderMaterial;
  setCell(w: number, h: number): void;
  getCell(): [number, number];
  resize(): void;
  render(timeOfDay: number, time: number, playerX: number, playerZ: number): void;
  dispose(): void;
}

const SKY_CLEAR = new Color(0, 1, 0);
const SKY_ALPHA = MATERIAL.NONE / 255;
const WATER_SIZE = 900;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  atlas: GlyphAtlas,
  opts?: { grain?: number },
): Renderer {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
    depth: true,
  });
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.autoClear = true;
  renderer.setClearColor(SKY_CLEAR, SKY_ALPHA);

  const scene = new Scene();
  const camera = new PerspectiveCamera(70, 1, 0.5, 600);
  const terrainMaterial = createTerrainMaterial();

  const water = createWaterMesh(WATER_SIZE);
  const waterMaterial = water.material as ShaderMaterial;
  waterMaterial.uniforms = { ...terrainMaterial.uniforms, uIsWater: { value: 1 } };
  scene.add(water);

  const target = new WebGLRenderTarget(2, 2, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    format: RGBAFormat,
    type: UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
  });

  const pass = createGlyphPass(atlas);
  const startedAt = performance.now();
  const grain = opts?.grain ?? 0.03;

  let cellW = CELL_W;
  let cellH = CELL_H;

  function resize(): void {
    const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const dpr = clamp(ratio, 0.5, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth || canvas.width || 1));
    const height = Math.max(1, Math.round(canvas.clientHeight || canvas.height || 1));

    const cols = Math.max(1, Math.ceil(width / cellW));
    const rows = Math.max(1, Math.ceil(height / cellH));

    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    target.setSize(cols * SCENE_PX_PER_CELL, rows * SCENE_PX_PER_CELL);

    camera.aspect = (cols * cellW) / (rows * cellH);
    camera.updateProjectionMatrix();

    pass.setGrid(cols, rows, cellW, cellH);
  }

  const onResize = (): void => resize();
  if (typeof window !== 'undefined') window.addEventListener('resize', onResize);
  resize();

  return {
    scene,
    camera,
    terrainMaterial,

    setCell(w: number, h: number): void {
      cellW = clamp(Math.round(w), CELL_MIN[0], CELL_MAX[0]);
      cellH = clamp(Math.round(h), CELL_MIN[1], CELL_MAX[1]);
      resize();
    },

    getCell(): [number, number] {
      return [cellW, cellH];
    },

    resize,

    render(timeOfDay: number, time: number, playerX: number, playerZ: number): void {
      const elapsed = (performance.now() - startedAt) / 1000;
      const now = Number.isFinite(time) ? time : elapsed;
      const sky = skyAt(timeOfDay);

      const uniforms = terrainMaterial.uniforms;
      (uniforms.uSunDir.value as Vector3).copy(sky.sunDir);
      uniforms.uSunStrength.value = sky.sunStrength;
      uniforms.uFogNear.value = FOG_NEAR;
      uniforms.uFogFar.value = FOG_FAR;
      uniforms.uTime.value = now;

      water.position.set(playerX, SEA_LEVEL, playerZ);

      renderer.setClearColor(SKY_CLEAR, SKY_ALPHA);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);

      pass.render(renderer, target, sky, now, grain);
    },

    dispose(): void {
      if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
      scene.remove(water);
      water.geometry.dispose();
      waterMaterial.dispose();
      terrainMaterial.dispose();
      pass.dispose();
      target.dispose();
      renderer.dispose();
    },
  };
}
