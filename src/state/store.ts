import { CELL_H, CELL_MAX, CELL_MIN, CELL_W } from '../config';

export interface Settings {
  cellW: number;
  cellH: number;
  volume: number;
  grain: boolean;
  headBob: boolean;
}

export interface WorldRecord {
  seed: number;
  genVersion: number;
}

export interface Pose {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  timeOfDay: number;
}

export const DEFAULT_SETTINGS: Settings = {
  cellW: CELL_W,
  cellH: CELL_H,
  volume: 0.7,
  grain: true,
  headBob: true,
};

const SETTINGS_KEY = 'tilde.settings';
const WORLD_KEY = 'tilde.world';
const POSE_KEY = 'tilde.pose';

function storage(): Storage | null {
  try {
    const s = globalThis.localStorage as Storage | undefined;
    if (!s || typeof s.getItem !== 'function' || typeof s.setItem !== 'function') return null;
    return s;
  } catch {
    return null;
  }
}

function readJson(key: string): unknown {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (typeof raw !== 'string' || raw.length === 0) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function numberOr(v: unknown, fallback: number): number {
  const n = asNumber(v);
  return n === null ? fallback : n;
}

function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrap01(v: number): number {
  const w = v % 1;
  return w < 0 ? w + 1 : w;
}

export function loadSettings(): Settings {
  const raw = readJson(SETTINGS_KEY);
  if (!isRecord(raw)) return { ...DEFAULT_SETTINGS };
  return {
    cellW: clamp(Math.round(numberOr(raw.cellW, DEFAULT_SETTINGS.cellW)), CELL_MIN[0], CELL_MAX[0]),
    cellH: clamp(Math.round(numberOr(raw.cellH, DEFAULT_SETTINGS.cellH)), CELL_MIN[1], CELL_MAX[1]),
    volume: clamp(numberOr(raw.volume, DEFAULT_SETTINGS.volume), 0, 1),
    grain: boolOr(raw.grain, DEFAULT_SETTINGS.grain),
    headBob: boolOr(raw.headBob, DEFAULT_SETTINGS.headBob),
  };
}

export function saveSettings(s: Settings): void {
  if (!isRecord(s)) return;
  writeJson(SETTINGS_KEY, {
    cellW: numberOr(s.cellW, DEFAULT_SETTINGS.cellW),
    cellH: numberOr(s.cellH, DEFAULT_SETTINGS.cellH),
    volume: numberOr(s.volume, DEFAULT_SETTINGS.volume),
    grain: boolOr(s.grain, DEFAULT_SETTINGS.grain),
    headBob: boolOr(s.headBob, DEFAULT_SETTINGS.headBob),
  });
}

export function loadWorld(): WorldRecord | null {
  const raw = readJson(WORLD_KEY);
  if (!isRecord(raw)) return null;
  const seed = asNumber(raw.seed);
  const genVersion = asNumber(raw.genVersion);
  if (seed === null || genVersion === null) return null;
  return { seed, genVersion };
}

export function saveWorld(w: WorldRecord): void {
  if (!isRecord(w)) return;
  const seed = asNumber(w.seed);
  const genVersion = asNumber(w.genVersion);
  if (seed === null || genVersion === null) return;
  writeJson(WORLD_KEY, { seed, genVersion });
}

export function loadPose(): Pose | null {
  const raw = readJson(POSE_KEY);
  if (!isRecord(raw)) return null;
  const x = asNumber(raw.x);
  const z = asNumber(raw.z);
  const yaw = asNumber(raw.yaw);
  const pitch = asNumber(raw.pitch);
  const timeOfDay = asNumber(raw.timeOfDay);
  if (x === null || z === null || yaw === null || pitch === null || timeOfDay === null) return null;
  return { x, z, yaw, pitch, timeOfDay: wrap01(timeOfDay) };
}

export function savePose(p: Pose): void {
  if (!isRecord(p)) return;
  const x = asNumber(p.x);
  const z = asNumber(p.z);
  const yaw = asNumber(p.yaw);
  const pitch = asNumber(p.pitch);
  const timeOfDay = asNumber(p.timeOfDay);
  if (x === null || z === null || yaw === null || pitch === null || timeOfDay === null) return;
  writeJson(POSE_KEY, { x, z, yaw, pitch, timeOfDay: wrap01(timeOfDay) });
}
