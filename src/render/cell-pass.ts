import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  GLSL3,
  Matrix3,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PerspectiveCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import glyphVert from './shaders/glyph.vert.glsl?raw';
import cellFrag from './shaders/cell.frag.glsl?raw';
import { EDGE_GLYPHS, type GlyphAtlas } from './glyph-atlas';
import type { SkyState } from './sky';
import { CLOUD_ALTITUDE, CLOUD_SCALE, GLYPH_STRENGTH, MATERIAL_COUNT } from '../config';

export interface CellPass {
  target: WebGLRenderTarget;
  setGrid(cols: number, rows: number): void;
  render(
    renderer: WebGLRenderer,
    scene: WebGLRenderTarget,
    sky: SkyState,
    camera: PerspectiveCamera,
    time: number,
  ): void;
  dispose(): void;
}

const CLOUD_RAMP = ' .:°';
const STAR_GLYPH = '.';
const FOAM_GLYPH = '~';
const STAR_COUNT = 64;
const WIND = new Vector2(0.0035, 0.0012);

function glyphIndex(atlas: GlyphAtlas, ch: string): number {
  return atlas.index.get(ch) ?? 0;
}

function writeColour(data: Uint8Array, at: number, c: Color): void {
  data[at] = Math.round(Math.min(1, Math.max(0, c.r)) * 255);
  data[at + 1] = Math.round(Math.min(1, Math.max(0, c.g)) * 255);
  data[at + 2] = Math.round(Math.min(1, Math.max(0, c.b)) * 255);
  data[at + 3] = 255;
}

export function createCellPass(atlas: GlyphAtlas): CellPass {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));

  const paletteData = new Uint8Array(4 * MATERIAL_COUNT * 4);
  const palette = new DataTexture(paletteData, 4, MATERIAL_COUNT, RGBAFormat, UnsignedByteType);
  palette.minFilter = NearestFilter;
  palette.magFilter = NearestFilter;
  palette.generateMipmaps = false;
  palette.unpackAlignment = 1;
  palette.flipY = false;
  palette.needsUpdate = true;

  const stars: Vector3[] = [];
  for (let i = 0; i < STAR_COUNT; i++) stars.push(new Vector3(0, 1, 0));

  const edges = new Vector4(
    glyphIndex(atlas, EDGE_GLYPHS[0]),
    glyphIndex(atlas, EDGE_GLYPHS[1]),
    glyphIndex(atlas, EDGE_GLYPHS[2]),
    glyphIndex(atlas, EDGE_GLYPHS[3]),
  );
  const cloudGlyphs = new Vector4(
    glyphIndex(atlas, CLOUD_RAMP[0]),
    glyphIndex(atlas, CLOUD_RAMP[1]),
    glyphIndex(atlas, CLOUD_RAMP[2]),
    glyphIndex(atlas, CLOUD_RAMP[3]),
  );

  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: glyphVert,
    fragmentShader: cellFrag,
    depthTest: false,
    depthWrite: false,
    transparent: false,
    uniforms: {
      uScene: { value: null },
      uRamp: { value: atlas.rampTexture },
      uPalette: { value: palette },
      uCells: { value: new Vector2(1, 1) },
      uTime: { value: 0 },
      uNight: { value: 0 },
      uCamBasis: { value: new Matrix3() },
      uCamPos: { value: new Vector3() },
      uTanHalf: { value: 0.7 },
      uAspect: { value: 1 },
      uSunPos: { value: new Vector3(0, 1, 0) },
      uMoonPos: { value: new Vector3(0, -1, 0) },
      uLightDir: { value: new Vector3(0, 1, 0) },
      uTwilight: { value: 0 },
      uZenith: { value: new Vector3() },
      uHorizon: { value: new Vector3() },
      uHorizonSun: { value: new Vector3() },
      uFogNear: { value: new Vector3() },
      uSeaFar: { value: new Vector3() },
      uSunTint: { value: new Vector3() },
      uMoonTint: { value: new Vector3() },
      uMoonGlowTint: { value: new Vector3() },
      uStar: { value: new Vector3() },
      uStars: { value: stars },
      uCloudBright: { value: new Vector3() },
      uCloudLit: { value: new Vector3() },
      uCloudShade: { value: new Vector3() },
      uCloudCover: { value: 0.54 },
      uCloudY: { value: CLOUD_ALTITUDE },
      uCloudScale: { value: CLOUD_SCALE },
      uWind: { value: WIND },
      uShallow: { value: new Vector3() },
      uFoam: { value: new Vector3() },
      uEdgeGlyphs: { value: edges },
      uCloudGlyphs: { value: cloudGlyphs },
      uStarGlyph: { value: glyphIndex(atlas, STAR_GLYPH) },
      uFoamGlyph: { value: glyphIndex(atlas, FOAM_GLYPH) },
      uGlyphStrength: { value: GLYPH_STRENGTH },
    },
  });

  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;

  const scene = new Scene();
  scene.add(quad);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const target = new WebGLRenderTarget(2, 1, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    format: RGBAFormat,
    type: UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });

  const setColour = (name: string, c: Color): void => {
    (material.uniforms[name].value as Vector3).set(c.r, c.g, c.b);
  };

  return {
    target,

    setGrid(cols: number, rows: number): void {
      const c = Math.max(1, Math.floor(cols));
      const r = Math.max(1, Math.floor(rows));
      target.setSize(c * 2, r);
      (material.uniforms.uCells.value as Vector2).set(c, r);
    },

    render(
      renderer: WebGLRenderer,
      sceneTarget: WebGLRenderTarget,
      sky: SkyState,
      view: PerspectiveCamera,
      time: number,
    ): void {
      const uniforms = material.uniforms;
      uniforms.uScene.value = sceneTarget.texture;
      uniforms.uTime.value = time;
      uniforms.uNight.value = sky.night;
      (uniforms.uCamBasis.value as Matrix3).setFromMatrix4(view.matrixWorld);
      (uniforms.uCamPos.value as Vector3).setFromMatrixPosition(view.matrixWorld);
      uniforms.uTanHalf.value = Math.tan((view.fov * Math.PI) / 360);
      uniforms.uAspect.value = view.aspect;
      (uniforms.uSunPos.value as Vector3).copy(sky.sunPos);
      (uniforms.uMoonPos.value as Vector3).copy(sky.moonPos);
      (uniforms.uLightDir.value as Vector3).copy(sky.sunDir);
      uniforms.uTwilight.value = sky.twilight;
      setColour('uZenith', sky.zenith);
      setColour('uHorizon', sky.horizon);
      setColour('uHorizonSun', sky.horizonSun);
      setColour('uFogNear', sky.fogNear);
      setColour('uSeaFar', sky.seaFar);
      setColour('uSunTint', sky.sunTint);
      setColour('uMoonTint', sky.moonTint);
      setColour('uMoonGlowTint', sky.moonGlow);
      setColour('uStar', sky.star);
      setColour('uCloudBright', sky.cloudBright);
      setColour('uCloudLit', sky.cloudLit);
      setColour('uCloudShade', sky.cloudShade);
      uniforms.uCloudCover.value = sky.cloudCover;
      setColour('uShallow', sky.shallow);
      setColour('uFoam', sky.foam);

      for (let i = 0; i < STAR_COUNT; i++) {
        const s = sky.stars[i];
        if (s) stars[i].copy(s);
      }

      for (let m = 0; m < MATERIAL_COUNT; m++) {
        const row = m * 16;
        writeColour(paletteData, row, sky.bgLit[m] ?? sky.paper);
        writeColour(paletteData, row + 4, sky.bgShade[m] ?? sky.paper);
        writeColour(paletteData, row + 8, sky.inks[m] ?? sky.ink);
        writeColour(paletteData, row + 12, sky.glyphShade[m] ?? sky.ink);
      }
      palette.needsUpdate = true;

      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
    },

    dispose(): void {
      geometry.dispose();
      material.dispose();
      palette.dispose();
      target.dispose();
      scene.clear();
    },
  };
}
