# Tilde

A quiet, endless world you walk through, drawn with nothing but one font.

Live: https://tilde-production-b719.up.railway.app (the design case study is at /design).

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
| Shift | run |
| Ctrl | stroll |
| Space | jump |
| E | talk to the villager you are looking at |
| F | drift: the walker wanders on its own |
| M | map |
| J | journal |
| I | controls |
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

`npm start` runs the small Node server in `server/` on `$PORT` (default 4173): it serves `dist/` with clean URLs (`/` and `/design`), long-lived caching for hashed assets, and the one endpoint the villagers use.

## Villager speech

Villagers speak from a local grammar built into the game: a few hundred lines assembled from the time of day, the ground under your feet, what they know about landmarks you have not found, and their own temperament. That is the default and it needs nothing.

If `OPENAI_API_KEY` is set on the server, villagers are voiced by an OpenAI model instead (`gpt-5-mini` by default; set `OPENAI_MODEL` to choose another). The browser never sees the key: it posts the same handful of facts the grammar uses to `/api/npc/speak`, and the server makes the call. Requests are rate limited per visitor, the server answers `{ "fallback": true }` whenever it cannot or will not answer, and the game quietly falls back to the local grammar — so a missing key, a rate limit or a slow reply all just sound like the old villagers.

Set the key in Railway under the service's Variables tab, or keep it in a local `.env` you export before starting:

```
export $(grep -v '^#' .env | xargs)
npm run build && npm start
```

That runs the same server locally on port 4173. `GET /api/health` reports which voice is in use.

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
  npc/               villagers: names, routines, local grammar, remote voice
public/fonts/        IBM Plex Mono Medium (OFL), the only asset
server/index.mjs     static server plus the villager speech endpoint
tests/
```

The full case study and design, including every decision and why, lives in [DESIGN.md](DESIGN.md). The illustrated version with the live text-mode landscape is served with the game at `/design` and published at https://claude.ai/artifact/VQZbo7GVqUMwjftnYArr1d.
