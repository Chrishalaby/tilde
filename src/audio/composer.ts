import { PLACES, modeFor, type Mood } from './mood';
import { between, chance, clamp, createRng, weighted, type Rng } from './rng';
import {
  CHORDS,
  DRONE_PITCHES,
  MODES,
  WARM_CHORDS,
  chordDegrees,
  consonant,
  degreeOf,
  melodyPool,
  nextChordWeights,
  stableDegrees,
  voiceChord,
  voicingPitches,
  type ChordName,
  type ChordSpec,
  type PoolNote,
  type Voicing,
  type VoicingOptions,
  type Weights,
} from './theory';

export type Part = 'pad' | 'drone' | 'melody' | 'bell';

export interface NoteOn {
  kind: 'on';
  time: number;
  id: number;
  part: Part;
  midi: number;
  level: number;
  attack: number;
  duration: number;
  pan: number;
  phrase: number;
}

export interface NoteOff {
  kind: 'off';
  time: number;
  id: number;
  release: number;
}

export interface PanGlide {
  kind: 'pan';
  time: number;
  id: number;
  pan: number;
  glide: number;
}

export interface BreathChange {
  kind: 'breath';
  time: number;
  level: number;
  glide: number;
}

export interface ChordChange {
  kind: 'chord';
  time: number;
  name: ChordName;
  hold: number;
}

export type MusicEvent = NoteOn | NoteOff | PanGlide | BreathChange | ChordChange;

export const LEAD = 6;
export const CATCH_UP = 2;
export const EARLY = 5;
export const HOLD_MIN = 16;
export const HOLD_MAX = 32;
export const HOLD_SPREAD = 10;
export const HOLD_SLOW = 6;
export const PAD_ATTACK_MIN = 4;
export const PAD_ATTACK_MAX = 8;
export const PAD_ATTACK_NIGHT = 6;
export const PAD_RELEASE_MIN = 8;
export const PAD_RELEASE_MAX = 14;
export const PAD_RELEASE_NIGHT = 11;
export const DRONE_ATTACK = 8;
export const DRONE_RELEASE = 12;
export const MIN_SUSTAIN = 2;
export const ENTRY_GAP = 0.25;
export const CLASH_AVERSION = 0.3;
export const RETURN_AVERSION = 0.4;
export const BRIDGE_HOLD = 5;
export const BRIDGE_MIN = 2;
export const THIN_PENALTY = 0.25;

export const BASS_LEVEL = 0.045;
export const FIFTH_LEVEL = 0.03;
export const UPPER_LEVEL = 0.027;
export const DRONE_LEVELS: readonly number[] = [0.05, 0.026];
export const BASS_PAN = 0.08;
export const FIFTH_PAN = 0.16;
export const UPPER_PAN = 0.45;
export const PAN_DRIFT = 0.15;

export const UPPER_LOW = 52;
export const UPPER_LOW_PEDAL = 50;
export const UPPER_HIGH = 69;
export const UPPER_HIGH_NIGHT = 66;
export const UPPER_CENTER = 60;
export const UPPER_CENTER_NIGHT = 57;

export const MELODY_LOW = 60;
export const MELODY_HIGH = 76;
export const MELODY_NIGHT_DROP = 4;
export const MAX_LEAP = 5;
export const MELODY_LEVEL = 0.06;
export const MELODY_ATTACK_MIN = 0.06;
export const MELODY_ATTACK_MAX = 0.12;
export const NOTE_GAP_MIN = 1.6;
export const NOTE_GAP_MAX = 2.8;
export const RING_MIN = 4.6;
export const RING_MAX = 5.8;
export const LAST_RING_EXTRA = 1.2;
export const NIGHT_SLOW = 0.35;
export const NIGHT_RING = 0.2;
export const REST_MIN = 16;
export const REST_MAX = 34;
export const NIGHT_REST = 0.6;
export const GLOW_REST = 0.15;
export const FIRST_CHORD_DELAY = 0.25;
export const FIRST_PHRASE_MIN = 9;
export const FIRST_PHRASE_MAX = 16;
export const MELODY_PAN = 0.3;
export const RETURN_WEIGHT = 0.3;

export const BREATH_START = 0.6;
export const BREATH_MIN = 0.4;
export const BREATH_MAX = 1;
export const BREATH_STEP = 0.25;
export const BREATH_MEAN = 0.72;
export const BREATH_SKIP_BELOW = 0.5;

export const BELL_LOW = 55;
export const BELL_HIGH = 67;
export const BELL_FALLBACK_LOW = 50;
export const BELL_FALLBACK_HIGH = 69;
export const BELL_LEVEL = 0.05;
export const BELL_ATTACK = 0.025;
export const BELL_DURATION = 6.5;
export const BELL_COOLDOWN = 3;
export const BELL_PAN = 0.2;

const STEP_WEIGHTS: readonly number[] = [0, 0, 3, 3, 2, 1.2];

export type Contour = 'fall' | 'arch' | 'rise';

export interface Composer {
  advance(until: number, mood: Mood, now?: number): MusicEvent[];
  bell(time: number): NoteOn | null;
  chordAt(time: number): ChordName | null;
}

interface Voice {
  id: number;
  part: Part;
  midi: number;
  start: number;
  attack: number;
  end: number;
  pan: number;
  panRange: number;
}

interface Target {
  part: Part;
  midi: number;
  level: number;
  panRange: number;
  stagger: number;
}

interface Planned {
  midi: number;
  start: number;
  end: number;
}

export function nightOf(mood: Mood): number {
  return clamp(1 - mood.daylight, 0, 1);
}

export function chordHold(rng: Rng, mood: Mood): number {
  const slow = Math.max(nightOf(mood), mood.glow * 0.5);
  return clamp(HOLD_MIN + HOLD_SLOW * slow + HOLD_SPREAD * rng(), HOLD_MIN, HOLD_MAX);
}

export function nextBreath(rng: Rng, previous: number, mood: Mood): number {
  const mean = BREATH_MEAN + 0.1 * mood.glow - 0.1 * nightOf(mood);
  const step = clamp((mean - previous) * 0.35 + between(rng, -0.2, 0.2), -BREATH_STEP, BREATH_STEP);
  return clamp(previous + step, BREATH_MIN, BREATH_MAX);
}

export function melodyRange(mood: Mood): [number, number] {
  return [MELODY_LOW, Math.round(MELODY_HIGH - MELODY_NIGHT_DROP * nightOf(mood))];
}

export function voicingOptionsFor(mood: Mood, previous: readonly number[]): VoicingOptions {
  const night = nightOf(mood);
  const profile = PLACES[mood.place];
  const pedal = profile.pedal ? DRONE_PITCHES : [];
  const dark = night > 0.5 && mood.glow < 0.5;
  return {
    pedal,
    low: profile.pedal ? UPPER_LOW_PEDAL : UPPER_LOW,
    high: dark ? UPPER_HIGH_NIGHT : UPPER_HIGH,
    maxUpper: dark ? Math.min(2, profile.maxUpper) : profile.maxUpper,
    center: UPPER_CENTER + (UPPER_CENTER_NIGHT - UPPER_CENTER) * night,
    previous,
  };
}

export function directionWeight(contour: Contour, index: number, count: number, step: number): number {
  const up = step > 0;
  if (contour === 'rise') return up ? 2.5 : 1;
  if (contour === 'fall') return up ? 1 : 2.5;
  const rising = index <= Math.floor((count - 1) / 2);
  return up === rising ? 2.5 : 1;
}

function upperLevel(midi: number): number {
  return UPPER_LEVEL * clamp(1 - (midi - UPPER_LOW) * 0.015, 0.7, 1.1);
}

export function createComposer(seed: number, startTime: number): Composer {
  const rng = createRng(seed);
  const origin = Number.isFinite(startTime) ? startTime : 0;
  let nextId = 1;
  let phraseCount = 0;
  let voices: Voice[] = [];
  let open: Voice[] = [];
  const queue: MusicEvent[] = [];
  const chords: { name: ChordName; start: number }[] = [];
  let current: ChordName | null = null;
  let previous: ChordName | null = null;
  let nextChordAt = origin + FIRST_CHORD_DELAY;
  let nextPhraseAt = origin + between(rng, FIRST_PHRASE_MIN, FIRST_PHRASE_MAX);
  let lastMelody = -1;
  let breath = BREATH_START;
  let bellReadyAt = -Infinity;

  const push = (ev: MusicEvent): void => {
    let i = queue.length;
    while (i > 0 && queue[i - 1].time > ev.time) i--;
    queue.splice(i, 0, ev);
  };

  const prune = (t: number): void => {
    voices = voices.filter((v) => v.end > t - 1);
    if (chords.length > 6) chords.splice(0, chords.length - 6);
  };

  const chordAt = (t: number): ChordName | null => {
    let found: ChordName | null = null;
    for (const c of chords) if (c.start <= t) found = c.name;
    if (found === null && chords.length > 0) found = chords[0].name;
    return found;
  };

  const fits = (midi: number, from: number, to: number, extra: readonly Planned[]): boolean => {
    for (const v of voices) {
      if (v.start < to && v.end > from && !consonant(v.midi, midi)) return false;
    }
    for (const p of extra) {
      if (p.start < to && p.end > from && !consonant(p.midi, midi)) return false;
    }
    return true;
  };

  const earliestStart = (midi: number, desired: number): number => {
    let start = desired;
    for (let pass = 0; pass < 24; pass++) {
      let moved = false;
      for (const v of voices) {
        if (v.end <= start || consonant(v.midi, midi)) continue;
        if (!Number.isFinite(v.end)) return Infinity;
        start = v.end + ENTRY_GAP;
        moved = true;
      }
      if (!moved) return start;
    }
    return Infinity;
  };

  interface Candidate {
    name: ChordName;
    voicing: Voicing;
    bridges: number;
    weight: number;
  }

  const score = (mood: Mood, weights: Weights, opts: VoicingOptions): Candidate[] => {
    const mode = modeFor(mood);
    const out: Candidate[] = [];
    for (const name of Object.keys(weights) as ChordName[]) {
      const voicing = voiceChord(name, opts);
      if (!voicing) continue;
      const incoming = voicingPitches(voicing).concat(opts.pedal);
      let clashes = 0;
      let bridges = 0;
      for (const v of open) {
        let fine = true;
        for (const p of incoming) {
          if (consonant(p, v.midi)) continue;
          clashes++;
          fine = false;
        }
        if (fine) bridges++;
      }
      let weight = (weights[name] ?? 0) * Math.exp(-CLASH_AVERSION * clashes);
      if (WARM_CHORDS.includes(name)) weight *= 1 + mood.glow;
      if (name === previous && name !== MODES[mode].home) weight *= RETURN_AVERSION;
      if (bridges < Math.min(BRIDGE_MIN, open.length)) weight *= THIN_PENALTY;
      out.push({ name, voicing, bridges, weight });
    }
    return out;
  };

  const chooseChord = (mood: Mood, opts: VoicingOptions): Candidate | undefined => {
    const mode = modeFor(mood);
    const bridged = (list: Candidate[]) => (open.length === 0 ? list : list.filter((c) => c.bridges > 0));
    let pool = bridged(score(mood, nextChordWeights(mode, current), opts));
    if (pool.length === 0) {
      const anywhere: Weights = {};
      for (const name of Object.keys(MODES[mode].rows) as ChordName[]) if (name !== current) anywhere[name] = 1;
      pool = bridged(score(mood, anywhere, opts));
    }
    return weighted(rng, pool, pool.map((c) => c.weight));
  };

  const targetsFor = (voicing: Voicing, pedal: readonly number[]): Target[] => {
    const out: Target[] = [];
    pedal.forEach((midi, i) => {
      out.push({ part: 'drone', midi, level: DRONE_LEVELS[Math.min(i, DRONE_LEVELS.length - 1)], panRange: BASS_PAN, stagger: 0 });
    });
    voicing.bass.forEach((midi, i) => {
      const root = i === 0;
      out.push({
        part: 'pad',
        midi,
        level: root ? BASS_LEVEL : FIFTH_LEVEL,
        panRange: root ? BASS_PAN : FIFTH_PAN,
        stagger: root ? between(rng, 0, 0.4) : between(rng, 0.3, 1.2),
      });
    });
    for (const midi of voicing.upper) {
      out.push({ part: 'pad', midi, level: upperLevel(midi), panRange: UPPER_PAN, stagger: between(rng, 0.6, 2.8) });
    }
    return out;
  };

  const planChord = (mood: Mood, planTime: number): void => {
    prune(planTime);
    const T = Math.max(nextChordAt, planTime + LEAD);
    const night = nightOf(mood);
    const opts = voicingOptionsFor(mood, open.map((v) => v.midi));
    const hold = chordHold(rng, mood);
    const choice = chooseChord(mood, opts);
    if (!choice) {
      nextChordAt = T + hold;
      return;
    }
    const targets = targetsFor(choice.voicing, opts.pedal);
    const matched = new Set<Voice>();
    const entering: Target[] = [];
    for (const t of targets) {
      const same = open.find((v) => !matched.has(v) && v.part === t.part && v.midi === t.midi);
      if (same) matched.add(same);
      else entering.push(t);
    }
    const held = open.filter((v) => matched.has(v));
    const leaving = open.filter((v) => !matched.has(v));
    for (const v of leaving) {
      const clash = entering.some((t) => !consonant(t.midi, v.midi));
      const at = Math.max(clash ? T - EARLY : T + BRIDGE_HOLD, v.start + v.attack + 0.5, planTime + 0.05);
      const release =
        v.part === 'drone'
          ? DRONE_RELEASE
          : clash
            ? PAD_RELEASE_MIN
            : between(rng, PAD_RELEASE_MIN + (PAD_RELEASE_NIGHT - PAD_RELEASE_MIN) * night, PAD_RELEASE_MAX);
      v.end = at + release;
      push({ kind: 'off', time: at, id: v.id, release });
    }
    const entered: Voice[] = [];
    entering.sort((a, b) => a.stagger - b.stagger);
    for (const t of entering) {
      const desired = T + t.stagger;
      const start = earliestStart(t.midi, desired);
      if (!Number.isFinite(start)) continue;
      const delayed = start > desired + 1e-9;
      const attack =
        t.part === 'drone'
          ? DRONE_ATTACK
          : delayed
            ? PAD_ATTACK_MIN
            : between(rng, PAD_ATTACK_MIN + (PAD_ATTACK_NIGHT - PAD_ATTACK_MIN) * night, PAD_ATTACK_MAX);
      if (start + attack + MIN_SUSTAIN > T + hold) continue;
      const pan = between(rng, -t.panRange, t.panRange);
      const v: Voice = { id: nextId++, part: t.part, midi: t.midi, start, attack, end: Infinity, pan, panRange: t.panRange };
      voices.push(v);
      entered.push(v);
      push({ kind: 'on', time: start, id: v.id, part: v.part, midi: v.midi, level: t.level, attack, duration: Infinity, pan, phrase: -1 });
    }
    for (const v of held) {
      v.pan = clamp(v.pan + between(rng, -PAN_DRIFT, PAN_DRIFT), -v.panRange, v.panRange);
      push({ kind: 'pan', time: T, id: v.id, pan: v.pan, glide: hold * 0.6 });
    }
    open = held.concat(entered);
    breath = nextBreath(rng, breath, mood);
    push({ kind: 'breath', time: T, level: breath, glide: hold * 0.5 });
    push({ kind: 'chord', time: T, name: choice.name, hold });
    chords.push({ name: choice.name, start: T });
    previous = current;
    current = choice.name;
    nextChordAt = T + hold;
  };

  const choosePhraseNotes = (mood: Mood, onsets: number[], rings: number[]): Planned[] => {
    const [low, high] = melodyRange(mood);
    const center = (low + high) / 2 - 1;
    const contour = weighted<Contour>(rng, ['fall', 'arch', 'rise'], [5, 3, 2]) ?? 'fall';
    const notes: Planned[] = [];
    const passing: boolean[] = [];
    let usedPassing = false;
    for (let i = 0; i < onsets.length; i++) {
      const start = onsets[i];
      const end = start + rings[i];
      const name = chordAt(start);
      if (!name) break;
      const last = i === onsets.length - 1;
      const prev = notes.length > 0 ? notes[notes.length - 1].midi : -1;
      const before = notes.length > 1 ? notes[notes.length - 2].midi : -1;
      const candidates: PoolNote[] = [];
      const weights: number[] = [];
      for (const note of melodyPool(name, mood.water, low, high)) {
        if (!fits(note.midi, start, end, notes)) continue;
        let w: number;
        if (i === 0) {
          if (!note.chord || note.midi === lastMelody) continue;
          const ref = lastMelody > 0 ? (lastMelody + center) / 2 : center;
          w = (note.stable ? 1.5 : 1) / (1 + Math.abs(note.midi - ref) / 3);
        } else {
          const step = note.midi - prev;
          const size = Math.abs(step);
          if (size === 0 || size > MAX_LEAP) continue;
          if (!note.chord && (last || usedPassing)) continue;
          w = STEP_WEIGHTS[size] * directionWeight(contour, i, onsets.length, step);
          if (!note.chord) w *= 0.6;
          if (last && note.stable) w *= 2;
          if (note.midi === before) w *= RETURN_WEIGHT;
        }
        if (Math.abs(note.midi - center) > 7) w *= 0.5;
        candidates.push(note);
        weights.push(w);
      }
      const pick = weighted(rng, candidates, weights);
      if (!pick) break;
      if (!pick.chord) usedPassing = true;
      notes.push({ midi: pick.midi, start, end });
      passing.push(!pick.chord);
    }
    while (notes.length > 0 && passing[notes.length - 1]) {
      notes.pop();
      passing.pop();
    }
    return notes;
  };

  const planPhrase = (mood: Mood): void => {
    const s = nextPhraseAt;
    prune(s);
    const night = nightOf(mood);
    if (breath < BREATH_SKIP_BELOW && chance(rng, 0.5)) {
      nextPhraseAt = s + between(rng, 8, 16);
      return;
    }
    const count = weighted(rng, [2, 3, 4], night > 0.5 ? [5, 4, 1] : [3, 4.5, 2.5]) ?? 3;
    const tempo = 1 + NIGHT_SLOW * night;
    const onsets: number[] = [s];
    for (let i = 1; i < count; i++) {
      onsets.push(onsets[i - 1] + between(rng, NOTE_GAP_MIN, NOTE_GAP_MAX) * tempo * (i === count - 1 ? 1.15 : 1));
    }
    const rings = onsets.map((_, i) => between(rng, RING_MIN, RING_MAX) * (1 + NIGHT_RING * night) + (i === count - 1 ? LAST_RING_EXTRA : 0));
    while (onsets.length > 2 && onsets[onsets.length - 1] + rings[rings.length - 1] > nextChordAt) {
      onsets.pop();
      rings.pop();
    }
    if (onsets[onsets.length - 1] + rings[rings.length - 1] > nextChordAt) {
      nextPhraseAt = Math.max(s + 0.5, nextChordAt - LEAD + 0.01);
      return;
    }
    const notes = choosePhraseNotes(mood, onsets, rings);
    if (notes.length < 2) {
      nextPhraseAt = s + between(rng, 6, 12);
      return;
    }
    const phrase = ++phraseCount;
    const pan = between(rng, -MELODY_PAN + 0.06, MELODY_PAN - 0.06);
    notes.forEach((n, i) => {
      const shape = i === 0 ? 0.82 : i === notes.length - 1 ? 0.78 : 1;
      const level = MELODY_LEVEL * shape * between(rng, 0.9, 1);
      const attack = between(rng, MELODY_ATTACK_MIN, MELODY_ATTACK_MAX);
      const notePan = clamp(pan + between(rng, -0.06, 0.06), -MELODY_PAN, MELODY_PAN);
      const v: Voice = { id: nextId++, part: 'melody', midi: n.midi, start: n.start, attack, end: n.end, pan: notePan, panRange: MELODY_PAN };
      voices.push(v);
      push({ kind: 'on', time: n.start, id: v.id, part: 'melody', midi: n.midi, level, attack, duration: n.end - n.start, pan: notePan, phrase });
    });
    const final = notes[notes.length - 1];
    lastMelody = final.midi;
    const rest = between(rng, REST_MIN, REST_MAX) * PLACES[mood.place].sparse * (1 + NIGHT_REST * night) * (1 - GLOW_REST * mood.glow);
    nextPhraseAt = final.start + rest;
  };

  const bellPitch = (name: ChordName, time: number, low: number, high: number): number | undefined => {
    const spec: ChordSpec = CHORDS[name];
    const degrees = chordDegrees(name);
    const stable = stableDegrees(name);
    const root = spec.root % 12;
    const fifth = (spec.root + 7) % 12;
    const options: number[] = [];
    const weights: number[] = [];
    for (let m = low; m <= high; m++) {
      const d = degreeOf(m);
      if (!degrees.includes(d)) continue;
      if (!fits(m, time, time + BELL_DURATION, [])) continue;
      options.push(m);
      weights.push(d === root || (spec.fifth && d === fifth) ? 3 : stable.includes(d) ? 2 : 1);
    }
    return weighted(rng, options, weights);
  };

  return {
    advance(until: number, mood: Mood, now: number = until): MusicEvent[] {
      const out: MusicEvent[] = [];
      if (!Number.isFinite(until)) return out;
      const late = Math.min(until, Number.isFinite(now) ? now : until) - CATCH_UP;
      if (nextPhraseAt < late) nextPhraseAt = until;
      for (let guard = 0; guard < 64; guard++) {
        const planAt = nextChordAt - LEAD;
        if (planAt <= until && planAt <= nextPhraseAt) {
          planChord(mood, Math.max(planAt, late));
          continue;
        }
        if (nextPhraseAt <= until) {
          planPhrase(mood);
          continue;
        }
        break;
      }
      while (queue.length > 0 && queue[0].time < until) {
        const ev = queue.shift();
        if (!ev) continue;
        if (ev.kind === 'on' && Number.isFinite(ev.duration) && ev.time + ev.duration < late) continue;
        out.push(ev);
      }
      return out;
    },

    bell(time: number): NoteOn | null {
      if (!Number.isFinite(time) || time < bellReadyAt) return null;
      const name = chordAt(time) ?? current;
      if (!name) return null;
      const midi = bellPitch(name, time, BELL_LOW, BELL_HIGH) ?? bellPitch(name, time, BELL_FALLBACK_LOW, BELL_FALLBACK_HIGH);
      if (midi === undefined) return null;
      const id = nextId++;
      const pan = between(rng, -BELL_PAN, BELL_PAN);
      voices.push({ id, part: 'bell', midi, start: time, attack: BELL_ATTACK, end: time + BELL_DURATION, pan, panRange: BELL_PAN });
      bellReadyAt = time + BELL_COOLDOWN;
      return { kind: 'on', time, id, part: 'bell', midi, level: BELL_LEVEL, attack: BELL_ATTACK, duration: BELL_DURATION, pan, phrase: -1 };
    },

    chordAt,
  };
}
