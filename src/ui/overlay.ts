import { CHUNK_SIZE, MATERIAL, PROP } from '../config';
import type { Discovery, PersonEntry, TraceEntry } from '../state/db';

export interface MapView {
  sample(x: number, z: number): number;
  heightAt(x: number, z: number): number;
  visited: ReadonlySet<string> | Iterable<string>;
  discoveries: Discovery[];
  x: number;
  z: number;
  yaw: number;
}

export interface JournalView {
  letters: ReadonlySet<string>;
  places: readonly Discovery[];
  people: readonly PersonEntry[];
  traces: readonly TraceEntry[];
  startX: number;
  startZ: number;
  day: number;
  walked: number;
}

export type JournalTone = 'head' | 'row' | 'text' | 'quote' | 'dim' | 'gap';

export interface JournalLine {
  tone: JournalTone;
  text: string;
}

export interface DialogueLine {
  who: 'player' | 'npc';
  text: string;
}

export interface DialogueView {
  title: string;
  speaker: string;
  lines: readonly DialogueLine[];
  pending: boolean;
}

export interface DialogueHandlers {
  send(text: string): boolean;
  close(): void;
}

export interface Overlay {
  toast(text: string, ms?: number): void;
  showHint(text: string): void;
  hideHint(): void;
  showPrompt(text: string): void;
  hidePrompt(): void;
  setHidden(h: boolean): void;
  showJournal(view: JournalView): void;
  showMap(opts: MapView): void;
  showControls(): void;
  hideControls(): void;
  toggleControls(): void;
  hidePanels(): void;
  isPanelOpen(): boolean;
  showDialogue(view: DialogueView, handlers: DialogueHandlers): void;
  hideDialogue(): void;
  focusDialogue(): void;
  isDialogueOpen(): boolean;
}

const STYLE_ID = 'tilde-ui-style';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const UNKNOWN = '·';
const TOAST_MS = 4000;

const PLACES_SHOWN = 5;
const PEOPLE_SHOWN = 3;
const PLACE_COLUMN = 19;
const WHERE_COLUMN = 20;
const PERSON_COLUMN = 39;
const DIALOGUE_LINES = 6;
const INPUT_LIMIT = 240;

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

const TRACES: ReadonlyArray<readonly [number, string, string]> = [
  [PROP.WRECK, 'a shipwreck', 'shipwrecks'],
  [PROP.COLD_FIRE, 'a cold campfire', 'cold campfires'],
  [PROP.CAIRN, 'a cairn', 'cairns'],
  [PROP.FALLEN, 'a toppled letter', 'toppled letters'],
  [PROP.STEPPING, 'stepping stones', 'sets of stepping stones'],
  [PROP.DOOR, 'a lone door', 'lone doors'],
  [PROP.STUMPS, 'a clearing of stumps', 'clearings of stumps'],
];

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
  ['space', 'jump'],
  ['e', 'talk'],
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

export function traceName(kind: number): string | null {
  for (const [id, one] of TRACES) if (id === kind) return one;
  return null;
}

export function isTraceKind(kind: number): boolean {
  return traceName(kind) !== null;
}

export function placeName(kind: string, letter: string | null): string {
  if (kind === 'letter') return letter ? `the letter ${letter.toLowerCase()}` : 'a letter';
  if (kind === 'castle') return 'a castle';
  if (kind === 'ring') return 'a stone ring';
  if (kind === 'tree') return 'a lone tall tree';
  if (kind === 'pool') return 'a still pool';
  if (kind === 'shelter') return 'a shelter';
  return 'something standing';
}

function compass(dx: number, dz: number): string {
  const step = Math.round(Math.atan2(dx, -dz) / (Math.PI / 4));
  return COMPASS[((step % 8) + 8) % 8];
}

export function whereFrom(dx: number, dz: number): string {
  const d = Math.hypot(dx, dz);
  if (!Number.isFinite(d) || d < 75) return 'where you started';
  const metres = Math.max(100, Math.round(d / 50) * 50);
  const far = metres >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${metres} m`;
  return `${far} ${compass(dx, dz)}`;
}

function dayText(day: number | undefined): string {
  return typeof day === 'number' && Number.isFinite(day) ? `day ${day}` : '';
}

function lettersIn(letters: ReadonlySet<string>): Set<string> {
  const have = new Set<string>();
  for (const raw of letters) {
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const ch = raw.charAt(0).toUpperCase();
    if (ch >= 'A' && ch <= 'Z') have.add(ch);
  }
  return have;
}

function traceTally(traces: readonly TraceEntry[]): string[] {
  const counts = new Map<number, number>();
  for (const trace of traces) counts.set(trace.kind, (counts.get(trace.kind) ?? 0) + 1);
  const parts: string[] = [];
  for (const [kind, one, many] of TRACES) {
    const n = counts.get(kind) ?? 0;
    if (n === 1) parts.push(one);
    else if (n > 1) parts.push(`${n} ${many}`);
  }
  return parts;
}

export function journalLines(view: JournalView): JournalLine[] {
  const out: JournalLine[] = [];
  const push = (tone: JournalTone, text = ''): void => {
    out.push({ tone, text });
  };

  const have = lettersIn(view.letters);
  const cells: string[] = [];
  for (const ch of ALPHABET) cells.push(have.has(ch) ? ch : UNKNOWN);
  push('head', 'letters');
  push('text', cells.join(' '));
  push('dim', `${have.size} of 26`);
  push('gap');

  push('head', 'places, from where you started');
  if (view.places.length === 0) push('dim', 'nothing yet');
  const places = view.places.slice(-PLACES_SHOWN);
  if (view.places.length > places.length) push('dim', `${view.places.length - places.length} earlier`);
  for (const place of places) {
    const name = placeName(place.kind, place.letter).padEnd(PLACE_COLUMN);
    const where = whereFrom(place.x - view.startX, place.z - view.startZ).padEnd(WHERE_COLUMN);
    push('row', (name + where + dayText(place.day)).trimEnd());
  }
  push('gap');

  push('head', 'people');
  if (view.people.length === 0) push('dim', 'no one yet');
  const people = view.people.slice(-PEOPLE_SHOWN);
  if (view.people.length > people.length) push('dim', `${view.people.length - people.length} earlier`);
  for (const person of people) {
    const who = `${person.name}, ${person.home}`.padEnd(PERSON_COLUMN);
    push('row', (who + dayText(person.day)).trimEnd());
    if (person.said.length > 0) push('quote', `“${person.said}”`);
  }
  push('gap');

  push('head', 'traces');
  const tally = traceTally(view.traces);
  push(tally.length === 0 ? 'dim' : 'text', tally.length === 0 ? 'nothing yet' : tally.join(' · '));
  push('gap');

  const km = Math.max(0, Number.isFinite(view.walked) ? view.walked : 0) / 1000;
  push('dim', `day ${Math.max(1, Math.floor(view.day) || 1)} · ${km.toFixed(1)} km walked`);
  push('dim', 'press j to close');
  return out;
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
.tilde-prompt {
  text-shadow: 0 0 2px var(--paper), 0 0 6px var(--paper), 0 1px 0 var(--paper);
  left: 0;
  right: 0;
  bottom: 22%;
  text-align: center;
  font-size: 13px;
  line-height: 1.45;
  opacity: 0;
  transition: opacity 250ms ease;
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
.tilde-panel.tilde-journal {
  width: 56ch;
  max-width: calc(100vw - 72px);
  max-height: calc(100vh - 48px);
  overflow: hidden;
  font-size: 14px;
  line-height: 1.45;
  white-space: normal;
  text-align: left;
}
.tilde-journal .tj-head {
  color: color-mix(in srgb, var(--ink) 55%, transparent);
  letter-spacing: 0.12em;
}
.tilde-journal .tj-row { white-space: pre; overflow: hidden; text-overflow: ellipsis; }
.tilde-journal .tj-text { white-space: pre-wrap; }
.tilde-journal .tj-quote {
  padding-left: 2ch;
  color: color-mix(in srgb, var(--ink) 80%, transparent);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.tilde-journal .tj-dim { color: color-mix(in srgb, var(--ink) 55%, transparent); }
.tilde-journal .tj-gap { height: 0.8em; }
@media (max-height: 720px) {
  .tilde-panel.tilde-journal { font-size: 12px; line-height: 1.35; padding: 12px 16px; }
}
.tilde-ui > .tilde-el.tilde-dialogue {
  pointer-events: auto;
  left: 50%;
  bottom: 5vh;
  transform: translateX(-50%);
  width: min(620px, calc(100vw - 32px));
  box-sizing: border-box;
  display: none;
  padding: 12px 18px 10px;
  font-size: 14px;
  line-height: 1.5;
  background: color-mix(in srgb, var(--paper) 92%, transparent);
  border: 1px solid color-mix(in srgb, var(--ink) 30%, transparent);
}
.tilde-ui > .tilde-el.tilde-dialogue.tilde-open { display: block; }
.tilde-dialogue .td-title {
  margin-bottom: 8px;
  color: color-mix(in srgb, var(--ink) 55%, transparent);
}
.tilde-dialogue .td-line,
.tilde-dialogue .td-row {
  display: grid;
  grid-template-columns: var(--td-who, 6ch) 1fr;
  column-gap: 2ch;
  align-items: baseline;
}
.tilde-dialogue .td-line { margin-bottom: 4px; }
.tilde-dialogue .td-who { color: color-mix(in srgb, var(--ink) 55%, transparent); }
.tilde-dialogue .td-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.tilde-dialogue .td-you .td-text { color: color-mix(in srgb, var(--ink) 72%, transparent); }
.tilde-dialogue .td-wait .td-text { animation: td-breathe 1.6s ease-in-out infinite; }
.tilde-dialogue .td-row {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid color-mix(in srgb, var(--ink) 16%, transparent);
}
.tilde-dialogue .td-input {
  width: 100%;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--ink);
  caret-color: var(--ink);
  font: inherit;
  letter-spacing: inherit;
}
.tilde-dialogue .td-input::placeholder { color: color-mix(in srgb, var(--ink) 40%, transparent); }
.tilde-dialogue .td-foot {
  margin-top: 6px;
  font-size: 12px;
  color: color-mix(in srgb, var(--ink) 45%, transparent);
}
@keyframes td-breathe { 50% { opacity: 0.3; } }
@media (prefers-reduced-motion: reduce) {
  .tilde-toast, .tilde-hint, .tilde-prompt { transition: none; }
  .tilde-dialogue .td-wait .td-text { animation: none; }
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

  const promptEl = doc.createElement('div');
  promptEl.className = 'tilde-el tilde-prompt';

  const journalEl = doc.createElement('div');
  journalEl.className = 'tilde-el tilde-panel tilde-journal';

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

  const dialogueEl = doc.createElement('div');
  dialogueEl.className = 'tilde-el tilde-dialogue';
  dialogueEl.setAttribute('role', 'dialog');
  const dialogueTitle = doc.createElement('div');
  dialogueTitle.className = 'td-title';
  const dialogueLog = doc.createElement('div');
  dialogueLog.className = 'td-log';
  dialogueLog.setAttribute('aria-live', 'polite');
  const dialogueRow = doc.createElement('div');
  dialogueRow.className = 'td-row';
  const dialogueYou = doc.createElement('span');
  dialogueYou.className = 'td-who';
  dialogueYou.textContent = 'you';
  const dialogueInput = doc.createElement('input');
  dialogueInput.className = 'td-input';
  dialogueInput.type = 'text';
  dialogueInput.maxLength = INPUT_LIMIT;
  dialogueInput.autocomplete = 'off';
  dialogueInput.spellcheck = false;
  dialogueInput.placeholder = 'say something';
  dialogueInput.setAttribute('autocapitalize', 'off');
  dialogueInput.setAttribute('enterkeyhint', 'send');
  dialogueInput.setAttribute('aria-label', 'what you say');
  const dialogueFoot = doc.createElement('div');
  dialogueFoot.className = 'td-foot';
  dialogueFoot.textContent = 'enter — say it · enter alone — listen · esc — leave';
  dialogueRow.appendChild(dialogueYou);
  dialogueRow.appendChild(dialogueInput);
  dialogueEl.appendChild(dialogueTitle);
  dialogueEl.appendChild(dialogueLog);
  dialogueEl.appendChild(dialogueRow);
  dialogueEl.appendChild(dialogueFoot);

  root.appendChild(toastEl);
  root.appendChild(hintEl);
  root.appendChild(promptEl);
  root.appendChild(journalEl);
  root.appendChild(mapEl);
  root.appendChild(controlsEl);
  root.appendChild(dialogueEl);

  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let panel: Panel = 'none';
  let dialogueOpen = false;
  let dialogueHandlers: DialogueHandlers | null = null;

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

  const focusInput = (): void => {
    if (!dialogueOpen) return;
    try {
      dialogueInput.focus({ preventScroll: true });
    } catch {
      return;
    }
  };

  const logLine = (who: string, text: string, tone: string): void => {
    const line = doc.createElement('div');
    line.className = tone.length > 0 ? 'td-line ' + tone : 'td-line';
    const name = doc.createElement('span');
    name.className = 'td-who';
    name.textContent = who;
    const said = doc.createElement('span');
    said.className = 'td-text';
    said.textContent = text;
    line.appendChild(name);
    line.appendChild(said);
    dialogueLog.appendChild(line);
  };

  const renderDialogue = (view: DialogueView): void => {
    dialogueTitle.textContent = view.title;
    const width = Math.max(3, view.speaker.length) + 1;
    dialogueEl.style.setProperty('--td-who', width + 'ch');
    dialogueLog.textContent = '';
    const shown = view.lines.slice(view.pending ? -(DIALOGUE_LINES - 1) : -DIALOGUE_LINES);
    for (const line of shown) {
      if (line.who === 'player') logLine('you', line.text, 'td-you');
      else logLine(view.speaker, line.text, '');
    }
    if (view.pending) logLine(view.speaker, '…', 'td-wait');
  };

  dialogueInput.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.isComposing) return;
    if (ev.repeat && dialogueInput.value.length === 0) {
      ev.preventDefault();
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (dialogueHandlers && dialogueHandlers.send(dialogueInput.value)) dialogueInput.value = '';
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      if (dialogueHandlers) dialogueHandlers.close();
    }
  });

  dialogueEl.addEventListener('mousedown', (ev: MouseEvent) => {
    if (ev.target === dialogueInput) return;
    ev.preventDefault();
    focusInput();
  });

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
    showPrompt(text: string): void {
      if (promptEl.textContent !== text) promptEl.textContent = text;
      promptEl.classList.add('tilde-on');
    },
    hidePrompt(): void {
      promptEl.classList.remove('tilde-on');
    },
    setHidden(h: boolean): void {
      root.classList.toggle('tilde-hidden', h);
    },
    showJournal(view: JournalView): void {
      journalEl.textContent = '';
      for (const line of journalLines(view)) {
        const el = doc.createElement('div');
        el.className = 'tj-' + line.tone;
        el.textContent = line.text;
        journalEl.appendChild(el);
      }
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
    showDialogue(view: DialogueView, handlers: DialogueHandlers): void {
      dialogueHandlers = handlers;
      renderDialogue(view);
      if (dialogueOpen) return;
      dialogueOpen = true;
      dialogueInput.value = '';
      dialogueEl.classList.add('tilde-open');
    },
    hideDialogue(): void {
      if (!dialogueOpen) return;
      dialogueOpen = false;
      dialogueHandlers = null;
      dialogueEl.classList.remove('tilde-open');
      dialogueInput.value = '';
      try {
        dialogueInput.blur();
      } catch {
        return;
      }
    },
    focusDialogue(): void {
      focusInput();
    },
    isDialogueOpen(): boolean {
      return dialogueOpen;
    },
  };
}
