import { CELL_MAX, CELL_MIN, DAY_LENGTH_S, GEN_VERSION, MATERIAL, SEA_LEVEL } from './config';
import { randomSeed, seedFromParam, seedToString } from './world/hash';
import { createSampler } from './world/sampler';
import { createChunkManager } from './world/chunk-manager';
import type { WorldSampler } from './world/types';
import { buildGlyphAtlas } from './render/glyph-atlas';
import { createRenderer } from './render/renderer';
import { skyAt } from './render/sky';
import { createPlayer } from './player/controller';
import { createDrift } from './player/drift';
import { keyCode } from './player/keys';
import { createAudio } from './audio/index';
import { loadPose, loadSettings, loadWorld, savePose, saveSettings, saveWorld } from './state/store';
import { openDb, type Discovery } from './state/db';
import { createOverlay } from './ui/overlay';

interface Spawn { x: number; z: number; yaw: number; pitch: number }

function findSpawn(sampler: WorldSampler): Spawn {
  const step = 37;
  let best: Spawn | null = null;
  for (let ring = 0; ring < 120 && !best; ring++) {
    const r = ring * step;
    const n = Math.max(1, ring * 6);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + ring * 0.37;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = sampler.height(x, z);
      if (h < 5 || h > 45) continue;
      let yaw = 0;
      let bestView = -Infinity;
      for (let d = 0; d < 12; d++) {
        const y = (d / 12) * Math.PI * 2;
        const hx = x - Math.sin(y) * 220;
        const hz = z - Math.cos(y) * 220;
        const view = sampler.height(hx, hz) - h;
        if (view > bestView && view > 0 && view < 120) {
          bestView = view;
          yaw = y;
        }
      }
      best = { x, z, yaw, pitch: 0.02 };
      break;
    }
  }
  return best || { x: 0, z: 0, yaw: 0, pitch: 0 };
}

function fail(root: HTMLElement, message: string) {
  root.style.pointerEvents = 'auto';
  root.innerHTML = '';
  const p = document.createElement('p');
  p.textContent = message;
  p.style.cssText = 'position:absolute;left:24px;bottom:24px;max-width:36em;font:14px "IBM Plex Mono",monospace;color:#26292A;';
  root.appendChild(p);
}

async function boot() {
  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui') as HTMLElement | null;
  if (!canvas || !uiRoot) return;
  const overlay = createOverlay(uiRoot);
  const settings = loadSettings();

  const url = new URL(location.href);
  const param = url.searchParams.get('seed');
  const savedWorld = loadWorld();
  let seed: number;
  if (param) seed = seedFromParam(param);
  else if (savedWorld) seed = savedWorld.seed;
  else seed = randomSeed();
  const sameWorld = !!savedWorld && savedWorld.seed === seed;
  const genVersion = sameWorld ? savedWorld!.genVersion : GEN_VERSION;
  if (!param) {
    url.searchParams.set('seed', seedToString(seed));
    history.replaceState(null, '', url.toString());
  }
  saveWorld({ seed, genVersion });

  const atlas = await buildGlyphAtlas();
  const renderer = createRenderer(canvas, atlas, { grain: settings.grain ? 0.03 : 0 });
  renderer.setCell(settings.cellW, settings.cellH);
  const sampler = createSampler(seed);
  const db = await openDb(seed);
  const discovered = new Map<string, Discovery>();
  for (const d of await db.listDiscoveries()) discovered.set(d.id, d);
  const visited = new Set<string>(await db.listVisited());

  const manager = createChunkManager({
    seed,
    scene: renderer.scene,
    terrainMaterial: renderer.terrainMaterial,
    atlas,
    sampler,
    onVisit: (key) => {
      visited.add(key);
      db.markVisited(key);
    },
  });

  const savedPose = sameWorld ? loadPose() : null;
  const spawn = savedPose ? { x: savedPose.x, z: savedPose.z, yaw: savedPose.yaw, pitch: savedPose.pitch } : findSpawn(sampler);
  let timeOfDay = savedPose ? savedPose.timeOfDay : 0.34;

  const player = createPlayer({ canvas, heightAt: manager.heightAt, initial: spawn, headBob: settings.headBob });
  const drift = createDrift(player, manager.heightAt);
  const audio = createAudio();
  audio.setVolume(settings.volume);

  const letters = () => new Set(Array.from(discovered.values()).filter((d) => d.letter).map((d) => d.letter as string));

  overlay.toast('seed ' + seedToString(seed), 6000);
  overlay.showHint('click to look around · w a s d to walk · shift to stroll');
  if (sameWorld && genVersion !== GEN_VERSION) overlay.toast('this world was made by an older generator', 8000);
  player.onFirstLock(() => overlay.hideHint());

  let uiHidden = false;
  let journalOpen = false;
  let mapOpen = false;
  const refreshPanels = () => {
    overlay.hidePanels();
    if (journalOpen) overlay.showJournal(letters(), discovered.size);
    if (mapOpen) {
      const pcx = Math.floor(player.pose.x / 64);
      const pcz = Math.floor(player.pose.z / 64);
      overlay.showMap(visited, Array.from(discovered.values()), pcx, pcz);
    }
  };

  const startAudio = () => {
    if (audio.started) return;
    audio.start().catch(() => {});
  };
  window.addEventListener('pointerdown', startAudio, { passive: true });
  window.addEventListener('keydown', startAudio);

  window.addEventListener('keydown', (ev) => {
    switch (keyCode(ev)) {
      case 'KeyM':
        mapOpen = !mapOpen;
        journalOpen = false;
        refreshPanels();
        break;
      case 'KeyJ':
        journalOpen = !journalOpen;
        mapOpen = false;
        refreshPanels();
        break;
      case 'KeyH':
        uiHidden = !uiHidden;
        overlay.setHidden(uiHidden);
        break;
      case 'KeyF':
        player.drifting = !player.drifting;
        if (player.drifting) drift.reset();
        overlay.toast(player.drifting ? 'drifting' : 'walking', 2500);
        break;
      case 'BracketLeft':
      case 'BracketRight': {
        const dir = ev.code === 'BracketRight' ? 1 : -1;
        const w = Math.max(CELL_MIN[0], Math.min(CELL_MAX[0], settings.cellW + dir));
        settings.cellW = w;
        settings.cellH = Math.max(CELL_MIN[1], Math.min(CELL_MAX[1], Math.round(w * 1.8)));
        renderer.setCell(settings.cellW, settings.cellH);
        saveSettings(settings);
        overlay.toast('cell ' + settings.cellW + '×' + settings.cellH, 2000);
        break;
      }
      case 'Minus':
      case 'Equal': {
        const v = Math.max(0, Math.min(1, Math.round((settings.volume + (ev.code === 'Equal' ? 0.1 : -0.1)) * 10) / 10));
        settings.volume = v;
        audio.setVolume(v);
        saveSettings(settings);
        overlay.toast('volume ' + Math.round(v * 10), 2000);
        break;
      }
      case 'Escape':
        if (journalOpen || mapOpen) {
          journalOpen = false;
          mapOpen = false;
          refreshPanels();
        }
        break;
      default:
        return;
    }
  });

  const persist = () => {
    savePose({ x: player.pose.x, z: player.pose.z, yaw: player.pose.yaw, pitch: player.pose.pitch, timeOfDay });
  };
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
  window.addEventListener('resize', () => renderer.resize());

  const camera = renderer.camera;
  camera.rotation.order = 'YXZ';
  let last = performance.now();
  let saveTimer = 0;
  let waterTimer = 0;
  let nearWater = 0;
  let panelTimer = 0;

  const probeWater = (): number => {
    const { x, z } = player.pose;
    if (player.groundHeight < SEA_LEVEL) return 1;
    let near = 0;
    for (const d of [14, 30]) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        if (manager.heightAt(x + Math.cos(a) * d, z + Math.sin(a) * d) < SEA_LEVEL) {
          near = Math.max(near, d === 14 ? 0.55 : 0.25);
        }
      }
    }
    return near;
  };

  const frame = (now: number) => {
    const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
    last = now;
    if (player.drifting) drift.update(dt);
    player.update(dt);
    manager.update(player.pose.x, player.pose.z);
    timeOfDay = (timeOfDay + dt / DAY_LENGTH_S) % 1;

    const sky = skyAt(timeOfDay);
    uiRoot.style.setProperty('--paper', '#' + sky.paper.getHexString());
    uiRoot.style.setProperty('--ink', '#' + sky.ink.getHexString());

    const v = player.view;
    camera.position.set(v.x, v.y, v.z);
    camera.rotation.set(v.pitch, v.yaw, 0);
    renderer.render(timeOfDay, now / 1000, player.pose.x, player.pose.z);

    waterTimer += dt;
    if (waterTimer > 0.5) {
      waterTimer = 0;
      nearWater = probeWater();
    }
    const biome = manager.materialAt(player.pose.x, player.pose.z);
    audio.update(dt, {
      biome: biome === MATERIAL.NONE ? MATERIAL.GRASS : biome,
      nearWater,
      altitude: Math.max(0, player.groundHeight),
      speed: player.speed,
      timeOfDay,
    });

    for (const lm of manager.landmarksNear(player.pose.x, player.pose.z, 9)) {
      if (discovered.has(lm.regionKey)) continue;
      const d: Discovery = { id: lm.regionKey, kind: lm.kind, letter: lm.letter, x: lm.x, z: lm.z, at: Date.now() };
      discovered.set(d.id, d);
      db.addDiscovery(d).catch(() => {});
      audio.discover();
      if (lm.letter) overlay.toast(lm.letter, 5000);
      if (journalOpen) refreshPanels();
    }

    if (mapOpen) {
      panelTimer += dt;
      if (panelTimer > 1) {
        panelTimer = 0;
        refreshPanels();
      }
    }

    saveTimer += dt;
    if (saveTimer > 5) {
      saveTimer = 0;
      persist();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot().catch((err: unknown) => {
  const root = document.getElementById('ui');
  const message = err instanceof Error ? err.message : String(err);
  if (root) fail(root, 'tilde could not start: ' + message);
});
