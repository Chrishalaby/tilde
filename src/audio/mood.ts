import { MATERIAL } from '../config';
import { clamp01, smoothstep } from './rng';
import type { ModeName } from './theory';

export type PlaceName = 'grass' | 'forest' | 'sand' | 'stone' | 'snow' | 'water';

export interface PlaceProfile {
  mode: ModeName;
  pedal: boolean;
  sparse: number;
  maxUpper: number;
  birds: number;
  insects: number;
}

export const PLACES: Record<PlaceName, PlaceProfile> = {
  grass: { mode: 'major', pedal: false, sparse: 1, maxUpper: 3, birds: 1, insects: 1 },
  forest: { mode: 'major', pedal: true, sparse: 1.1, maxUpper: 3, birds: 1.2, insects: 1.2 },
  sand: { mode: 'major', pedal: false, sparse: 1.35, maxUpper: 3, birds: 0.4, insects: 0.6 },
  stone: { mode: 'aeolian', pedal: false, sparse: 1.5, maxUpper: 2, birds: 0.25, insects: 0.3 },
  snow: { mode: 'dorian', pedal: false, sparse: 1.7, maxUpper: 2, birds: 0, insects: 0 },
  water: { mode: 'major', pedal: false, sparse: 1, maxUpper: 3, birds: 0.3, insects: 0.4 },
};

export const PLACE_SETTLE = 8;
export const WET_TAU = 3;
export const WATER_ON = 0.35;
export const WATER_OFF = 0.15;
export const GLOW_DAWN = 0.26;
export const GLOW_DUSK = 0.745;
export const GLOW_WIDTH = 0.06;

export interface Mood {
  place: PlaceName;
  water: boolean;
  daylight: number;
  glow: number;
}

export interface MoodInput {
  biome: number;
  nearWater: number;
  timeOfDay: number;
}

export interface MoodState {
  place: PlaceName;
  candidate: PlaceName;
  candidateFor: number;
  wet: number;
  water: boolean;
  timeOfDay: number;
}

export function placeOf(biome: number): PlaceName | null {
  switch (biome) {
    case MATERIAL.FOREST:
      return 'forest';
    case MATERIAL.SAND:
      return 'sand';
    case MATERIAL.STONE:
      return 'stone';
    case MATERIAL.SNOW:
      return 'snow';
    case MATERIAL.WATER:
      return 'water';
    case MATERIAL.GRASS:
      return 'grass';
    default:
      return null;
  }
}

function wrap01(t: number): number {
  if (!Number.isFinite(t)) return 0.5;
  return t - Math.floor(t);
}

export function daylight(timeOfDay: number): number {
  const t = wrap01(timeOfDay);
  return clamp01(smoothstep(0.2, 0.31, t) - smoothstep(0.69, 0.8, t));
}

export function glow(timeOfDay: number): number {
  const t = wrap01(timeOfDay);
  const dawn = 1 - smoothstep(0, GLOW_WIDTH, Math.abs(t - GLOW_DAWN));
  const dusk = 1 - smoothstep(0, GLOW_WIDTH, Math.abs(t - GLOW_DUSK));
  return Math.max(dawn, dusk);
}

export function initialMood(input: MoodInput): MoodState {
  const place = placeOf(input.biome) ?? 'grass';
  const wet = clamp01(input.nearWater);
  return { place, candidate: place, candidateFor: 0, wet, water: wet >= WATER_ON, timeOfDay: wrap01(input.timeOfDay) };
}

export function stepMood(state: MoodState, input: MoodInput, dt: number): MoodState {
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const seen = placeOf(input.biome) ?? state.place;
  let place = state.place;
  let candidate = state.candidate;
  let candidateFor = state.candidateFor;
  if (seen === place) {
    candidate = place;
    candidateFor = 0;
  } else if (seen === candidate) {
    candidateFor += step;
    if (candidateFor >= PLACE_SETTLE) {
      place = seen;
      candidateFor = 0;
    }
  } else {
    candidate = seen;
    candidateFor = step;
  }
  const target = clamp01(input.nearWater);
  const wet = state.wet + (target - state.wet) * (1 - Math.exp(-step / WET_TAU));
  const water = state.water ? wet > WATER_OFF : wet >= WATER_ON;
  return { place, candidate, candidateFor, wet, water, timeOfDay: wrap01(input.timeOfDay) };
}

export function moodOf(state: MoodState): Mood {
  return { place: state.place, water: state.water, daylight: daylight(state.timeOfDay), glow: glow(state.timeOfDay) };
}

export function modeFor(mood: Mood): ModeName {
  const profile = PLACES[mood.place];
  if (profile.mode === 'major' && mood.water && !profile.pedal) return 'lydian';
  return profile.mode;
}

export interface Tone {
  padCutoff: number;
  reverb: number;
  trim: number;
}

export const PAD_CUTOFF_DAY = 1050;
export const PAD_CUTOFF_NIGHT = 820;
export const PAD_CUTOFF_GLOW = 150;
export const REVERB_DAY = 0.3;
export const REVERB_NIGHT = 0.44;
export const TRIM_GLOW = 0.12;
export const TRIM_NIGHT = 0.1;

export function toneFor(mood: Mood): Tone {
  const night = 1 - mood.daylight;
  return {
    padCutoff: PAD_CUTOFF_DAY + (PAD_CUTOFF_NIGHT - PAD_CUTOFF_DAY) * night + PAD_CUTOFF_GLOW * mood.glow,
    reverb: REVERB_DAY + (REVERB_NIGHT - REVERB_DAY) * night,
    trim: 1 + TRIM_GLOW * mood.glow - TRIM_NIGHT * night,
  };
}
