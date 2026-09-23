# Tilde — module contracts

Everything below is fixed. Build exactly these exports with exactly these signatures. Other people are building the other modules against this file at the same time, so do not rename, add required parameters, or change types. Optional extra exports are fine if they do not change the ones listed.

Global rules for all code in this repo:
- TypeScript strict. `npm run build` runs `tsc --noEmit` first, so it must type-check.
- ZERO comments in code. No JSDoc, no `//`, no `/* */`. Explain in the commit message instead.
- No new dependencies. Only `three` at runtime. `@types/three`, `vite`, `vitest`, `typescript` for dev.
- Imports between modules use relative paths (`../config`, `./types`).
- Pure modules (`src/world/*` except `chunk-manager.ts`) must not touch `window`, `document`, `three`, or anything browser-only. They run in a Web Worker and in Vitest under Node.
- Determinism: any randomness comes from `chunkRng(seed, cx, cz, salt)` or `hash01(...)` in `src/world/hash.ts`. Never `Math.random()` in world code.
- Coordinates: x and z are horizontal metres, y is up. Chunk (cx, cz) covers world x in [cx*64, cx*64+64) and z likewise. Vertex (i, j) of a chunk, i and j in 0..32, sits at world x = cx*64 + i*2, z = cz*64 + j*2, and its height is `heights[j*33 + i]`. Chunks share their border vertices with neighbours (i=32 of chunk cx equals i=0 of chunk cx+1) so the mesh has no cracks.

Already written (read them, do not modify): `src/config.ts`, `src/world/types.ts`, `src/world/hash.ts`, `src/world/noise.ts`.

## src/world (owner: world agent)

### `src/world/sampler.ts`
```ts
import type { WorldSampler } from './types';
export function createSampler(seed: number): WorldSampler;
```
`height(x, z)` is the terrain height in metres, deterministic for (seed, x, z). Layers, using `createNoise2` instances derived from the seed (different salts per layer via `mix32(seed, salt)`):
- domain warp: offsets of about ±60 m from two fbm(3 octaves) fields at wavelength ~700 m;
- continent: fbm 4 octaves, wavelength ~2000 m, scaled to ±110 m, plus a +12 m bias;
- ridged: `ridged()` 4 octaves, wavelength ~400 m, up to +90 m, multiplied by `max(0, continentNormalised + 0.25)` so ridges only rise where the continent is above sea;
- hills: fbm 4 octaves, wavelength ~100 m, ±18 m;
- detail: fbm 2 octaves, wavelength ~12 m, ±1.5 m.
`moisture(x, z)` in [-1, 1], fbm 3 octaves wavelength ~250 m. `temperature(x, z)` in [-1, 1], fbm 2 octaves wavelength ~1500 m.
Aim for large calm areas: most of the walkable world is grassland with hills; ridges are events, not the norm. Roughly a third of the world should be below sea level (ocean).

### `src/world/biomes.ts`
```ts
export function materialFor(height: number, slope: number, moisture: number, temperature: number): MaterialId;
```
Rules in order: height < 0 → WATER (the material of the ground under water; the water plane is drawn separately); height < 3 → SAND; height > 125 → SNOW; slope > 0.85 (slope is rise over run, unitless, from neighbouring vertices 2 m apart) or height > 90 → STONE; moisture > 0.12 and height < 65 → FOREST; else GRASS. FOREST here means "forest floor": the ground stays grass-coloured in the palette but the id tells the prop placer to plant trees and the audio to add the drone.

### `src/world/landmarks.ts`
```ts
import type { Landmark } from './types';
export function landmarkForRegion(seed: number, rx: number, rz: number, sampler: WorldSampler): Landmark | null;
export function landmarkInChunk(seed: number, cx: number, cz: number, sampler: WorldSampler): Landmark | null;
```
Regions are 512 m squares (`REGION_SIZE`), region (rx, rz) covers x in [rx*512, rx*512+512). `hash01(seed, rx, rz, 7) < 1/9` decides whether a region has a landmark. Kind by another hash: letter 60%, ring 12%, tree 12%, pool 8%, shelter 8%. Letter = `String.fromCharCode(65 + mix32(seed, rx, rz, 11) % 26)`. Position: search a 9×9 grid of points spaced 25 m within 100 m of the region centre and pick the highest point that is above sea level and not STONE-steep; if none is above sea level return null. `y` = sampler height there. `landmarkInChunk` returns the region's landmark if its (x, z) falls inside that chunk, else null.

### `src/world/chunk-gen.ts`
```ts
import type { ChunkData, WorldSampler } from './types';
export function generateChunk(seed: number, cx: number, cz: number, sampler?: WorldSampler): ChunkData;
```
Pure. Fills `heights` (Float32Array(33*33)), `materials` (Uint8Array(33*33)) via `materialFor` with slope computed from the sampler at ±2 m, `props` as a Float32Array of 4 floats per prop `[x, z, kind, scale]` in world metres: trees where the material at that 3 m cell is FOREST with probability 0.3 per 3 m cell (hash-based, jittered inside the cell, scale 0.8–1.4), rocks where STONE with probability 0.04 (scale 0.5–1.5). No props below sea level or inside 6 m of the landmark. `landmark` from `landmarkInChunk`. `genVersion` = `GEN_VERSION`. Must produce byte-identical output for identical inputs across calls and across Node/worker.

### `src/world/gen.worker.ts`
Worker entry (`new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module' })`). On `GenRequest` message: if `genVersion !== GEN_VERSION` reply nothing; else `generateChunk` and `postMessage(reply, [heights.buffer, materials.buffer, props.buffer])` where reply is a `ChunkReply`. Cache one sampler per seed inside the worker.

### `tests/determinism.test.ts`, `tests/hash.test.ts`
Vitest. Same seed + coords → identical `heights`, `materials`, `props` bytes across two calls and two samplers. Neighbouring chunks share border heights exactly. `mix32` distribution: 100k values into 16 buckets, none more than 8% off uniform. `chunkRng` sequences differ for different salts.

## src/render (owner: render agent)

### G-buffer layout (the contract between scene pass and glyph pass)
The scene pass renders into one RGBA8 `WebGLRenderTarget` with `NearestFilter`, size = (cols*2, rows*2) where cols/rows are the number of glyph cells. Per pixel:
- R = lighting in [0,1] (0.15 ambient + diffuse from the sun, flat shaded via derivatives of world position, water at ~0.55 plus a slow ripple ±0.08),
- G = fog factor in [0,1] (`1 - exp(-((dist - FOG_NEAR)/ (FOG_FAR - FOG_NEAR)) * 2.2)` clamped, 0 before FOG_NEAR),
- B = 0 (reserved),
- A = materialId / 255 (MATERIAL.NONE = 7 for sky; the target is cleared to (0,1,0,7/255)).

### `src/render/glyph-atlas.ts`
```ts
import { DataTexture } from 'three';
export interface GlyphAtlas { texture: DataTexture; cols: number; rows: number; glyphW: number; glyphH: number; index: Map<string, number>; coverage: Float32Array; ramps: Uint8Array; rampTexture: DataTexture; }
export const GLYPHS: string;
export const RAMPS: Record<number, string>;
export const EDGE_GLYPHS: string;
export function buildGlyphAtlas(fontFamily?: string): Promise<GlyphAtlas>;
```
`GLYPHS` is the ordered list of every character the atlas holds, ASCII printable subset plus `≈` and `°`, letters A–Z last. Rasterise with an offscreen 2D canvas: 16 glyphs per row, each glyph cell 20×36 px, font `500 30px "IBM Plex Mono"` (the family the game loads from `/fonts/IBMPlexMono-Medium.woff2` via `FontFace` before calling this; `buildGlyphAtlas` must `await document.fonts.load('500 30px "IBM Plex Mono"')` itself). Store only the alpha (Luminance) into an `R8`/`RedFormat` DataTexture with `LinearFilter`. `coverage[i]` = mean alpha of glyph i. `RAMPS` maps MaterialId → a string of glyphs ordered light→dense: GRASS `" .,':;"`, FOREST same as GRASS, STONE `".:%#@"`, SAND `" .:°"`, SNOW `"  .*+"`, WATER `"~-≈_"`, LETTER `"A"` (placeholder, letters are drawn by the pass from material LETTER using a per-object letter uniform — see terrain shader), NONE `" "`. `rampTexture` is an 8-row × 16-column `RedFormat` DataTexture where row = material, column = ramp step (16 steps, the ramp string stretched across), value = glyph index (as uint8). `EDGE_GLYPHS` = `"|-/\\"` in that order (vertical, horizontal, diagonal up, diagonal down).

### `src/render/sky.ts`
```ts
import { Color, Vector3 } from 'three';
export interface SkyState { paper: Color; ink: Color; inks: Color[]; sunDir: Vector3; sunStrength: number; night: number; }
export function skyAt(timeOfDay: number): SkyState;
```
`timeOfDay` in [0,1), 0 = midnight, 0.5 = noon. Keyframes: day paper `#EBE9E2` ink `#26292A`; dusk paper `#D9D3C6` ink `#3A3B3E`; night paper `#1A1C1B` ink `#D6D4CC`; dawn paper `#DDDAD2` ink `#2E3133`. Blend with smoothstep around 0.22–0.28 (dawn) and 0.72–0.78 (dusk) in time units. `inks` indexed by MaterialId (8 entries): day GRASS `#68796C`, FOREST `#4F5F52`, STONE `#7A746C`, SAND `#A8956A`, SNOW `#969B9E`, WATER `#6A7F8F`, LETTER = ink, NONE = paper; at night each biome ink is lerped 65% toward the night ink. `sunDir` rotates over the day (noon: high, from the south-west; night: below horizon, `sunStrength` 0.35 as moonlight). `night` in [0,1].

### `src/render/shaders/terrain.vert.glsl`, `terrain.frag.glsl`, `glyph.frag.glsl`, `glyph.vert.glsl`
GLSL ES 3.0 for Three.js `ShaderMaterial` with `glslVersion: GLSL3`. Vite imports them with `?raw`. Terrain shader: attributes `position` and `material` (float); uniforms `uSunDir`, `uSunStrength`, `uFogNear`, `uFogFar`, `uTime`, `uIsWater` (0/1), `uLetterIndex` (float, glyph index for LETTER material objects, -1 if none). Writes the G-buffer as defined above. Water: `uIsWater = 1` uses ripple lighting.

### `src/render/terrain-mesh.ts`
```ts
import { BufferGeometry, Mesh, ShaderMaterial } from 'three';
import type { ChunkData } from '../world/types';
export function buildTerrainGeometry(data: ChunkData): BufferGeometry;
export function createTerrainMaterial(): ShaderMaterial;
export function createWaterMesh(size: number): Mesh;
```
`buildTerrainGeometry` returns an indexed geometry with `position` (Float32, world-space x/y/z, so meshes sit at the origin with no transform) and `material` (Float32, 1 component) attributes; no normals (flat shading is done with derivatives). Must run under 3 ms for one chunk. `createTerrainMaterial` builds the ShaderMaterial once; the renderer updates its uniforms every frame. `createWaterMesh` is a flat plane at y = SEA_LEVEL sized `size` metres, material WATER, following the player in the x/z plane (the renderer moves it).

### `src/render/props.ts`
```ts
import { InstancedMesh, Object3D } from 'three';
import type { ChunkData } from '../world/types';
export function buildProps(data: ChunkData, material: ShaderMaterial): Object3D;
```
Trees: an `InstancedMesh` of a 7-segment cone (radius 1.2, height 4.5) on a thin box trunk, material FOREST via the `material` attribute (set per-geometry as a constant attribute), positioned at `[x, heightAt, z]` scaled by prop scale. Rocks: an `InstancedMesh` of a low-poly icosahedron scaled 0.6–1.5, material STONE. Heights come from bilinear sampling of `data.heights`. Landmarks: letter monolith is a box 2 × 9 × 2 m with material LETTER and `uLetterIndex` set on a cloned material; ring = 8 boxes on a 6 m circle, STONE; tree = one cone scaled 3× ; pool = a 5 m disc at ground with material WATER; shelter = three boxes forming a lean-to, STONE. Return one `Object3D` grouping everything for the chunk so the manager can add/remove/dispose it (`dispose()` all geometries and instanced meshes when removed; attach a `userData.dispose()` function on the returned object).

### `src/render/glyph-pass.ts`
```ts
import { WebGLRenderer, WebGLRenderTarget } from 'three';
import type { GlyphAtlas } from './glyph-atlas';
import type { SkyState } from './sky';
export interface GlyphPass { setGrid(cols: number, rows: number, cellW: number, cellH: number): void; render(renderer: WebGLRenderer, scene: WebGLRenderTarget, sky: SkyState, time: number, grain: number): void; dispose(): void; }
export function createGlyphPass(atlas: GlyphAtlas): GlyphPass;
```
Full-screen triangle with a ShaderMaterial (`glyph.frag.glsl`). Per output fragment: cell = floor(fragCoord / cellSize); sample the G-buffer at the cell's centre (and its 8 neighbouring cells for the Sobel on the R channel). L = R * (1 - G*0.7). If Sobel magnitude > 0.18 pick an `EDGE_GLYPHS` glyph by direction, else glyph = rampTexture(material, floor(L * 15)). WATER cycles its ramp column with `time*0.6 + hash(cell)`. Material LETTER: glyph = B channel * 255 if the terrain shader wrote the letter index into B (do that: for LETTER material, B = uLetterIndex/255). Coverage = atlas sample at the glyph's cell using the in-cell uv. Colour = mix(paper, inks[material], coverage * (1 - G*0.85)). Add grain: `(hash(fragCoord + time) - 0.5) * grain` (grain default 0.03). Vignette: multiply by `1 - 0.18 * smoothstep(0.5, 1.2, length(uv - 0.5) * 1.6)` toward paper. Night stars: if material NONE and night > 0.5 and hash(cell) < 0.02 * night, draw `.`.

### `src/render/renderer.ts`
```ts
import { PerspectiveCamera, Scene } from 'three';
import type { GlyphAtlas } from './glyph-atlas';
export interface Renderer { scene: Scene; camera: PerspectiveCamera; terrainMaterial: ShaderMaterial; setCell(w: number, h: number): void; getCell(): [number, number]; resize(): void; render(timeOfDay: number, time: number, playerX: number, playerZ: number): void; dispose(): void; }
export function createRenderer(canvas: HTMLCanvasElement, atlas: GlyphAtlas, opts?: { grain?: number }): Renderer;
```
Owns the WebGLRenderer (antialias false, `powerPreference: 'high-performance'`), the render target, the water mesh, the glyph pass, and exponential-ish fog parameters passed as uniforms. `resize()` reads the canvas client size and devicePixelRatio (cap 2), computes cols = ceil(width/cellW), rows = ceil(height/cellH), resizes the target to (cols*2, rows*2), the canvas to full pixel size, and the camera aspect. Camera: fov 70°, near 0.5, far 600. `render` updates sky uniforms, moves the water mesh under the player, renders the scene to the target, then the glyph pass to screen.

## src/audio (owner: audio agent)

### `src/audio/index.ts`
```ts
export interface AudioContextSnapshot { biome: number; nearWater: number; altitude: number; speed: number; timeOfDay: number; }
export interface Audio { start(): Promise<void>; started: boolean; update(dt: number, snap: AudioContextSnapshot): void; discover(): void; setVolume(v: number): void; getVolume(): number; }
export function createAudio(): Audio;
```
`biome` is a MaterialId. `nearWater` in [0,1] (1 = standing in it, 0 = more than 30 m away). `altitude` in metres. `speed` in m/s. All synthesis per the design: pads (sine + triangle, attack 2–4 s, release 6–10 s, lowpass ~1.2 kHz), a soft FM bell on `discover()`, wind (pink-ish noise → lowpass, gain with altitude and speed), water (lowpass noise, gain by nearWater), reverb via a ConvolverNode with a generated 4 s exponentially decaying noise impulse, master gain at -12 dBFS times volume. Scales: GRASS C major pentatonic, FOREST same plus a root drone, WATER adds F♯, STONE A minor pentatonic, SNOW same as STONE one octave up and sparser, SAND like GRASS but sparser. Scheduler: setInterval 25 ms, 100 ms lookahead, notes considered every 3.2 s with p = 0.35, after 6–10 notes a silence of 20–60 s. `start()` must be called from a user gesture; it creates the AudioContext. Split into `engine.ts`, `scheduler.ts`, `composer.ts`, `ambience.ts`, `reverb.ts` as you see fit, but `index.ts` exports exactly the above.

## src/state and src/ui (owner: state agent)

### `src/state/store.ts`
```ts
export interface Settings { cellW: number; cellH: number; volume: number; grain: boolean; headBob: boolean; }
export interface WorldRecord { seed: number; genVersion: number; }
export interface Pose { x: number; z: number; yaw: number; pitch: number; timeOfDay: number; }
export const DEFAULT_SETTINGS: Settings;
export function loadSettings(): Settings; export function saveSettings(s: Settings): void;
export function loadWorld(): WorldRecord | null; export function saveWorld(w: WorldRecord): void;
export function loadPose(): Pose | null; export function savePose(p: Pose): void;
```
Keys `tilde.settings`, `tilde.world`, `tilde.pose`. Every read/write in try/catch; a failed read returns defaults/null.

### `src/state/db.ts`
```ts
export interface Discovery { id: string; kind: string; letter: string | null; x: number; z: number; at: number; }
export function openDb(seed: number): Promise<Db>;
export interface Db { addDiscovery(d: Discovery): Promise<void>; listDiscoveries(): Promise<Discovery[]>; markVisited(key: string): void; listVisited(): Promise<string[]>; close(): void; }
```
IndexedDB database named `tilde-${seed.toString(36)}`, version 1, stores `discoveries` (keyPath `id`) and `visited` (keyPath `key`). `markVisited` batches writes (flush every 5 s or 200 keys). Everything guarded so a missing IndexedDB degrades to in-memory.

### `src/ui/overlay.ts`
```ts
export interface Overlay { toast(text: string, ms?: number): void; showHint(text: string): void; hideHint(): void; setHidden(h: boolean): void; showJournal(letters: Set<string>, count: number): void; showMap(visited: Iterable<string>, discoveries: Discovery[], playerCx: number, playerCz: number): void; hidePanels(): void; isPanelOpen(): boolean; }
export function createOverlay(root: HTMLElement): Overlay;
```
Everything drawn as text in the page font (IBM Plex Mono), in the paper/ink palette using CSS variables `--paper` and `--ink` on `root` (the renderer's caller sets these each frame from sky). Toast: bottom-left tiny text that fades after `ms` (default 4000). Hint: one centred line near the bottom (used for "click to look around"). Journal: a centred panel showing `A B C … Z` with undiscovered letters as `·`, and a line `n of 26`. Map: a centred panel of about 41×21 characters where each character is one chunk, `.` for visited, the letter for a discovery, `@` for the player at the centre; unknown chunks blank. Panels are `pointer-events: none`, all text, no borders except a hairline in the ink colour at 30% opacity. No emoji, no icons.

## Owned by the integrator (do not write these): `src/world/chunk-manager.ts`, `src/player/*`, `src/main.ts`.
