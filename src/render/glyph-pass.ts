import {
  BufferAttribute,
  BufferGeometry,
  GLSL3,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import glyphVert from './shaders/glyph.vert.glsl?raw';
import glyphFrag from './shaders/glyph.frag.glsl?raw';
import { EDGE_GLYPHS, GLYPHS, type GlyphAtlas } from './glyph-atlas';
import type { SkyState } from './sky';
import { MATERIAL_COUNT } from '../config';

export interface GlyphPass {
  setGrid(cols: number, rows: number, cellW: number, cellH: number): void;
  render(renderer: WebGLRenderer, scene: WebGLRenderTarget, sky: SkyState, time: number, grain: number): void;
  dispose(): void;
}

export function createGlyphPass(atlas: GlyphAtlas): GlyphPass {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));

  const inks: Vector3[] = [];
  for (let i = 0; i < MATERIAL_COUNT; i++) inks.push(new Vector3(0, 0, 0));

  const edges = new Vector4(
    atlas.index.get(EDGE_GLYPHS[0]) ?? 0,
    atlas.index.get(EDGE_GLYPHS[1]) ?? 0,
    atlas.index.get(EDGE_GLYPHS[2]) ?? 0,
    atlas.index.get(EDGE_GLYPHS[3]) ?? 0,
  );

  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: glyphVert,
    fragmentShader: glyphFrag,
    depthTest: false,
    depthWrite: false,
    transparent: false,
    uniforms: {
      uScene: { value: null },
      uAtlas: { value: atlas.texture },
      uRamp: { value: atlas.rampTexture },
      uCells: { value: new Vector2(1, 1) },
      uCellPx: { value: new Vector2(1, 1) },
      uResolution: { value: new Vector2(1, 1) },
      uAtlasCells: { value: new Vector2(atlas.cols, atlas.rows) },
      uPaper: { value: new Vector3(1, 1, 1) },
      uInks: { value: inks },
      uTime: { value: 0 },
      uGrain: { value: 0.03 },
      uNight: { value: 0 },
      uEdgeGlyphs: { value: edges },
      uGlyphCount: { value: GLYPHS.length },
      uStarGlyph: { value: atlas.index.get('.') ?? 0 },
    },
  });

  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;

  const scene = new Scene();
  scene.add(quad);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const size = new Vector2(1, 1);
  let cols = 1;
  let rows = 1;
  let cellW = 1;
  let cellH = 1;

  return {
    setGrid(nextCols: number, nextRows: number, nextCellW: number, nextCellH: number): void {
      cols = Math.max(1, Math.floor(nextCols));
      rows = Math.max(1, Math.floor(nextRows));
      cellW = Math.max(1, nextCellW);
      cellH = Math.max(1, nextCellH);
      (material.uniforms.uCells.value as Vector2).set(cols, rows);
    },

    render(
      renderer: WebGLRenderer,
      target: WebGLRenderTarget,
      sky: SkyState,
      time: number,
      grain: number,
    ): void {
      renderer.getDrawingBufferSize(size);
      const scaleX = size.x / (cols * cellW);
      const scaleY = size.y / (rows * cellH);

      const uniforms = material.uniforms;
      uniforms.uScene.value = target.texture;
      (uniforms.uResolution.value as Vector2).set(size.x, size.y);
      (uniforms.uCellPx.value as Vector2).set(cellW * scaleX, cellH * scaleY);
      (uniforms.uCells.value as Vector2).set(cols, rows);
      (uniforms.uPaper.value as Vector3).set(sky.paper.r, sky.paper.g, sky.paper.b);
      uniforms.uTime.value = time;
      uniforms.uGrain.value = grain;
      uniforms.uNight.value = sky.night;

      for (let i = 0; i < inks.length; i++) {
        const colour = sky.inks[i] ?? sky.ink;
        inks[i].set(colour.r, colour.g, colour.b);
      }

      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    },

    dispose(): void {
      geometry.dispose();
      material.dispose();
      scene.clear();
    },
  };
}
