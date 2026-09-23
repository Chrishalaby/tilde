import { LinearSRGBColorSpace } from 'three';
import { CELL_MAX, CELL_MIN, DAY_LENGTH_S, EYE_HEIGHT, GEN_VERSION, MATERIAL, REGION_SIZE, SEA_LEVEL } from './config';
import { randomSeed, seedFromParam, seedToString } from './world/hash';
import { createSampler } from './world/sampler';
import { landmarkForRegion } from './world/landmarks';
import { materialFor } from './world/biomes';
import { createChunkManager } from './world/chunk-manager';
import type { Landmark, WorldSampler } from './world/types';
import { buildGlyphAtlas } from './render/glyph-atlas';
import { createRenderer } from './render/renderer';
import { skyAt } from './render/sky';
import { createPlayer } from './player/controller';
import { createDrift } from './player/drift';
import { keyCode } from './player/keys';
import { createAudio } from './audio/index';
import {
  loadPose, loadSettings, loadTravel, loadWorld, savePose, saveSettings, saveTravel, saveWorld, type Travel,
} from './state/store';
import { openDb, type Discovery, type JournalEntry, type PersonEntry, type TraceEntry } from './state/db';
import {
  createOverlay, isTraceKind, placeName, traceName, type DialogueHandlers, type JournalView,
} from './ui/overlay';
import { createNpcManager } from './npc/manager';
import { localBrain } from './npc/brain';
import { createRemoteBrain } from './npc/remote-brain';
import { createConversation, type ConversationView } from './npc/conversation';
import { villagerInSight } from './npc/focus';
import type { NpcSnapshot, NpcWorld, PlayerView } from './npc/types';
import { createNpcRenderer } from './render/npcs';

const SPEAK_RANGE = 12;
const MAP_PROBE = 2;
const FIRE_RANGE = 400;
const TRACE_RANGE = 8;
const TRACE_POLL = 0.3;
const DAWN = 0.25;
const GREET_GAP = 30;
const STRIDE_LIMIT = 25;
const PERSON = 'person:';
const TRACE = 'trace:';

interface Spawn { x: number; z: number; yaw: number; pitch: number }

let spawnSeed = 0;

function landmarkWithin(sampler: WorldSampler, x: number, z: number, radius: number): Landmark | null {
  const seen = new Set<string>();
  let best: Landmark | null = null;
  let bestDist = radius;
  for (const [ox, oz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
    const rx = Math.floor((x + ox) / REGION_SIZE);
    const rz = Math.floor((z + oz) / REGION_SIZE);
    const key = rx + ',' + rz;
    if (seen.has(key)) continue;
    seen.add(key);
    const lm = landmarkForRegion(spawnSeed, rx, rz, sampler);
    if (!lm) continue;
    const d = Math.hypot(lm.x - x, lm.z - z);
    if (d <= bestDist) {
      bestDist = d;
      best = lm;
    }
  }
  return best;
}

function visible(sampler: WorldSampler, x: number, z: number, eye: number, lm: Landmark): boolean {
  const top = lm.y + 8;
  const steps = 14;
  for (let i = 1; i < steps; i++) {
    const f = i / steps;
    const sx = x + (lm.x - x) * f;
    const sz = z + (lm.z - z) * f;
    const line = eye + (top - eye) * f;
    if (sampler.height(sx, sz) > line - 1) return false;
  }
  return true;
}

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
      let steep = false;
      for (const [ox, oz] of [[9, 0], [-9, 0], [0, 9], [0, -9]]) {
        if (Math.abs(sampler.height(x + ox, z + oz) - h) > 2.5) steep = true;
      }
      if (steep || sampler.moisture(x, z) > 0.12) continue;
      const near = landmarkWithin(sampler, x, z, 330);
      if (ring < 90 && !near) continue;
      let bestView = -Infinity;
      if (near) {
        const flat = Math.hypot(near.x - x, near.z - z);
        const rise = near.y + 4 - (h + EYE_HEIGHT);
        const aim = Math.atan2(rise, Math.max(1, flat));
        if (ring < 110 && (Math.abs(aim) > 0.38 || !visible(sampler, x, z, h + EYE_HEIGHT, near))) continue;
        best = { x, z, yaw: Math.atan2(x - near.x, z - near.z), pitch: Math.max(-0.3, Math.min(0.45, aim)) };
        break;
      }
      let yaw = 0;
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

function typingInto(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
}

function traceKey(kind: number, x: number, z: number): string {
  return TRACE + Math.round(kind) + ':' + Math.round(x) + ',' + Math.round(z);
}

function freshTravel(origin: { x: number; z: number }): Travel {
  return { day: 1, walked: 0, startX: origin.x, startZ: origin.z };
}

function releasePointer(): void {
  try {
    if (document.pointerLockElement && typeof document.exitPointerLock === 'function') document.exitPointerLock();
  } catch {
    return;
  }
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
  const journal = new Map<string, JournalEntry>();
  for (const entry of await db.listJournal()) journal.set(entry.id, entry);

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
  spawnSeed = seed;
  const spawn = savedPose ? { x: savedPose.x, z: savedPose.z, yaw: savedPose.yaw, pitch: savedPose.pitch } : findSpawn(sampler);
  let timeOfDay = savedPose ? savedPose.timeOfDay : 0.34;
  const travel: Travel = loadTravel(seed) ?? freshTravel(savedPose ? findSpawn(sampler) : spawn);
  saveTravel(seed, travel);

  let people: NpcSnapshot[] = [];
  const bump = (x: number, z: number, radius: number): { x: number; z: number } => {
    const out = manager.collide(x, z, radius);
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      const dx = out.x - p.x;
      const dz = out.z - p.z;
      const reach = radius + 0.3;
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      out.x = p.x + (dx / d) * reach;
      out.z = p.z + (dz / d) * reach;
    }
    return out;
  };
  const player = createPlayer({ canvas, heightAt: manager.heightAt, initial: spawn, headBob: settings.headBob, collide: bump });
  const drift = createDrift(player, manager.heightAt);
  const audio = createAudio();
  audio.setVolume(settings.volume);

  const letters = () => new Set(Array.from(discovered.values()).filter((d) => d.letter).map((d) => d.letter as string));

  const mapSample = (x: number, z: number): number => {
    const h = sampler.height(x, z);
    const moisture = sampler.moisture(x, z);
    const temperature = sampler.temperature(x, z);
    const flat = materialFor(h, 0, moisture, temperature);
    if (flat !== MATERIAL.GRASS && flat !== MATERIAL.FOREST) return flat;
    const dx = (sampler.height(x + MAP_PROBE, z) - h) / MAP_PROBE;
    const dz = (sampler.height(x, z + MAP_PROBE) - h) / MAP_PROBE;
    return materialFor(h, Math.sqrt(dx * dx + dz * dz), moisture, temperature);
  };

  const view: PlayerView = { x: spawn.x, z: spawn.z, yaw: spawn.yaw, lettersFound: letters() };
  const npcWorld: NpcWorld = {
    heightAt: (x, z) => manager.heightAt(x, z),
    materialAt: (x, z) => manager.materialAt(x, z),
    timeOfDay: () => timeOfDay,
    player: () => {
      view.x = player.pose.x;
      view.z = player.pose.z;
      view.yaw = player.pose.yaw;
      return view;
    },
    landmarksNear: (x, z, radius) => manager.landmarksNear(x, z, radius),
    discovered: (key) => discovered.has(key),
    fires: () => manager.firesNear(player.pose.x, player.pose.z, FIRE_RANGE),
    collide: (x, z, radius) => manager.collide(x, z, radius),
  };
  const journalView = (): JournalView => {
    const people: PersonEntry[] = [];
    const traces: TraceEntry[] = [];
    for (const entry of journal.values()) {
      if (entry.type === 'person') people.push(entry);
      else traces.push(entry);
    }
    people.sort((a, b) => a.at - b.at);
    return {
      letters: letters(),
      places: Array.from(discovered.values()).sort((a, b) => a.at - b.at),
      people,
      traces,
      startX: travel.startX,
      startZ: travel.startZ,
      day: travel.day,
      walked: travel.walked,
    };
  };

  let uiHidden = false;
  let journalOpen = false;
  let mapOpen = false;
  let controlsOpen = true;
  const refreshPanels = () => {
    overlay.hidePanels();
    if (controlsOpen) overlay.showControls();
    if (journalOpen) overlay.showJournal(journalView());
    if (mapOpen) {
      overlay.showMap({
        sample: mapSample,
        heightAt: (x, z) => sampler.height(x, z),
        visited,
        discoveries: Array.from(discovered.values()),
        x: player.pose.x,
        z: player.pose.z,
        yaw: player.pose.yaw,
      });
    }
  };
  const refreshJournal = (): void => {
    if (journalOpen) refreshPanels();
  };

  const notePerson = (id: string, name: string, home: string, said: string): void => {
    const key = PERSON + id;
    const before = journal.get(key);
    const entry: PersonEntry = {
      id: key,
      type: 'person',
      name,
      home,
      said,
      day: before ? before.day : travel.day,
      at: Date.now(),
    };
    journal.set(key, entry);
    db.putJournal(entry).catch(() => {});
    refreshJournal();
  };

  const npcs = createNpcManager(seed, npcWorld, {
    brain: createRemoteBrain(localBrain),
    greetGap: GREET_GAP,
    onSpeak: (npc, line) => {
      const known = journal.get(PERSON + npc.id);
      if (known && known.type === 'person') notePerson(npc.id, known.name, known.home, line);
    },
  });
  const npcRenderer = createNpcRenderer(renderer.scene, renderer.terrainMaterial, atlas);
  let locked = false;
  let spoken: string | null = null;

  const dialogueHandlers: DialogueHandlers = {
    send: (text) => talk.say(text),
    close: () => talk.close(),
  };
  const showTalk = (conversation: ConversationView | null): void => {
    if (!conversation) {
      overlay.hideDialogue();
      return;
    }
    overlay.showDialogue(
      {
        title: conversation.name + ' · ' + conversation.home,
        speaker: conversation.name,
        lines: conversation.lines,
        pending: conversation.pending,
      },
      dialogueHandlers,
    );
  };
  const talk = createConversation(npcs, {
    metBefore: (id) => journal.has(PERSON + id),
    onChange: showTalk,
    onReply: (conversation, line) => notePerson(conversation.id, conversation.name, conversation.home, line),
  });

  overlay.toast('seed ' + seedToString(seed), 6000);
  if (sameWorld && genVersion !== GEN_VERSION) overlay.toast('this world was made by an older generator', 8000);
  player.onFirstLock(() => {
    locked = true;
  });

  refreshPanels();

  let sighted: NpcSnapshot | null = null;
  let prompted: string | null = null;
  const lookForSomeone = (crowd: NpcSnapshot[]): void => {
    sighted = talk.active() === null && !journalOpen && !mapOpen ? villagerInSight(player.view, crowd) : null;
    const text = sighted ? 'e — talk to ' + sighted.name.toLowerCase() : null;
    if (text === prompted) return;
    prompted = text;
    if (text) overlay.showPrompt(text);
    else overlay.hidePrompt();
  };

  const startTalk = (id: string): void => {
    if (!talk.open(id)) return;
    journalOpen = false;
    mapOpen = false;
    controlsOpen = false;
    refreshPanels();
    if (uiHidden) {
      uiHidden = false;
      overlay.setHidden(false);
    }
    prompted = null;
    overlay.hidePrompt();
    spoken = null;
    overlay.hideHint();
    releasePointer();
    overlay.focusDialogue();
  };

  canvas.addEventListener('click', () => {
    if (talk.active() !== null) talk.close();
  });

  const startAudio = () => {
    if (audio.started) return;
    audio.start().catch(() => {});
  };
  window.addEventListener('pointerdown', startAudio, { passive: true });
  window.addEventListener('keydown', startAudio);

  window.addEventListener('keydown', (ev) => {
    if (typingInto(ev.target)) return;
    const code = keyCode(ev);
    if (talk.active() !== null) {
      if (code === 'Escape') {
        ev.preventDefault();
        talk.close();
      } else if (code === 'KeyE') {
        ev.preventDefault();
        talk.say('');
      } else if (code === 'Enter' || code === 'NumpadEnter') {
        ev.preventDefault();
        overlay.focusDialogue();
      } else if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        overlay.focusDialogue();
      }
      return;
    }
    switch (code) {
      case 'KeyE': {
        const someone = sighted;
        if (!someone) return;
        ev.preventDefault();
        startTalk(someone.id);
        break;
      }
      case 'KeyM':
        mapOpen = !mapOpen;
        journalOpen = false;
        controlsOpen = false;
        refreshPanels();
        break;
      case 'KeyJ':
        journalOpen = !journalOpen;
        mapOpen = false;
        controlsOpen = false;
        refreshPanels();
        break;
      case 'KeyI':
        controlsOpen = !controlsOpen;
        journalOpen = false;
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
        if (journalOpen || mapOpen || controlsOpen) {
          journalOpen = false;
          mapOpen = false;
          controlsOpen = false;
          refreshPanels();
        }
        break;
      default:
        return;
    }
  });

  const persist = () => {
    savePose({ x: player.pose.x, z: player.pose.z, yaw: player.pose.yaw, pitch: player.pose.pitch, timeOfDay });
    saveTravel(seed, travel);
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
  let traceTimer = 0;
  let lastX = player.pose.x;
  let lastZ = player.pose.z;

  const noticeTraces = (): void => {
    const hits = manager.propsNear(player.pose.x, player.pose.z, TRACE_RANGE);
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      if (!isTraceKind(hit.kind)) continue;
      const key = traceKey(hit.kind, hit.x, hit.z);
      if (journal.has(key)) continue;
      const entry: TraceEntry = { id: key, type: 'trace', kind: hit.kind, x: hit.x, z: hit.z, day: travel.day, at: Date.now() };
      journal.set(key, entry);
      db.putJournal(entry).catch(() => {});
      const name = traceName(hit.kind);
      if (name) overlay.toast(name, 3500);
      refreshJournal();
    }
  };

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

  const step = (now: number) => {
    const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
    last = now;
    const talking = talk.active() !== null;
    if (!talking) {
      if (player.drifting) drift.update(dt);
      player.update(dt);
    }
    const stride = Math.hypot(player.pose.x - lastX, player.pose.z - lastZ);
    if (stride < STRIDE_LIMIT) travel.walked += stride;
    lastX = player.pose.x;
    lastZ = player.pose.z;
    manager.update(player.pose.x, player.pose.z);
    const before = timeOfDay;
    timeOfDay = (timeOfDay + dt / DAY_LENGTH_S) % 1;
    if (before < DAWN && timeOfDay >= DAWN) {
      travel.day += 1;
      saveTravel(seed, travel);
      refreshJournal();
    }

    npcs.update(dt);
    const crowd = npcs.snapshots();
    people = crowd;
    npcRenderer.update(crowd);
    if (talking) talk.check(player.pose.x, player.pose.z);
    lookForSomeone(crowd);
    if (locked && talk.active() === null) {
      let line: string | null = null;
      for (let i = 0; i < crowd.length; i++) {
        const npc = crowd[i];
        if (npc.speaking === null) continue;
        const dx = npc.x - player.pose.x;
        const dz = npc.z - player.pose.z;
        if (dx * dx + dz * dz > SPEAK_RANGE * SPEAK_RANGE) continue;
        line = npc.name.toLowerCase() + ': ' + npc.speaking;
        break;
      }
      if (line !== null) {
        if (line !== spoken) {
          spoken = line;
          overlay.showHint(line);
        }
      } else if (spoken !== null) {
        spoken = null;
        overlay.hideHint();
      }
    }

    const sky = skyAt(timeOfDay);
    uiRoot.style.setProperty('--paper', '#' + sky.paper.getHexString(LinearSRGBColorSpace));
    uiRoot.style.setProperty('--ink', '#' + sky.ink.getHexString(LinearSRGBColorSpace));

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
      speed: talking ? 0 : player.speed,
      timeOfDay,
    });

    for (const lm of manager.landmarksNear(player.pose.x, player.pose.z, 9)) {
      if (discovered.has(lm.regionKey)) continue;
      const d: Discovery = {
        id: lm.regionKey, kind: lm.kind, letter: lm.letter, x: lm.x, z: lm.z, at: Date.now(), day: travel.day,
      };
      discovered.set(d.id, d);
      view.lettersFound = letters();
      db.addDiscovery(d).catch(() => {});
      audio.discover();
      overlay.toast(lm.letter ? lm.letter : placeName(lm.kind, null), 5000);
      refreshJournal();
    }

    traceTimer += dt;
    if (traceTimer > TRACE_POLL) {
      traceTimer = 0;
      noticeTraces();
    }

    if (mapOpen || journalOpen) {
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
  };
  const frame = (now: number) => {
    step(now);
    requestAnimationFrame(frame);
  };
  (window as unknown as { tilde: unknown }).tilde = { renderer, manager, player, sampler, npcs, talk, step };
  requestAnimationFrame(frame);
}

boot().catch((err: unknown) => {
  const root = document.getElementById('ui');
  const message = err instanceof Error ? err.message : String(err);
  if (root) fail(root, 'tilde could not start: ' + message);
});
