# Tilde: case study and design

A quiet, endless world you walk through, drawn with nothing but one font. This file is the full design in prose: every decision, what was chosen, why, and the exact numbers the build starts from. The illustrated version with the live text-mode landscape is published as an artifact (https://claude.ai/artifact/VQZbo7GVqUMwjftnYArr1d, also served at /design).

Name: Tilde (working title; the tilde is water). One-line: a quiet, endless world you walk through, drawn with one font.
Pillars: Quiet (no goals, no HUD, no threat). Unsharp (low internal resolution, glyph cells, fog; softness is the beauty). Endless (deterministic infinite world). Unchanging (same seed + same coordinates = same place, forever). One font (the only asset in the repo is one OFL monospace font file; every texture, sound and impulse response is generated).
Reference points: Proteus (2013, goal-less exploration, generative music reacting to what you see); Return of the Obra Dinn (a harsh visual constraint reads as elegance when the palette is disciplined); Acerola's ASCII shader (2024) and the older luminance-to-glyph shaders (glyph chosen by brightness and edge direction); Dwarf Fortress (a world of characters, but we keep only the calm part); Comanche-style heightfield raycasting (the doc's own hero uses it; the game does not).

## Decisions (D1–D15). Each: options considered, choice, why, cost.
D1 Two dimensions or three → 3D. Horizon plus fog is where "walking toward something" comes from; 2D top-down cannot do it. Cost: terrain meshing, camera, a little more code (~1.5× the 2D plan).
D2 A world built from glyphs, or a plain 3D world drawn in glyphs → the second: render untextured flat-shaded geometry with vertex colours into a low-res target, then a screen-space glyph pass picks one character per cell from the font atlas. The font is the only texture. The pass hides coarse geometry, so the 3D never has to be good. A glyph-built world (tiles as quads) becomes a busy 3D roguelike.
D3 Plain HTML+JS, a UI framework (React/Vue/Svelte), or a game engine (Phaser, Babylon, PlayCanvas, Godot web) → none of those: Vite + TypeScript ES modules, no framework, no engine. A game loop does not fit a UI framework; engines hide the parts that are the fun of this project (chunking, workers, the glyph pass). A single HTML file was considered and rejected because workers and modules get awkward.
D4 Raw WebGL, Three.js, or PixiJS → Three.js used as a library: render targets, BufferGeometry, InstancedMesh, camera, fog. Raw WebGL is boilerplate with no joy; PixiJS is 2D. Three.js is the only runtime dependency.
D5 Frontend only or a backend → frontend only. Everything is deterministic from a seed, so sharing a world is a URL. A backend would only be needed for multiplayer or a shared discovery board, both out of scope.
D6 Hosting → any static host (GitHub Pages, Cloudflare Pages, Netlify). We deliberately avoid SharedArrayBuffer so no COOP/COEP headers are needed, which keeps GitHub Pages viable.
D7 Store explored terrain, or regenerate deterministically → regenerate. Chunk (cx, cz) is a pure function of (seed, cx, cz, GEN_VERSION). Nothing about terrain is ever saved; only discoveries, visited chunk ids and the player's pose. GEN_VERSION is pinned and stored with a save; changing the generator changes worlds, so old versions stay in the code behind a switch.
D8 Generate on the main thread, or in Web Workers; share memory (SharedArrayBuffer) or transfer buffers → a worker pool of hardwareConcurrency − 1 clamped to 2..4, transferable ArrayBuffers (zero copy, ownership moves). SAB rejected (needs cross-origin isolation headers; not worth it).
D9 Noise and hashing → hand-written 2D simplex noise + fBm + domain warp in a dependency-free module imported by both main thread and workers; 32-bit integer mixing (splitmix-style) of (seed, cx, cz) to derive a per-chunk PRNG (sfc32). No noise library, so worker bundling stays trivial and determinism is ours to control.
D10 Persistence: localStorage or IndexedDB → both, by role. localStorage for tiny synchronous state (settings, seed, last pose, time of day). IndexedDB for discoveries and the visited-chunk set, which grow without bound.
D11 Audio: files or generative → generative with Web Audio, including the reverb impulse response (4 s of noise with exponential decay). Zero audio assets. Restraint is the design problem, not the code.
D12 The font: system monospace, a bundled OFL TTF rasterised at boot, or a hand-drawn bitmap font → bundled IBM Plex Mono (OFL) rasterised into a glyph atlas with Canvas 2D at boot, with each glyph's ink coverage measured automatically and ramps sorted by it. System fonts differ per machine; a hand bitmap font is a week of pixel art.
D13 Camera → first person, eye at 1.6 m, slow. A small wandering "@" third-person figure is a later option.
D14 TypeScript or JavaScript → TypeScript strict, mostly for the worker message contract and ChunkData.
D15 Tests → Vitest: determinism (same seed and coords produce identical bytes across runs and across worker/main), hash distribution sanity, glyph ramp ordering monotonic in coverage. No end-to-end tests.

## The look
Cells: the screen is divided into character cells; default cell 10 × 18 CSS px (user-tunable 8×14 to 14×26). The scene renders at 2 scene pixels per cell in each axis (1920×1080 → 192×60 cells → 384×120 scene target). That is the softness.
Scene pass: flat shading, vertex colours, one directional light (the sun), exponential fog whose colour equals the paper colour, so distance dissolves into the page. Sky is plain paper. Output: RGB colour + material id in alpha, into one render target.
Glyph pass (full-screen quad): per cell, average luminance L, dominant material M, Sobel on the low-res luminance for edge strength and direction. If edge strong: an edge glyph by direction (| - / \). Otherwise set[M][ramp(L)]. Water glyphs cycle with time and a per-cell hash. Output = mix(paper, ink[M], glyph coverage sampled from the atlas), then subtle procedural grain (hash noise, ~3%), a soft vignette. Nothing else. No bloom, no chromatic aberration.
Palette (saturation under ~15%): Day paper #EBE9E2, ink #26292A. Dusk paper #D9D3C6, ink #3A3B3E. Night paper #1A1C1B, ink #D6D4CC. Dawn paper #DDDAD2, ink #2E3133. Transition across ~90 s of game time at each edge. Biome inks by day: grass #68796C, forest #4F5F52, stone #7A746C, sand #A8956A, snow #969B9E, water #6A7F8F; by night the same hues lifted toward the pale ink.
Glyph sets: grass ramp `  . , ' : ;`; stone ramp `. : % # @`; sand `. : °`; snow `. * +`; water `~ - ≈ _` (animated); tree silhouettes `^ Y T !` (props, drawn as geometry; the pass just sees dark cones); edges `| - / \`; sky blank, night sky sparse `.` stars; landmarks: capital letters A–Z, the only letters in the world.
The letters: the world is made of punctuation. The only letters are the monoliths, one capital letter each, seeded per region. A journal (J) shows the alphabet with the letters you have stood next to filled in. Never explained in-game. That is the whole long game, and the "small hints" the brief asked for.
HUD: none. The seed in tiny type bottom-left for a few seconds after load, then gone. Journal and map are overlays drawn in the same font.

## The world
Units: 1 unit = 1 m. Chunk 64 × 64 m, vertex spacing 2 m (33 × 33 vertices, 2,048 triangles). Render radius 6 chunks (~384 m); prefetch radius 7; fog from 120 m to 360 m.
Height(x,z) = warp(x,z) then continent (wavelength ~2 km, ±110 m) + ridged (wavelength ~400 m, up to +90 m, only where continent > 0) + hills (~100 m, ±18 m) + detail (~12 m, ±1.5 m). Domain warp offsets ~60 m at ~700 m wavelength. Sea level 0, water plane at y=0 with a vertex-shader ripple.
Biomes: ocean h<0; beach 0–3 m; grassland; forest where moisture > 0.12 and h < 65; stone where slope > ~40° or h > 90; snow h > 125. Material id per vertex; boundaries dithered in the glyph pass so there are no hard seams.
Props: trees in forest, one per 3 m cell with probability 0.3 by hash, InstancedMesh cones on trunk lines, height from the chunk's height array; rocks sparse on stone. Trees are what make forests read; the ground under them stays grass.
Regions: 512 × 512 m. One region in nine holds a landmark, chosen by region hash: letter monolith (most common, letter = hash mod 26), stone ring, lone tall tree, still pool, shelter. Landmarks are placed at the region's highest local point within 100 m of the region centre so they are visible from far away.
Scale check: at 2.5 m/s, a 1 km ridge is about 7 minutes away. That is the point.
Deferred: rivers, caves, weather, animals, any building.

## Moving through it
Walk 2.5 m/s; hold Shift to stroll at 1.2 m/s (no sprint exists). Acceleration over 0.6 s, deceleration 0.4 s. Eye 1.6 m above the sampled terrain (bilinear on the chunk height array; no physics engine). Camera position lags the player by ~0.15 s; pitch and yaw eased. Head bob off by default. Mouse look via pointer lock at 0.0022 rad per px; arrow keys turn slowly for people who hate pointer lock. Water: you can wade to 1.2 m depth, then it gently refuses. Slopes over ~45° slow you down rather than block.
Drift mode (F): the walker wanders on its own, heading toward the horizon, turning away from water and steep slopes, occasionally stopping to look. For a second monitor.
Controls: W A S D / arrows move, mouse look (click to lock), Shift stroll, F drift, M map, J journal, H hide overlays, Esc release pointer, [ ] cell size, - + volume.
Touch and gamepad: later.

## Sound
Everything generated. Scale: C major pentatonic in grassland; forest adds a low drone on the root; near water the scale gains F♯ (a lydian colour); stone uses A minor pentatonic; snow the same one octave up and sparser. Instruments: sine + triangle pads, attack 2–4 s, release 6–10 s, lowpass at ~1.2 kHz; a soft FM bell only when a landmark is discovered. Scheduler: the two-clocks pattern (setInterval 25 ms, 100 ms lookahead, AudioContext time for scheduling). Notes considered every ~3.2 s with probability 0.35; after every 6–10 notes a mandatory silence of 20–60 s. Wind: pink noise through a lowpass, gain rising with altitude and walking speed. Water: lowpass noise within 30 m of water, gain by proximity. Reverb: ConvolverNode with a generated 4 s decaying noise impulse. Audio starts on the first user gesture (browser policy); master at −12 dBFS; a single volume key.

## Architecture
Main thread: input → player controller → chunk manager → renderer (scene pass + glyph pass) → audio scheduler → UI overlays → persistence. 
Worker pool: each worker imports the same pure generation module. Request `{type:'gen', seed, cx, cz, genVersion}`; reply `{type:'chunk', cx, cz, genVersion, heights: Float32Array(33*33), materials: Uint8Array(33*33), props: Float32Array(n*4) [x,z,kind,scale], landmark: {kind, letter?, x, z} | null}` with the buffers transferred. Main thread keeps `heights` for collision. Stale replies (chunk no longer wanted or genVersion mismatch) are dropped.
Chunk manager: desired set = chunks within prefetch radius of the player, priority by distance; states wanted → queued → generating → ready → built → visible ⇄ hidden → evicted (geometry disposed; LRU keeps ~2× the visible count). At most 2 geometry builds per frame (each ≤ 3 ms).
Renderer: Three.js WebGLRenderer; scene → WebGLRenderTarget (RGBA, nearest filtering) → glyph pass ShaderMaterial on a full-screen triangle → canvas. Glyph atlas is a DataTexture built at boot.
File tree:
```
tilde/
  index.html
  package.json  vite.config.ts  tsconfig.json
  src/
    main.ts                 boot and loop
    config.ts               every tunable in one place
    world/
      hash.ts               mix32, sfc32
      noise.ts              simplex2, fbm, warp
      biomes.ts
      landmarks.ts
      chunk-gen.ts          (seed,cx,cz) -> ChunkData, pure
      gen.worker.ts         worker entry
      chunk-manager.ts      desired set, pool, LRU
      terrain-mesh.ts       ChunkData -> BufferGeometry
      props.ts              InstancedMesh trees and rocks
    render/
      renderer.ts
      glyph-atlas.ts        rasterise font, measure coverage, sort ramps
      glyph-pass.ts
      sky.ts                sun, fog, palette keyframes
      shaders/terrain.vert.glsl  terrain.frag.glsl  glyph.frag.glsl
    player/
      controller.ts
      camera.ts
      drift.ts
    audio/
      engine.ts  scheduler.ts  composer.ts  ambience.ts  reverb.ts
    state/
      store.ts              localStorage
      db.ts                 IndexedDB
    ui/
      overlay.ts  journal.ts  map.ts
  fonts/IBMPlexMono-Regular.ttf   the only asset
  tests/
    determinism.test.ts  hash.test.ts  atlas.test.ts
```
Dependencies: three, vite, typescript, vitest. Nothing else.

## Memory and sharing
localStorage: `tilde.settings` (cell size, volume, reduce grain, head bob), `tilde.world` (seed, genVersion), `tilde.pose` (x, z, yaw, pitch, timeOfDay), written on a 5 s debounce and on pagehide.
IndexedDB `tilde` v1: store `discoveries` {id: regionKey, kind, letter, x, z, at}; store `visited` {key: "cx,cz"} used by the map overlay (visited chunks drawn as `.`; discoveries as their letter).
URL: `?seed=<base36>`; absent → random seed, written back to the URL without reload. Sharing a world is sharing the link. Two people with the same seed see the same world but keep their own journals.
GEN_VERSION: integer in config, saved with the world. On mismatch the game keeps using the saved version's generator (kept behind a switch) so nobody's world changes under them.

## Budgets and risks
Targets: 60 fps on an integrated GPU at 1440p; scene target around 290 × 90 px; under 250 draw calls; chunk generation under 8 ms in a worker; mesh build under 3 ms on the main thread; first frame under 2 s; total memory under 300 MB; bundle under 800 KB including the font.
Risks (with mitigation): terrain looks like noise blobs (domain warp, ridged layer, big wavelengths, landmarks); glyph screen feels busy (bigger cells, low contrast, two-tone per biome, heavy fog); frame hitches when crossing chunk borders (prefetch radius, build budget per frame, workers); generative music becomes annoying (silence rule, low probability, long envelopes); pointer lock confuses people (arrow-key turning, a one-line prompt); generator changes break saved worlds (GEN_VERSION switch); mobile performance (out of scope v1, desktop first).

## Build order (real sequence, numbered)
M0 Scaffold, flat plane, glyph pass. Done when a plane and a cone render as glyphs with fog and the palette.
M1 Chunked terrain in workers, walking. Done when you can walk 5 minutes in any direction at 60 fps and revisiting gives identical terrain.
M2 Biomes, props, day cycle, water. Done when a screenshot could be mistaken for the hero of this document.
M3 Audio. Done when you can leave it on for an hour.
M4 Persistence, seed URL, journal, map, landmarks. Done when a reload puts you where you were, and a friend with your link sees your world.
M5 Polish: easing, drift mode, settings, grain, hosting. Done when it is on a URL.

## Open calls (for the owner, not to be decided in the doc)
The name. Whether night fully inverts (paper becomes ink) or only dims. Whether the collected letters ever spell anything, or stay an alphabet. Default cell size. Whether to show a tiny compass or nothing at all.
