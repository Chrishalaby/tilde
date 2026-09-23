import {
  BufferAttribute,
  BufferGeometry,
  GLSL3,
  LinearFilter,
  LinearMipmapNearestFilter,
  Mesh,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import glyphVert from './shaders/glyph.vert.glsl?raw';
import glyphFrag from './shaders/glyph.frag.glsl?raw';
import { GLYPHS, GLYPH_H, GLYPH_W, type GlyphAtlas } from './glyph-atlas';

export interface GlyphPass {
  setGrid(cols: number, rows: number, cellW: number, cellH: number): void;
  render(renderer: WebGLRenderer, paint: WebGLRenderTarget, time: number, grain: number): void;
  dispose(): void;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function createGlyphPass(atlas: GlyphAtlas): GlyphPass {
  atlas.texture.generateMipmaps = true;
  atlas.texture.minFilter = LinearMipmapNearestFilter;
  atlas.texture.magFilter = LinearFilter;
  atlas.texture.needsUpdate = true;

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));

  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: glyphVert,
    fragmentShader: glyphFrag,
    depthTest: false,
    depthWrite: false,
    transparent: false,
    uniforms: {
      uPaint: { value: null },
      uAtlas: { value: atlas.texture },
      uCells: { value: new Vector2(1, 1) },
      uCellPx: { value: new Vector2(1, 1) },
      uResolution: { value: new Vector2(1, 1) },
      uAtlasCells: { value: new Vector2(atlas.cols, atlas.rows) },
      uGlyphPx: { value: new Vector2(GLYPH_W, GLYPH_H) },
      uAtlasLod: { value: 0 },
      uGlyphCount: { value: GLYPHS.length },
      uTime: { value: 0 },
      uGrain: { value: 0.03 },
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

    render(renderer: WebGLRenderer, paint: WebGLRenderTarget, time: number, grain: number): void {
      renderer.getDrawingBufferSize(size);
      const scaleX = size.x / (cols * cellW);
      const scaleY = size.y / (rows * cellH);
      const cellPxW = Math.max(1, cellW * scaleX);
      const cellPxH = Math.max(1, cellH * scaleY);

      const uniforms = material.uniforms;
      uniforms.uPaint.value = paint.texture;
      (uniforms.uResolution.value as Vector2).set(size.x, size.y);
      (uniforms.uCellPx.value as Vector2).set(cellPxW, cellPxH);
      (uniforms.uCells.value as Vector2).set(cols, rows);
      uniforms.uAtlasLod.value = clamp(
        0.5 * (Math.log2(GLYPH_W / cellPxW) + Math.log2(GLYPH_H / cellPxH)),
        0,
        3,
      );
      uniforms.uTime.value = time;
      uniforms.uGrain.value = grain;

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
