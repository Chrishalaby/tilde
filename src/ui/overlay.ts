import { CHUNK_SIZE } from '../config';
import type { Discovery } from '../state/db';

export interface Overlay {
  toast(text: string, ms?: number): void;
  showHint(text: string): void;
  hideHint(): void;
  setHidden(h: boolean): void;
  showJournal(letters: Set<string>, count: number): void;
  showMap(visited: Iterable<string>, discoveries: Discovery[], playerCx: number, playerCz: number): void;
  hidePanels(): void;
  isPanelOpen(): boolean;
}

const STYLE_ID = 'tilde-ui-style';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const UNKNOWN = '·';
const MAP_COLS = 41;
const MAP_ROWS = 21;
const TOAST_MS = 4000;

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

function glyphFor(d: Discovery): string {
  if (typeof d.letter === 'string' && d.letter.length > 0) return d.letter.charAt(0).toUpperCase();
  return 'o';
}

function chunkOf(v: number): number {
  return Math.floor((Number.isFinite(v) ? v : 0) / CHUNK_SIZE);
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
  mapEl.className = 'tilde-el tilde-panel';
  const mapGrid = doc.createElement('pre');
  mapGrid.className = 'tilde-grid';
  const mapClose = doc.createElement('div');
  mapClose.className = 'tilde-sub';
  mapClose.textContent = 'close: M';
  mapEl.appendChild(mapGrid);
  mapEl.appendChild(mapClose);

  root.appendChild(toastEl);
  root.appendChild(hintEl);
  root.appendChild(journalEl);
  root.appendChild(mapEl);

  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let panel: 'none' | 'journal' | 'map' = 'none';

  const setPanel = (next: 'none' | 'journal' | 'map'): void => {
    panel = next;
    journalEl.classList.toggle('tilde-open', next === 'journal');
    mapEl.classList.toggle('tilde-open', next === 'map');
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
    showMap(visited: Iterable<string>, discoveries: Discovery[], playerCx: number, playerCz: number): void {
      const seen = new Set<string>();
      for (const key of visited) {
        if (typeof key === 'string') seen.add(key);
      }
      const marks = new Map<string, string>();
      for (const d of discoveries) {
        if (!d) continue;
        marks.set(`${chunkOf(d.x)},${chunkOf(d.z)}`, glyphFor(d));
      }
      const midCol = (MAP_COLS - 1) / 2;
      const midRow = (MAP_ROWS - 1) / 2;
      const originX = Math.floor(Number.isFinite(playerCx) ? playerCx : 0);
      const originZ = Math.floor(Number.isFinite(playerCz) ? playerCz : 0);
      const rows: string[] = [];
      for (let r = 0; r < MAP_ROWS; r++) {
        let line = '';
        for (let c = 0; c < MAP_COLS; c++) {
          if (c === midCol && r === midRow) {
            line += '@';
            continue;
          }
          const key = `${originX + c - midCol},${originZ + r - midRow}`;
          const mark = marks.get(key);
          if (mark) line += mark;
          else if (seen.has(key)) line += '.';
          else line += ' ';
        }
        rows.push(line);
      }
      mapGrid.textContent = rows.join('\n');
      setPanel('map');
    },
    hidePanels(): void {
      setPanel('none');
    },
    isPanelOpen(): boolean {
      return panel !== 'none';
    },
  };
}
