export const KEY = 38;
export const PENTATONIC: readonly number[] = [0, 2, 4, 7, 9];
export const LYDIAN_FOURTH = 6;
export const SECOND_FLOOR = 60;
export const THIRD_FLOOR = 50;
export const DRONE_PITCHES: readonly number[] = [KEY, KEY + 7];

export const CENTER_WEIGHT = 0.5;
export const CLASH_COST = 3;
export const COMMON_TONE_BONUS = 1.2;
export const SECOND_COST = 1;

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function degreeOf(midi: number): number {
  return (((midi - KEY) % 12) + 12) % 12;
}

export function consonant(a: number, b: number): boolean {
  const d = Math.abs(a - b);
  if (d === 0) return true;
  const ic = d % 12;
  if (ic === 1 || ic === 6 || d === 11) return false;
  const low = Math.min(a, b);
  if (d <= 2 && low < SECOND_FLOOR) return false;
  if (d <= 4 && low < THIRD_FLOOR) return false;
  return true;
}

export function consonantSet(pitches: readonly number[]): boolean {
  for (let i = 0; i < pitches.length; i++) {
    for (let j = i + 1; j < pitches.length; j++) {
      if (!consonant(pitches[i], pitches[j])) return false;
    }
  }
  return true;
}

export interface ChordSpec {
  root: number;
  upper: readonly number[];
  fifth: boolean;
}

export const CHORDS = {
  'I6/9': { root: 0, upper: [4, 9, 14], fifth: true },
  Imaj9: { root: 0, upper: [4, 11, 14], fifth: true },
  ii7: { root: 2, upper: [3, 10], fifth: true },
  iii7: { root: 4, upper: [3, 10], fifth: true },
  IVmaj7: { root: 5, upper: [4, 11], fifth: true },
  'IV6/9': { root: 5, upper: [4, 9, 14], fifth: true },
  V11: { root: 7, upper: [10, 14, 17], fifth: false },
  Vadd9: { root: 7, upper: [4, 14], fifth: true },
  'vi7(11)': { root: 9, upper: [3, 10, 17], fifth: true },
  IIadd9: { root: 2, upper: [4, 14], fifth: true },
  Vmaj7: { root: 7, upper: [4, 11], fifth: true },
  vii7: { root: 11, upper: [3, 10], fifth: true },
} as const satisfies Record<string, ChordSpec>;

export type ChordName = keyof typeof CHORDS;
export const CHORD_NAMES = Object.keys(CHORDS) as ChordName[];
export const WARM_CHORDS: readonly ChordName[] = ['I6/9', 'Imaj9', 'IV6/9', 'IVmaj7'];

export function chordDegrees(name: ChordName): number[] {
  const spec: ChordSpec = CHORDS[name];
  const out = new Set<number>();
  out.add(spec.root % 12);
  if (spec.fifth) out.add((spec.root + 7) % 12);
  for (const i of spec.upper) out.add((spec.root + i) % 12);
  return Array.from(out);
}

export function stableDegrees(name: ChordName): number[] {
  const spec: ChordSpec = CHORDS[name];
  const out = [spec.root % 12];
  const third = spec.upper.find((i) => i === 3 || i === 4);
  if (third !== undefined) out.push((spec.root + third) % 12);
  if (spec.fifth) out.push((spec.root + 7) % 12);
  return out;
}

export interface VoicingOptions {
  pedal: readonly number[];
  low: number;
  high: number;
  maxUpper: number;
  center: number;
  previous: readonly number[];
}

export interface Voicing {
  bass: number[];
  upper: number[];
}

export function voicingPitches(v: Voicing): number[] {
  return v.bass.concat(v.upper);
}

function pitchesOf(degree: number, low: number, high: number): number[] {
  const out: number[] = [];
  for (let m = Math.ceil(low); m <= high; m++) if (degreeOf(m) === degree) out.push(m);
  return out;
}

function preferredSubsets(count: number, essential: number, maxSize: number): number[][] {
  const out: number[][] = [];
  const need = Math.min(essential, maxSize, count);
  for (let mask = 1; mask < 1 << count; mask++) {
    const picked: number[] = [];
    for (let i = 0; i < count; i++) if (mask & (1 << i)) picked.push(i);
    if (picked.length > maxSize) continue;
    let hasEssentials = true;
    for (let i = 0; i < need; i++) if (!(mask & (1 << i))) hasEssentials = false;
    if (hasEssentials) out.push(picked);
  }
  const rank = (s: number[]) => s.reduce((a, b) => a + b, 0);
  out.sort((a, b) => b.length - a.length || rank(a) - rank(b));
  return out;
}

export function playableVoicing(pitches: readonly number[], pedal: readonly number[]): boolean {
  const sorted = pitches.slice().sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap < (sorted[i - 1] < SECOND_FLOOR ? 3 : 2)) return false;
    if (i >= 2 && sorted[i] - sorted[i - 2] < 5) return false;
  }
  return consonantSet(sorted.concat(pedal));
}

function voicingCost(upper: readonly number[], full: readonly number[], opts: VoicingOptions): number {
  let cost = 0;
  if (opts.previous.length > 0) {
    for (const p of upper) {
      let nearest = Infinity;
      for (const q of opts.previous) nearest = Math.min(nearest, Math.abs(p - q));
      cost += nearest;
      if (nearest === 0) cost -= COMMON_TONE_BONUS;
    }
    for (const p of full) {
      for (const q of opts.previous) if (!consonant(p, q)) cost += CLASH_COST;
    }
  }
  const mean = upper.reduce((a, b) => a + b, 0) / Math.max(1, upper.length);
  cost += CENTER_WEIGHT * Math.abs(mean - opts.center);
  const sorted = full.slice().sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] <= 2) cost += SECOND_COST;
  return cost;
}

export function voiceChord(name: ChordName, opts: VoicingOptions): Voicing | null {
  const spec: ChordSpec = CHORDS[name];
  const root = spec.root % 12;
  const pedal = opts.pedal.length > 0;
  const bass: number[] = [];
  if (!pedal) {
    bass.push(KEY + root);
    if (spec.fifth) bass.push(KEY + root + 7);
  }
  const rootInDrone = opts.pedal.some((p) => degreeOf(p) === root);
  const doubledRoot = pedal && !rootInDrone;
  const intervals: number[] = pedal
    ? [spec.upper[0], ...(doubledRoot ? [0] : []), ...spec.upper.slice(1), ...(spec.fifth ? [7] : [])]
    : [...spec.upper, 0, ...(spec.fifth ? [7] : [])];
  const degrees = intervals.map((i) => (root + i) % 12);
  const essential = doubledRoot ? 2 : 1;
  for (const subset of preferredSubsets(degrees.length, essential, Math.max(1, opts.maxUpper))) {
    const options = subset.map((i) => pitchesOf(degrees[i], opts.low, opts.high));
    if (options.some((o) => o.length === 0)) continue;
    const best = cheapestPlacement(options, bass, opts);
    if (best) return { bass: bass.slice(), upper: best };
  }
  return null;
}

function cheapestPlacement(options: number[][], bass: readonly number[], opts: VoicingOptions): number[] | null {
  const found: { pitches: number[] | null; cost: number } = { pitches: null, cost: Infinity };
  const acc: number[] = [];
  const walk = (k: number): void => {
    if (k === options.length) {
      const full = bass.concat(acc);
      if (!playableVoicing(full, opts.pedal)) return;
      const cost = voicingCost(acc, full, opts);
      if (cost < found.cost) {
        found.cost = cost;
        found.pitches = acc.slice().sort((a, b) => a - b);
      }
      return;
    }
    for (const p of options[k]) {
      if (acc.includes(p)) continue;
      acc.push(p);
      walk(k + 1);
      acc.pop();
    }
  };
  walk(0);
  return found.pitches;
}

export interface PoolNote {
  midi: number;
  chord: boolean;
  stable: boolean;
}

export function melodyPool(name: ChordName, lydian: boolean, low: number, high: number): PoolNote[] {
  const tones = new Set(chordDegrees(name));
  const stable = new Set(stableDegrees(name));
  const passing = new Set(PENTATONIC);
  if (lydian) passing.add(LYDIAN_FOURTH);
  const out: PoolNote[] = [];
  for (let m = Math.ceil(low); m <= high; m++) {
    const d = degreeOf(m);
    if (tones.has(d)) out.push({ midi: m, chord: true, stable: stable.has(d) });
    else if (passing.has(d)) out.push({ midi: m, chord: false, stable: false });
  }
  return out;
}

export type ModeName = 'major' | 'lydian' | 'aeolian' | 'dorian';

export type Weights = Partial<Record<ChordName, number>>;

export interface Mode {
  home: ChordName;
  entry: Weights;
  rows: Partial<Record<ChordName, Weights>>;
}

export const MODES: Record<ModeName, Mode> = {
  major: {
    home: 'I6/9',
    entry: { 'I6/9': 3, 'IV6/9': 1, 'vi7(11)': 1 },
    rows: {
      'I6/9': { IVmaj7: 2, 'vi7(11)': 3, ii7: 2, 'IV6/9': 2, iii7: 1, Imaj9: 2 },
      Imaj9: { 'IV6/9': 3, 'vi7(11)': 2, iii7: 2, ii7: 1, 'I6/9': 1 },
      ii7: { 'I6/9': 2, Imaj9: 2, V11: 2, IVmaj7: 1, 'vi7(11)': 1 },
      iii7: { 'vi7(11)': 3, IVmaj7: 3, ii7: 1, 'IV6/9': 1 },
      IVmaj7: { 'I6/9': 2, Imaj9: 3, 'vi7(11)': 2, iii7: 1, V11: 1, ii7: 1 },
      'IV6/9': { 'I6/9': 2, Imaj9: 3, 'vi7(11)': 2, V11: 1 },
      V11: { 'I6/9': 3, Imaj9: 2, 'vi7(11)': 2 },
      'vi7(11)': { IVmaj7: 3, 'IV6/9': 2, ii7: 2, 'I6/9': 2, iii7: 1 },
    },
  },
  lydian: {
    home: 'Imaj9',
    entry: { Imaj9: 2, 'I6/9': 1, IIadd9: 2 },
    rows: {
      'I6/9': { IIadd9: 4, 'vi7(11)': 2, Vmaj7: 2, iii7: 1, Imaj9: 1 },
      Imaj9: { IIadd9: 4, Vmaj7: 2, iii7: 2, 'vi7(11)': 1 },
      IIadd9: { 'I6/9': 3, Imaj9: 3, vii7: 1, Vmaj7: 1 },
      Vmaj7: { IIadd9: 2, 'I6/9': 2, iii7: 2, 'vi7(11)': 1 },
      vii7: { iii7: 2, Vmaj7: 2, IIadd9: 1 },
      iii7: { 'vi7(11)': 2, IIadd9: 2, Vmaj7: 1, Imaj9: 1 },
      'vi7(11)': { IIadd9: 2, 'I6/9': 2, iii7: 1, Vmaj7: 1 },
    },
  },
  aeolian: {
    home: 'vi7(11)',
    entry: { 'vi7(11)': 3, IVmaj7: 1 },
    rows: {
      'vi7(11)': { IVmaj7: 3, ii7: 2, Vadd9: 2, 'I6/9': 1 },
      IVmaj7: { Vadd9: 2, 'vi7(11)': 3, 'I6/9': 1, ii7: 1 },
      Vadd9: { 'vi7(11)': 3, IVmaj7: 1, ii7: 1 },
      ii7: { 'vi7(11)': 2, IVmaj7: 2, Vadd9: 1 },
      'I6/9': { 'vi7(11)': 2, IVmaj7: 2, Vadd9: 1 },
      iii7: { 'vi7(11)': 2, IVmaj7: 1 },
    },
  },
  dorian: {
    home: 'ii7',
    entry: { ii7: 3, Vadd9: 1 },
    rows: {
      ii7: { Vadd9: 3, 'vi7(11)': 2, IVmaj7: 1, 'I6/9': 1 },
      Vadd9: { ii7: 3, IVmaj7: 1, 'I6/9': 1 },
      'vi7(11)': { ii7: 2, IVmaj7: 1, Vadd9: 1 },
      IVmaj7: { ii7: 2, Vadd9: 1, 'vi7(11)': 1 },
      'I6/9': { ii7: 2, Vadd9: 1, 'vi7(11)': 1 },
      iii7: { ii7: 1, 'vi7(11)': 1 },
    },
  },
};

export function nextChordWeights(mode: ModeName, from: ChordName | null): Weights {
  const m = MODES[mode];
  const row = from ? m.rows[from] : undefined;
  const source = row ?? m.entry;
  const out: Weights = {};
  for (const name of Object.keys(source) as ChordName[]) {
    if (name === from) continue;
    out[name] = source[name];
  }
  return out;
}
