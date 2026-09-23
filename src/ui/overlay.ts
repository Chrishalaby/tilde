import { CHUNK_SIZE, MATERIAL } from '../config';
import type { Discovery } from '../state/db';

export interface MapView {
  sample(x: number, z: number): number;
  heightAt(x: number, z: number): number;
  visited: ReadonlySet<string> | Iterable<string>;
  discoveries: Discovery[];
  x: number;
  z: number;
  yaw: number;
}

export interface Overlay {
  toast(text: string, ms?: number): void;
  showHint(text: string): void;
  hideHint(): void;
  setHidden(h: boolean): void;
  showJournal(letters: Set<string>, count: number): void;
  showMap(opts: MapView): void;
  showControls(): void;
  hideControls(): void;
  toggleControls(): void;
  hidePanels(): void;
  isPanelOpen(): boolean;
}

const STYLE_ID = 'tilde-ui-style';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const UNKNOWN = '·';
const TOAST_MS = 4000;

const MAP_COLS = 71;
const MAP_ROWS = 33;
const MAP_STEP_X = 26;
const MAP_STEP_Z = 44;
const MAP_MID_COL = (MAP_COLS - 1) / 2;
const MAP_MID_ROW = (MAP_ROWS - 1) / 2;
const MAP_SPAN = ((MAP_COLS * MAP_STEP_X) / 1000).toFixed(1) + ' km across';

const INK_CLASS = 'tm-i';
const DIR_GLYPH = ['^', '/', '>', '\\', 'v', '/', '<', '\\'] as const;
const DIR_COL = [0, 1, 1, 1, 0, -1, -1, -1] as const;
const DIR_ROW = [-1, -1, 0, 1, 1, 1, 0, -1] as const;

interface MapCell {
  glyph: string;
  lit: string;
  dim: string;
}

function cell(glyph: string, name: string): MapCell {
  return { glyph, lit: name, dim: name + ' tm-d' };
}

const TERRAIN: Record<number, MapCell> = {
  [MATERIAL.WATER]: cell('~', 'tm-w'),
  [MATERIAL.SAND]: cell('.', 'tm-b'),
  [MATERIAL.GRASS]: cell(',', 'tm-g'),
  [MATERIAL.FOREST]: cell('T', 'tm-f'),
  [MATERIAL.STONE]: cell('#', 'tm-s'),
  [MATERIAL.SNOW]: cell('*', 'tm-n'),
};
const BLANK = cell(' ', 'tm-g');

const CONTROLS: ReadonlyArray<readonly [string, string]> = [
  ['w a s d / arrows', 'walk, turn'],
  ['mouse', 'look (click to lock)'],
  ['shift', 'run'],
  ['ctrl', 'stroll'],
  ['f', 'drift, the walker wanders on its own'],
  ['m', 'map'],
  ['j', 'journal'],
  ['i', 'these controls'],
  ['h', 'hide everything'],
  ['[ ]', 'glyph size'],
  ['- =', 'volume'],
  ['esc', 'release the pointer'],
];

function controlLines(): string {
  let width = 0;
  for (const [key] of CONTROLS) width = Math.max(width, key.length);
  const rows: string[] = [];
  for (const [key, what] of CONTROLS) rows.push(key.padEnd(width) + '  —  ' + what);
  return rows.join('\n');
}

const CSS = `
#ui, .tilde-ui {
  --paper: #EBE9E2;
  --ink: #26292A;
  position: fixed;
  inset: 0;
  pointer-events: none;
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  color: var(--ink);
  letter-spacing: 0.04em;
  -webkit-font-smoothing: antialiased;
}
.tilde-ui.tilde-hidden { display: none; }
.tilde-ui > .tilde-el { position: absolute; pointer-events: none; margin: 0; }
.tilde-toast {
  text-shadow: 0 0 2px var(--paper), 0 0 6px var(--paper), 0 1px 0 var(--paper);
  left: 18px;
  bottom: 18px;
  max-width: 60vw;
  font-size: 13px;
  line-height: 1.45;
  white-space: pre-wrap;
  opacity: 0;
  transition: opacity 600ms ease;
}
.tilde-hint {
  text-shadow: 0 0 2px var(--paper), 0 0 6px var(--paper), 0 1px 0 var(--paper);
  left: 0;
  right: 0;
  bottom: 12%;
  text-align: center;
  font-size: 13px;
  line-height: 1.45;
  opacity: 0;
  transition: opacity 600ms ease;
}
.tilde-on { opacity: 1; }
.tilde-panel {
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: none;
  padding: 16px 20px;
  font-size: 15px;
  line-height: 1.5;
  white-space: pre;
  text-align: center;
  background: color-mix(in srgb, var(--paper) 92%, transparent);
  border: 1px solid color-mix(in srgb, var(--ink) 30%, transparent);
}
.tilde-panel.tilde-open { display: block; }
.tilde-grid {
  margin: 0;
  font: inherit;
  letter-spacing: 0.04em;
  line-height: 1.15;
  text-align: left;
}
.tilde-panel.tilde-mapel {
  --ink: #2b3038;
  color: var(--ink);
  background: color-mix(in srgb, var(--paper) 28%, #f3f0e7);
}
.tilde-map {
  font-size: 12px;
  line-height: 1.1;
  max-width: 92vw;
  overflow: hidden;
}
.tilde-map .tm-d { opacity: 0.45; }
.tilde-map .tm-i { color: var(--ink); }
.tilde-map .tm-w { color: #3d7fa2; }
.tilde-map .tm-b { color: #ab8442; }
.tilde-map .tm-g { color: #5d8a38; }
.tilde-map .tm-f { color: #2c6a3c; }
.tilde-map .tm-s { color: #74746c; }
.tilde-map .tm-n { color: #7b9fc6; }
.tilde-sub {
  margin-top: 10px;
  color: color-mix(in srgb, var(--ink) 60%, transparent);
}
@media (prefers-reduced-motion: reduce) {
  .tilde-toast, .tilde-hint { transition: none; }
}
`;

function ensureStyle(doc: Document): void {
  try {
    if (doc.getElementById(STYLE_ID)) return;
    const el = doc.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    const host = doc.head ?? doc.documentElement;
    if (host) host.appendChild(el);
  } catch {
    return;
  }
}

type Panel = 'none' | 'journal' | 'map' | 'controls';

function glyphFor(d: Discovery): string {
  if (typeof d.letter === 'string' && d.letter.length > 0) {
    const ch = d.letter.charAt(0).toUpperCase();
    if (ch >= 'A' && ch <= 'Z') return ch;
  }
  return 'o';
}

function octant(yaw: number): number {
  const turns = Math.round((Number.isFinite(yaw) ? -yaw : 0) / (Math.PI / 4)) % 8;
  return turns < 0 ? turns + 8 : turns;
}

function readVisited(visited: ReadonlySet<string> | Iterable<string>): ReadonlySet<string> {
  const set = visited as ReadonlySet<string>;
  if (typeof set.has === 'function' && typeof set.size === 'number') return set;
  return new Set<string>(visited as Iterable<string>);
}

function buildMap(
  sample: (x: number, z: number) => number,
  seen: ReadonlySet<string>,
  discoveries: Discovery[],
  px: number,
  pz: number,
  dir: number,
): string {
  const marks = new Map<number, string>();
  for (const d of discoveries) {
    if (!d) continue;
    const col = Math.round((d.x - px) / MAP_STEP_X) + MAP_MID_COL;
    const row = Math.round((d.z - pz) / MAP_STEP_Z) + MAP_MID_ROW;
    if (col < 0 || col >= MAP_COLS || row < 0 || row >= MAP_ROWS) continue;
    marks.set(row * MAP_COLS + col, glyphFor(d));
  }

  const dirCol = MAP_MID_COL + DIR_COL[dir];
  const dirRow = MAP_MID_ROW + DIR_ROW[dir];
  const parts: string[] = [];
  let runClass = '';
  let runText = '';

  const flush = (): void => {
    if (runText.length === 0) return;
    parts.push('<span class="' + runClass + '">' + runText + '</span>');
    runText = '';
  };
  const put = (glyph: string, name: string): void => {
    if (name !== runClass) {
      flush();
      runClass = name;
    }
    runText += glyph;
  };

  let lastCx = NaN;
  let lastCz = NaN;
  let lastSeen = false;

  for (let r = 0; r < MAP_ROWS; r++) {
    const wz = pz + (r - MAP_MID_ROW) * MAP_STEP_Z;
    const cz = Math.floor(wz / CHUNK_SIZE);
    const base = r * MAP_COLS;
    for (let c = 0; c < MAP_COLS; c++) {
      if (r === MAP_MID_ROW && c === MAP_MID_COL) {
        put('@', INK_CLASS);
        continue;
      }
      if (r === dirRow && c === dirCol) {
        put(DIR_GLYPH[dir], INK_CLASS);
        continue;
      }
      if (r === 0 && c === MAP_MID_COL) {
        put('N', INK_CLASS);
        continue;
      }
      const mark = marks.size > 0 ? marks.get(base + c) : undefined;
      if (mark !== undefined) {
        put(mark, INK_CLASS);
        continue;
      }
      const wx = px + (c - MAP_MID_COL) * MAP_STEP_X;
      const cx = Math.floor(wx / CHUNK_SIZE);
      if (cx !== lastCx || cz !== lastCz) {
        lastCx = cx;
        lastCz = cz;
        lastSeen = seen.has(cx + ',' + cz);
      }
      const tile = TERRAIN[sample(wx, wz)] ?? BLANK;
      put(tile.glyph, lastSeen ? tile.lit : tile.dim);
    }
    if (r < MAP_ROWS - 1) runText += '\n';
  }
  flush();
  return parts.join('');
}

export function createOverlay(root: HTMLElement): Overlay {
  const doc: Document = root.ownerDocument;
  ensureStyle(doc);
  root.classList.add('tilde-ui');

  const toastEl = doc.createElement('div');
  toastEl.className = 'tilde-el tilde-toast';

  const hintEl = doc.createElement('div');
  hintEl.className = 'tilde-el tilde-hint';

  const journalEl = doc.createElement('div');
  journalEl.className = 'tilde-el tilde-panel';
  const journalRow = doc.createElement('div');
  const journalCount = doc.createElement('div');
  journalCount.className = 'tilde-sub';
  journalEl.appendChild(journalRow);
  journalEl.appendChild(journalCount);

  const mapEl = doc.createElement('div');
  mapEl.className = 'tilde-el tilde-panel tilde-mapel';
  const mapGrid = doc.createElement('pre');
  mapGrid.className = 'tilde-grid tilde-map';
  const mapCaption = doc.createElement('div');
  mapCaption.className = 'tilde-sub';
  const mapClose = doc.createElement('div');
  mapClose.className = 'tilde-sub';
  mapClose.textContent = 'close: M';
  mapEl.appendChild(mapGrid);
  mapEl.appendChild(mapCaption);
  mapEl.appendChild(mapClose);

  const controlsEl = doc.createElement('div');
  controlsEl.className = 'tilde-el tilde-panel';
  const controlsGrid = doc.createElement('pre');
  controlsGrid.className = 'tilde-grid';
  controlsGrid.textContent = controlLines();
  const controlsClose = doc.createElement('div');
  controlsClose.className = 'tilde-sub';
  controlsClose.textContent = 'press i to close';
  controlsEl.appendChild(controlsGrid);
  controlsEl.appendChild(controlsClose);

  root.appendChild(toastEl);
  root.appendChild(hintEl);
  root.appendChild(journalEl);
  root.appendChild(mapEl);
  root.appendChild(controlsEl);

  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let panel: Panel = 'none';

  let mapReady = false;
  let mapX = 0;
  let mapZ = 0;
  let mapDir = -1;
  let mapMarks = -1;
  let mapSeen = -1;

  const setPanel = (next: Panel): void => {
    panel = next;
    journalEl.classList.toggle('tilde-open', next === 'journal');
    mapEl.classList.toggle('tilde-open', next === 'map');
    controlsEl.classList.toggle('tilde-open', next === 'controls');
  };

  return {
    toast(text: string, ms = TOAST_MS): void {
      toastEl.textContent = text;
      toastEl.classList.add('tilde-on');
      if (toastTimer !== null) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toastEl.classList.remove('tilde-on');
        toastTimer = null;
      }, Math.max(0, ms));
    },
    showHint(text: string): void {
      hintEl.textContent = text;
      hintEl.classList.add('tilde-on');
    },
    hideHint(): void {
      hintEl.classList.remove('tilde-on');
    },
    setHidden(h: boolean): void {
      root.classList.toggle('tilde-hidden', h);
    },
    showJournal(letters: Set<string>, count: number): void {
      const have = new Set<string>();
      for (const raw of letters) {
        if (typeof raw === 'string' && raw.length > 0) have.add(raw.charAt(0).toUpperCase());
      }
      const cells: string[] = [];
      for (const ch of ALPHABET) cells.push(have.has(ch) ? ch : UNKNOWN);
      journalRow.textContent = cells.join(' ');
      const n = Number.isFinite(count) ? Math.max(0, Math.round(count)) : have.size;
      journalCount.textContent = `${n} of 26`;
      setPanel('journal');
    },
    showMap(opts: MapView): void {
      const x = Number.isFinite(opts.x) ? opts.x : 0;
      const z = Number.isFinite(opts.z) ? opts.z : 0;
      const dir = octant(opts.yaw);
      const seen = readVisited(opts.visited);
      const stale =
        !mapReady ||
        dir !== mapDir ||
        opts.discoveries.length !== mapMarks ||
        seen.size !== mapSeen ||
        Math.abs(x - mapX) > MAP_STEP_X / 2 ||
        Math.abs(z - mapZ) > MAP_STEP_Z / 2;
      if (stale) {
        mapGrid.innerHTML = buildMap(opts.sample, seen, opts.discoveries, x, z, dir);
        mapReady = true;
        mapX = x;
        mapZ = z;
        mapDir = dir;
        mapMarks = opts.discoveries.length;
        mapSeen = seen.size;
      }
      const h = opts.heightAt(x, z);
      const altitude = Number.isFinite(h) ? ' · ' + Math.round(h) + ' m' : '';
      mapCaption.textContent =
        MAP_SPAN + ' · you are at ' + Math.round(x) + ', ' + Math.round(z) + altitude;
      setPanel('map');
    },
    showControls(): void {
      setPanel('controls');
    },
    hideControls(): void {
      if (panel === 'controls') setPanel('none');
    },
    toggleControls(): void {
      setPanel(panel === 'controls' ? 'none' : 'controls');
    },
    hidePanels(): void {
      setPanel('none');
    },
    isPanelOpen(): boolean {
      return panel !== 'none';
    },
  };
}
