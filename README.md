# Tilde

A quiet, endless world you walk through, drawn with nothing but one font.

Three dimensions underneath, punctuation on top. Every chunk of terrain is a pure function of the world seed and its coordinates, generated in Web Workers as you approach, so the world is infinite and never changes. The scene is rendered untextured into a small buffer, then a shader picks one glyph per screen cell from a single monospace font. Music, wind, water and the reverb tail are all synthesised. The only asset in the repository is the font.

## Play

```
npm install
npm run dev
```

Open the URL Vite prints. Click to look around.

| Key | Does |
| --- | --- |
| W A S D, arrows | walk, turn |
| Shift | stroll |
| F | drift: the walker wanders on its own |
| M | map of where you have been |
| J | journal |
| H | hide overlays |
| [ ] | glyph cell size |
| - = | volume |
| Esc | release the pointer |

Share a world by sharing the URL. The `seed` parameter is the world.

## Build and serve

```
npm run build
npm start
```

`npm start` serves `dist/` on `$PORT` (default 4173). Any static host works; no backend exists.

## Test

```
npm test
```

Determinism (same seed and coordinates produce identical bytes), hash distribution, palette keyframes, audio guards and storage round-trips.

## Layout

```
src/
  config.ts          every tunable
  world/             seed, noise, biomes, landmarks, chunk generation, worker, chunk manager
  render/            glyph atlas, sky and palette, terrain and props, glyph pass, renderer
  player/            first-person controller, drift mode
  audio/             engine, scheduler, composer, ambience, reverb
  state/             localStorage and IndexedDB
  ui/                text-only overlays
public/fonts/        IBM Plex Mono Medium (OFL), the only asset
tests/
```

The full case study and design, including every decision and why, lives in [DESIGN.md](DESIGN.md). The illustrated version with the live text-mode landscape is served with the game at `/design.html` and published at https://claude.ai/artifact/VQZbo7GVqUMwjftnYArr1d.
