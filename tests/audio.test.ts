import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAY_LENGTH_S, MATERIAL, RUN_SPEED, WALK_SPEED } from '../src/config';
import { createAudio, type AudioContextSnapshot } from '../src/audio/index';
import {
  BELL_FALLBACK_HIGH,
  BELL_FALLBACK_LOW,
  BELL_LEVEL,
  BREATH_MAX,
  BREATH_MIN,
  BREATH_STEP,
  HOLD_MAX,
  HOLD_MIN,
  MAX_LEAP,
  MELODY_HIGH,
  MELODY_LEVEL,
  MELODY_LOW,
  PAD_ATTACK_MAX,
  PAD_ATTACK_MIN,
  PAD_RELEASE_MAX,
  PAD_RELEASE_MIN,
  createComposer,
  type MusicEvent,
  type NoteOn,
  type Part,
} from '../src/audio/composer';
import {
  CHORD_NAMES,
  DRONE_PITCHES,
  KEY,
  LYDIAN_FOURTH,
  MODES,
  WARM_CHORDS,
  consonant,
  degreeOf,
  melodyPool,
  voiceChord,
  voicingPitches,
  type ChordName,
  type ModeName,
  type VoicingOptions,
} from '../src/audio/theory';
import {
  GLOW_DAWN,
  GLOW_DUSK,
  PLACE_SETTLE,
  daylight,
  glow,
  initialMood,
  moodOf,
  stepMood,
  toneFor,
  type Mood,
  type PlaceName,
} from '../src/audio/mood';
import {
  BIRD_LEVEL,
  CRICKET_LEVEL,
  birdCall,
  birdChance,
  cricketSong,
  insectChance,
  waterLevel,
  windCutoff,
  windLevel,
} from '../src/audio/ambience';
import { WARM_HARMONICS, decayCurve, fallCurve, padDetune, riseCurve } from '../src/audio/voices';
import { LOOKAHEAD, MAX_LOOKAHEAD, lookaheadFor } from '../src/audio/scheduler';
import { createRng } from '../src/audio/rng';

function snapshot(over: Partial<AudioContextSnapshot> = {}): AudioContextSnapshot {
  return { biome: MATERIAL.GRASS, nearWater: 0, altitude: 0, speed: 0, timeOfDay: 0.5, ...over };
}

interface Span {
  id: number;
  part: Part;
  midi: number;
  start: number;
  end: number;
  attack: number;
  release: number;
  level: number;
  phrase: number;
}

interface Run {
  events: MusicEvent[];
  spans: Span[];
  seconds: number;
}

function simulate(seed: number, seconds: number, moodAt: (t: number) => Mood, step: (i: number) => number = () => 0.25): Run {
  const composer = createComposer(seed, 0);
  const events: MusicEvent[] = [];
  let i = 0;
  for (let t = 0; t < seconds; t += step(i++)) {
    const until = t + 0.15;
    const batch = composer.advance(until, moodAt(t));
    for (let k = 0; k < batch.length; k++) {
      expect(batch[k].time).toBeLessThan(until);
      if (k > 0) expect(batch[k].time).toBeGreaterThanOrEqual(batch[k - 1].time);
    }
    events.push(...batch);
  }
  const spans = new Map<number, Span>();
  for (const ev of events) {
    if (ev.kind === 'on') {
      spans.set(ev.id, {
        id: ev.id,
        part: ev.part,
        midi: ev.midi,
        start: ev.time,
        end: ev.time + ev.duration,
        attack: ev.attack,
        release: 0,
        level: ev.level,
        phrase: ev.phrase,
      });
    } else if (ev.kind === 'off') {
      const span = spans.get(ev.id);
      expect(span).toBeDefined();
      if (span) {
        expect(ev.time).toBeGreaterThanOrEqual(span.start + span.attack);
        span.end = ev.time + ev.release;
        span.release = ev.release;
      }
    }
  }
  return { events, spans: Array.from(spans.values()), seconds };
}

function overlapping(spans: Span[]): [Span, Span][] {
  const sorted = spans.slice().sort((a, b) => a.start - b.start);
  const out: [Span, Span][] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].start < sorted[i].end; j++) out.push([sorted[i], sorted[j]]);
  }
  return out;
}

const NOON: Mood = { place: 'grass', water: false, daylight: 1, glow: 0 };
const MIDNIGHT: Mood = { place: 'grass', water: false, daylight: 0, glow: 0 };
const ROUTE: PlaceName[] = ['grass', 'forest', 'grass', 'sand', 'water', 'stone', 'snow', 'stone', 'grass', 'forest', 'water', 'sand'];
const LEG = 150;

function journey(t: number): Mood {
  const leg = Math.floor(t / LEG);
  const place = ROUTE[leg % ROUTE.length];
  const within = t - leg * LEG;
  const water = place === 'water' || (place === 'sand' && within > LEG / 2) || (place === 'forest' && within > LEG * 0.7);
  const timeOfDay = (0.3 + t / DAY_LENGTH_S) % 1;
  return { place, water, daylight: daylight(timeOfDay), glow: glow(timeOfDay) };
}

function steady(mood: Mood): (t: number) => Mood {
  return () => mood;
}

function melody(run: Run): Span[] {
  return run.spans.filter((s) => s.part === 'melody').sort((a, b) => a.start - b.start);
}

function perMinute(count: number, seconds: number): number {
  return count / (seconds / 60);
}

function lazy<T>(make: () => T): () => T {
  let value: { made: T } | null = null;
  return () => {
    if (!value) value = { made: make() };
    return value.made;
  };
}

const journeyRun = lazy(() => simulate(20260924, 3 * 60 * 60, journey));
const dayRun = lazy(() => simulate(31, 3600, steady(NOON)));
const nightRun = lazy(() => simulate(31, 3600, steady(MIDNIGHT)));

const CHORD_ROOTS: Record<ChordName, number> = {
  'I6/9': 0,
  Imaj9: 0,
  ii7: 2,
  iii7: 4,
  IVmaj7: 5,
  'IV6/9': 5,
  V11: 7,
  Vadd9: 7,
  'vi7(11)': 9,
  IIadd9: 2,
  Vmaj7: 7,
  vii7: 11,
};

describe('consonance rule', () => {
  it('rejects minor seconds, minor ninths, close major sevenths and tritones in any octave', () => {
    for (const low of [40, 55, 62, 70]) {
      for (const d of [1, 13, 25, 6, 18, 30, 11]) expect(consonant(low, low + d)).toBe(false);
    }
  });

  it('accepts unisons, fifths, octaves, open major sevenths and ninths', () => {
    for (const d of [0, 5, 7, 12, 14, 19, 23, 24]) expect(consonant(52, 52 + d)).toBe(true);
  });

  it('keeps seconds and thirds out of the muddy low register', () => {
    expect(consonant(47, 49)).toBe(false);
    expect(consonant(45, 48)).toBe(false);
    expect(consonant(62, 64)).toBe(true);
    expect(consonant(54, 57)).toBe(true);
  });
});

describe('chord voicings', () => {
  const contexts: VoicingOptions[] = [
    { pedal: [], low: 52, high: 69, maxUpper: 3, center: 60, previous: [] },
    { pedal: [], low: 52, high: 66, maxUpper: 2, center: 57, previous: [] },
    { pedal: DRONE_PITCHES, low: 50, high: 69, maxUpper: 3, center: 60, previous: [] },
  ];

  it('are consonant, spaced and cluster free for every chord, context and previous voicing', () => {
    const rng = createRng(7);
    let voiced = 0;
    for (const base of contexts) {
      for (let trial = 0; trial < 60; trial++) {
        const previous = Array.from({ length: 1 + Math.floor(rng() * 6) }, () => 38 + Math.floor(rng() * 34));
        for (const name of CHORD_NAMES) {
          const v = voiceChord(name, { ...base, previous });
          if (!v) continue;
          voiced++;
          const pitches = voicingPitches(v).sort((a, b) => a - b);
          const all = pitches.concat(base.pedal);
          for (let i = 0; i < all.length; i++) {
            for (let j = i + 1; j < all.length; j++) {
              const d = Math.abs(all[i] - all[j]);
              expect(d % 12 === 1 || d % 12 === 6, `${name} ${all}`).toBe(false);
              expect(consonant(all[i], all[j]), `${name} ${all}`).toBe(true);
            }
          }
          for (let i = 1; i < pitches.length; i++) expect(pitches[i] - pitches[i - 1]).toBeGreaterThanOrEqual(2);
          for (let i = 2; i < pitches.length; i++) expect(pitches[i] - pitches[i - 2]).toBeGreaterThanOrEqual(5);
          for (const p of v.upper) {
            expect(p).toBeGreaterThanOrEqual(base.low);
            expect(p).toBeLessThanOrEqual(base.high);
          }
          if (base.pedal.length === 0) {
            expect(v.bass[0]).toBeGreaterThanOrEqual(KEY);
            expect(v.bass[0]).toBeLessThan(KEY + 12);
            expect(degreeOf(v.bass[0])).toBe(CHORD_ROOTS[name]);
            if (v.bass.length > 1) expect(v.bass[1] - v.bass[0]).toBe(7);
          } else {
            expect(v.bass).toHaveLength(0);
          }
        }
      }
    }
    expect(voiced).toBeGreaterThan(1500);
  });

  it('can voice every chord of every mode by day and by night', () => {
    for (const mode of Object.keys(MODES) as ModeName[]) {
      for (const name of Object.keys(MODES[mode].rows) as ChordName[]) {
        expect(voiceChord(name, contexts[0]), `${mode} ${name} day`).not.toBeNull();
        expect(voiceChord(name, contexts[1]), `${mode} ${name} night`).not.toBeNull();
      }
    }
  });

  it('never puts the lydian fourth over the forest drone', () => {
    for (const name of CHORD_NAMES) {
      const v = voiceChord(name, contexts[2]);
      if (v) expect(v.upper.some((p) => degreeOf(p) === LYDIAN_FOURTH)).toBe(false);
    }
  });
});

describe('composer over a three hour journey', () => {
  it('never sounds a minor second, minor ninth, close major seventh or tritone between any two voices', () => {
    const pairs = overlapping(journeyRun().spans);
    expect(pairs.length).toBeGreaterThan(5000);
    for (const [a, b] of pairs) {
      expect(consonant(a.midi, b.midi), `${a.part} ${a.midi} @${a.start.toFixed(1)} with ${b.part} ${b.midi} @${b.start.toFixed(1)}`).toBe(true);
    }
  });

  it('keeps the melody between C4 and E5', () => {
    const notes = melody(journeyRun());
    expect(notes.length).toBeGreaterThan(300);
    for (const n of notes) {
      expect(n.midi).toBeGreaterThanOrEqual(MELODY_LOW);
      expect(n.midi).toBeLessThanOrEqual(MELODY_HIGH);
      expect(n.level).toBeLessThanOrEqual(MELODY_LEVEL);
    }
  });

  it('draws the melody from the sounding chord plus pentatonic passing tones', () => {
    const composer = createComposer(99, 0);
    for (let t = 0; t < 1800; t += 0.25) {
      for (const ev of composer.advance(t + 0.15, NOON)) {
        if (ev.kind !== 'on' || ev.part !== 'melody') continue;
        const chord = composer.chordAt(ev.time);
        expect(chord).not.toBeNull();
        if (chord) expect(melodyPool(chord, false, MELODY_LOW, MELODY_HIGH).some((p) => p.midi === ev.midi)).toBe(true);
      }
    }
  });

  it('shapes phrases of two to four notes without repeats or large leaps, ending on a chord tone', () => {
    const phrases = new Map<number, Span[]>();
    for (const n of melody(journeyRun())) phrases.set(n.phrase, (phrases.get(n.phrase) ?? []).concat(n));
    expect(phrases.size).toBeGreaterThan(100);
    let previousLast = -1;
    for (const notes of phrases.values()) {
      expect(notes.length).toBeGreaterThanOrEqual(2);
      expect(notes.length).toBeLessThanOrEqual(4);
      expect(notes[0].midi).not.toBe(previousLast);
      for (let i = 1; i < notes.length; i++) {
        expect(notes[i].midi).not.toBe(notes[i - 1].midi);
        expect(Math.abs(notes[i].midi - notes[i - 1].midi)).toBeLessThanOrEqual(MAX_LEAP);
        expect(notes[i].start - notes[i - 1].start).toBeGreaterThan(1.5);
      }
      previousLast = notes[notes.length - 1].midi;
    }
  });

  it('leaves long rests between phrases', () => {
    const phrases = new Map<number, Span[]>();
    for (const n of melody(journeyRun())) phrases.set(n.phrase, (phrases.get(n.phrase) ?? []).concat(n));
    const list = Array.from(phrases.values());
    for (let i = 1; i < list.length; i++) {
      const gap = list[i][0].start - list[i - 1][list[i - 1].length - 1].start;
      expect(gap).toBeGreaterThan(8);
    }
  });

  it('stays sparse: few note events per minute, in total and in every ten minute window', () => {
    const notes = melody(journeyRun());
    const pads = journeyRun().spans.filter((s) => s.part === 'pad' || s.part === 'drone');
    expect(perMinute(notes.length, journeyRun().seconds)).toBeLessThan(7);
    expect(perMinute(pads.length, journeyRun().seconds)).toBeLessThan(11);
    expect(perMinute(notes.length + pads.length, journeyRun().seconds)).toBeLessThan(17);
    for (let from = 0; from < journeyRun().seconds; from += 600) {
      const inWindow = notes.filter((n) => n.start >= from && n.start < from + 600).length;
      expect(perMinute(inWindow, 600)).toBeLessThanOrEqual(9);
    }
  });

  it('holds each chord for 16 to 32 seconds and crossfades with slow pads', () => {
    const chords = journeyRun().events.filter((e) => e.kind === 'chord');
    expect(chords.length).toBeGreaterThan(300);
    for (let i = 0; i < chords.length; i++) {
      const c = chords[i];
      if (c.kind !== 'chord') continue;
      expect(c.hold).toBeGreaterThanOrEqual(HOLD_MIN);
      expect(c.hold).toBeLessThanOrEqual(HOLD_MAX);
      if (i > 0) expect(c.time - chords[i - 1].time).toBeGreaterThanOrEqual(HOLD_MIN - 1e-9);
    }
    for (const s of journeyRun().spans) {
      if (s.part !== 'pad' && s.part !== 'drone') continue;
      expect(s.attack).toBeGreaterThanOrEqual(PAD_ATTACK_MIN);
      expect(s.attack).toBeLessThanOrEqual(PAD_ATTACK_MAX);
      if (s.release > 0) {
        expect(s.release).toBeGreaterThanOrEqual(PAD_RELEASE_MIN);
        expect(s.release).toBeLessThanOrEqual(PAD_RELEASE_MAX);
      }
    }
  });

  it('never lets the harmonic floor drop out between chords', () => {
    const floor = journeyRun().spans.filter((s) => s.part === 'pad' || s.part === 'drone');
    const rise = riseCurve();
    const fall = fallCurve();
    const sample = (curve: Float32Array, x: number) => curve[Math.round(Math.max(0, Math.min(1, x)) * (curve.length - 1))];
    const levels: number[] = [];
    for (let t = 30; t < journeyRun().seconds - 40; t += 0.5) {
      let energy = 0;
      let voices = 0;
      for (const s of floor) {
        if (s.start > t || s.end <= t) continue;
        voices++;
        let g = s.level;
        if (t < s.start + s.attack) g *= sample(rise, (t - s.start) / s.attack);
        if (s.release > 0 && t > s.end - s.release) g *= sample(fall, (t - (s.end - s.release)) / s.release);
        energy += g * g;
      }
      expect(voices).toBeGreaterThanOrEqual(1);
      levels.push(Math.sqrt(energy));
    }
    const median = levels.slice().sort((a, b) => a - b)[Math.floor(levels.length / 2)];
    expect(Math.min(...levels)).toBeGreaterThan(median * Math.pow(10, -12 / 20));
  });

  it('breathes in level instead of switching on and off', () => {
    const levels = journeyRun().events.filter((e) => e.kind === 'breath').map((e) => (e.kind === 'breath' ? e.level : 0));
    expect(levels.length).toBeGreaterThan(300);
    for (let i = 0; i < levels.length; i++) {
      expect(levels[i]).toBeGreaterThanOrEqual(BREATH_MIN);
      expect(levels[i]).toBeLessThanOrEqual(BREATH_MAX);
      if (i > 0) expect(Math.abs(levels[i] - levels[i - 1])).toBeLessThanOrEqual(BREATH_STEP + 1e-9);
    }
    expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThan(0.3);
  });

  it('is deterministic for a seed', () => {
    const a = simulate(5, 600, journey);
    const b = simulate(5, 600, journey);
    expect(a.events).toEqual(b.events);
  });

  it('resumes calmly after the clock jumps ahead instead of replaying a backlog', () => {
    const composer = createComposer(21, 0);
    for (let t = 0; t < 120; t += 0.25) composer.advance(t + 0.15, NOON);
    const burst = composer.advance(900, NOON);
    expect(burst.filter((e) => e.kind === 'chord').length).toBeLessThanOrEqual(1);
    expect(burst.some((e) => e.kind === 'on' && e.part === 'melody')).toBe(false);
    const after: MusicEvent[] = [];
    for (let t = 900; t < 1500; t += 0.25) after.push(...composer.advance(t + 0.15, NOON));
    const chords = after.filter((e) => e.kind === 'chord');
    expect(chords.length).toBeGreaterThan(15);
    expect(chords[0].time).toBeGreaterThanOrEqual(900);
    expect(after.some((e) => e.kind === 'on' && e.part === 'melody')).toBe(true);
  });

  it('keeps every guarantee when the scheduler is throttled or jittery', () => {
    const rng = createRng(3);
    const run = simulate(8, 3600, journey, () => 0.02 + rng() * 1.2);
    for (const [a, b] of overlapping(run.spans)) expect(consonant(a.midi, b.midi)).toBe(true);
    expect(melody(run).length).toBeGreaterThan(100);
  });
});

describe('place and time colour the music consonantly', () => {
  it('makes night slower, lower and sparser than day', () => {
    const holds = (run: Run) => {
      const list = run.events.filter((e) => e.kind === 'chord').map((e) => (e.kind === 'chord' ? e.hold : 0));
      return list.reduce((a, b) => a + b, 0) / list.length;
    };
    const mean = (list: Span[]) => list.reduce((a, s) => a + s.midi, 0) / list.length;
    expect(holds(nightRun())).toBeGreaterThan(holds(dayRun()) + 3);
    expect(melody(nightRun()).length).toBeLessThan(melody(dayRun()).length * 0.75);
    expect(mean(melody(nightRun()))).toBeLessThan(mean(melody(dayRun())));
    const upper = (run: Run) => mean(run.spans.filter((s) => s.part === 'pad' && s.midi >= 50));
    expect(upper(nightRun())).toBeLessThan(upper(dayRun()));
    expect(Math.max(...melody(nightRun()).map((n) => n.midi))).toBeLessThanOrEqual(MELODY_HIGH - 4);
  });

  it('makes night more reverberant and darker, and dawn and dusk the warmest', () => {
    const noon = toneFor(NOON);
    const dark = toneFor(MIDNIGHT);
    const dusk = toneFor({ ...NOON, daylight: daylight(GLOW_DUSK), glow: glow(GLOW_DUSK) });
    expect(dark.reverb).toBeGreaterThan(noon.reverb);
    expect(dark.padCutoff).toBeLessThan(noon.padCutoff);
    expect(dusk.trim).toBeGreaterThan(noon.trim);
    expect(dusk.padCutoff).toBeGreaterThan(noon.padCutoff);
    for (const tone of [noon, dark, dusk]) {
      expect(tone.padCutoff).toBeGreaterThanOrEqual(800);
      expect(tone.padCutoff).toBeLessThanOrEqual(1200);
    }
    const warm = simulate(31, 3600, steady({ ...NOON, glow: 1 }));
    const share = (run: Run) => {
      const names = run.events.filter((e) => e.kind === 'chord').map((e) => (e.kind === 'chord' ? e.name : 'I6/9'));
      return names.filter((n) => WARM_CHORDS.includes(n)).length / names.length;
    };
    expect(share(warm)).toBeGreaterThan(share(dayRun()));
  });

  it('adds a low drone only in the forest', () => {
    const forest = simulate(12, 1800, steady({ ...NOON, place: 'forest' }));
    const drones = forest.spans.filter((s) => s.part === 'drone');
    expect(drones.length).toBeGreaterThan(0);
    for (const d of drones) expect(DRONE_PITCHES).toContain(d.midi);
    expect(dayRun().spans.some((s) => s.part === 'drone')).toBe(false);
  });

  it('gives the lydian raised fourth only near water', () => {
    const water = simulate(13, 1800, steady({ ...NOON, water: true }));
    const raised = (run: Run) => run.spans.filter((s) => degreeOf(s.midi) === LYDIAN_FOURTH).length;
    expect(raised(water)).toBeGreaterThan(10);
    expect(melody(water).some((n) => degreeOf(n.midi) === LYDIAN_FOURTH)).toBe(true);
    expect(raised(dayRun())).toBe(0);
    expect(raised(nightRun())).toBe(0);
  });

  it('leans stone to aeolian and snow to dorian, both sparser than grass, and sand sparser too', () => {
    const count = (place: PlaceName) => melody(simulate(41, 3600, steady({ ...NOON, place }))).length;
    const grass = count('grass');
    expect(count('stone')).toBeLessThan(grass * 0.85);
    expect(count('snow')).toBeLessThan(grass * 0.8);
    expect(count('sand')).toBeLessThan(grass * 0.9);
    const home = (place: PlaceName) => {
      const run = simulate(42, 1800, steady({ ...NOON, place }));
      const names = run.events.filter((e) => e.kind === 'chord').map((e) => (e.kind === 'chord' ? e.name : ''));
      const tally = new Map<string, number>();
      for (const n of names) tally.set(n, (tally.get(n) ?? 0) + 1);
      return Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0][0];
    };
    expect(home('stone')).toBe(MODES.aeolian.home);
    expect(home('snow')).toBe(MODES.dorian.home);
  });
});

describe('discovery bell', () => {
  it('is soft, low and consonant with everything sounding while it rings', () => {
    const composer = createComposer(77, 0);
    const events: MusicEvent[] = [];
    const bells: NoteOn[] = [];
    for (let t = 0; t < 3600; t += 0.25) {
      events.push(...composer.advance(t + 0.15, journey(t)));
      if (Math.floor(t * 4) % 37 === 0) {
        const bell = composer.bell(t + 0.03);
        if (bell) {
          bells.push(bell);
          events.push(bell);
        }
      }
    }
    expect(bells.length).toBeGreaterThan(200);
    const spans = new Map<number, { midi: number; start: number; end: number }>();
    for (const ev of events) {
      if (ev.kind === 'on') spans.set(ev.id, { midi: ev.midi, start: ev.time, end: ev.time + ev.duration });
      if (ev.kind === 'off') {
        const s = spans.get(ev.id);
        if (s) s.end = ev.time + ev.release;
      }
    }
    for (const bell of bells) {
      expect(bell.midi).toBeGreaterThanOrEqual(BELL_FALLBACK_LOW);
      expect(bell.midi).toBeLessThanOrEqual(BELL_FALLBACK_HIGH);
      expect(bell.level).toBeLessThanOrEqual(BELL_LEVEL);
      expect(bell.level).toBeLessThan(MELODY_LEVEL);
      for (const other of spans.values()) {
        if (other.start < bell.time + bell.duration && other.end > bell.time) expect(consonant(bell.midi, other.midi)).toBe(true);
      }
    }
    for (let i = 1; i < bells.length; i++) expect(bells[i].time - bells[i - 1].time).toBeGreaterThanOrEqual(3);
  });

  it('never rings twice in quick succession', () => {
    const composer = createComposer(3, 0);
    composer.advance(30, NOON);
    expect(composer.bell(20)).not.toBeNull();
    expect(composer.bell(20.5)).toBeNull();
    expect(composer.bell(24)).not.toBeNull();
  });
});

describe('mood', () => {
  it('only changes place once the new ground has held for a while', () => {
    let state = initialMood({ biome: MATERIAL.GRASS, nearWater: 0, timeOfDay: 0.5 });
    for (let i = 0; i < 40; i++) {
      state = stepMood(state, { biome: i % 2 === 0 ? MATERIAL.FOREST : MATERIAL.GRASS, nearWater: 0, timeOfDay: 0.5 }, 0.5);
      expect(moodOf(state).place).toBe('grass');
    }
    let elapsed = 0;
    while (moodOf(state).place !== 'forest' && elapsed < 60) {
      state = stepMood(state, { biome: MATERIAL.FOREST, nearWater: 0, timeOfDay: 0.5 }, 0.5);
      elapsed += 0.5;
    }
    expect(moodOf(state).place).toBe('forest');
    expect(elapsed).toBeGreaterThanOrEqual(PLACE_SETTLE);
  });

  it('keeps the current place on ground that is not a biome, such as props or paths', () => {
    let state = initialMood({ biome: MATERIAL.FOREST, nearWater: 0, timeOfDay: 0.5 });
    for (let i = 0; i < 60; i++) state = stepMood(state, { biome: MATERIAL.NONE, nearWater: 0, timeOfDay: 0.5 }, 0.5);
    for (let i = 0; i < 60; i++) state = stepMood(state, { biome: 99, nearWater: 0, timeOfDay: 0.5 }, 0.5);
    expect(moodOf(state).place).toBe('forest');
    expect(moodOf(initialMood({ biome: 99, nearWater: 0, timeOfDay: 0.5 })).place).toBe('grass');
  });

  it('turns the water colour on near water and off only when well away', () => {
    let state = initialMood({ biome: MATERIAL.SAND, nearWater: 0, timeOfDay: 0.5 });
    for (let i = 0; i < 40; i++) state = stepMood(state, { biome: MATERIAL.SAND, nearWater: 0.55, timeOfDay: 0.5 }, 0.5);
    expect(moodOf(state).water).toBe(true);
    for (let i = 0; i < 4; i++) state = stepMood(state, { biome: MATERIAL.SAND, nearWater: 0.25, timeOfDay: 0.5 }, 0.5);
    expect(moodOf(state).water).toBe(true);
    for (let i = 0; i < 60; i++) state = stepMood(state, { biome: MATERIAL.SAND, nearWater: 0, timeOfDay: 0.5 }, 0.5);
    expect(moodOf(state).water).toBe(false);
  });

  it('follows the sky: dark at midnight, light at noon, glowing at dawn and dusk', () => {
    expect(daylight(0)).toBe(0);
    expect(daylight(0.5)).toBe(1);
    expect(glow(GLOW_DAWN)).toBeCloseTo(1, 5);
    expect(glow(GLOW_DUSK)).toBeCloseTo(1, 5);
    expect(glow(0.5)).toBe(0);
    expect(glow(0)).toBe(0);
    for (let t = 0; t < 1; t += 0.01) {
      expect(daylight(t)).toBeGreaterThanOrEqual(0);
      expect(daylight(t)).toBeLessThanOrEqual(1);
    }
  });
});

describe('ambience', () => {
  it('keeps wind soft: barely moved by running, only mildly by altitude', () => {
    const still = windLevel(0, 0);
    expect(windLevel(0, WALK_SPEED) / still).toBeLessThan(1.05);
    expect(windLevel(0, RUN_SPEED) / still).toBeLessThan(1.1);
    expect(windLevel(400, 0) / still).toBeLessThanOrEqual(2);
    expect(windLevel(400, RUN_SPEED)).toBeGreaterThan(windLevel(0, 0));
    expect(windCutoff(0, RUN_SPEED) - windCutoff(0, 0)).toBeLessThanOrEqual(60);
    expect(windCutoff(400, RUN_SPEED)).toBeLessThan(700);
    for (let a = 0; a < 300; a += 10) expect(windLevel(a + 10, 0)).toBeGreaterThanOrEqual(windLevel(a, 0));
  });

  it('laps water only near the shore', () => {
    expect(waterLevel(0)).toBe(0);
    expect(waterLevel(1)).toBe(1);
    expect(waterLevel(0.25)).toBeLessThan(waterLevel(0.55));
    expect(waterLevel(0.55)).toBeLessThan(1);
  });

  it('keeps birds to the day and insects to the night, both very quiet', () => {
    expect(birdChance(0, 'grass', 0)).toBe(0);
    expect(birdChance(1, 'grass', 0)).toBeGreaterThan(0);
    expect(birdChance(1, 'snow', 0)).toBe(0);
    expect(birdChance(1, 'grass', 300)).toBe(0);
    expect(insectChance(1, 'forest', 0)).toBe(0);
    expect(insectChance(0, 'forest', 0)).toBeGreaterThan(0);
    const rng = createRng(4);
    for (let i = 0; i < 200; i++) {
      const call = birdCall(rng, 10);
      expect(call.length).toBeGreaterThanOrEqual(2);
      expect(call.length).toBeLessThanOrEqual(4);
      for (let k = 0; k < call.length; k++) {
        expect(call[k].level).toBeLessThanOrEqual(BIRD_LEVEL);
        expect(Math.max(call[k].from, call[k].to)).toBeLessThan(3000);
        if (k > 0) expect(call[k].time).toBeGreaterThan(call[k - 1].time + call[k - 1].length);
      }
      const song = cricketSong(rng, 10);
      expect(song.level).toBeLessThanOrEqual(CRICKET_LEVEL);
      for (let k = 1; k < song.pulses.length; k++) expect(song.pulses[k]).toBeGreaterThan(song.pulses[k - 1]);
      expect(song.end).toBeGreaterThan(song.pulses[song.pulses.length - 1]);
    }
  });
});

describe('voice shaping', () => {
  it('detunes pad oscillators by at most two cents in total', () => {
    const rng = createRng(1);
    for (let i = 0; i < 1000; i++) {
      const [a, b] = padDetune(rng);
      expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
      expect(Math.abs(a)).toBeLessThanOrEqual(1);
      expect(Math.abs(b)).toBeLessThanOrEqual(1);
    }
  });

  it('gives pads only octave overtones, so no hidden partial can rub against the melody', () => {
    WARM_HARMONICS.forEach((amp, harmonic) => {
      if (amp > 0) expect([1, 2, 4]).toContain(harmonic);
    });
  });

  it('uses envelopes that start and end in silence and never jump', () => {
    const rise = riseCurve();
    const fall = fallCurve();
    const decay = decayCurve(5, 1.5);
    expect(rise[0]).toBe(0);
    expect(rise[rise.length - 1]).toBeCloseTo(1, 6);
    expect(fall[0]).toBeCloseTo(1, 6);
    expect(fall[fall.length - 1]).toBe(0);
    expect(decay[decay.length - 1]).toBe(0);
    for (let i = 1; i < rise.length; i++) {
      expect(rise[i]).toBeGreaterThanOrEqual(rise[i - 1]);
      expect(fall[i]).toBeLessThanOrEqual(fall[i - 1]);
      expect(decay[i]).toBeLessThanOrEqual(decay[i - 1]);
      expect(rise[i] - rise[i - 1]).toBeLessThan(0.1);
    }
  });
});

describe('scheduler', () => {
  it('looks a little ahead normally and further ahead when a background tab slows its timer', () => {
    expect(lookaheadFor(0.025)).toBe(LOOKAHEAD);
    expect(lookaheadFor(Number.NaN)).toBe(LOOKAHEAD);
    expect(lookaheadFor(0)).toBe(LOOKAHEAD);
    expect(lookaheadFor(1)).toBeGreaterThan(1);
    expect(lookaheadFor(1)).toBeLessThanOrEqual(MAX_LOOKAHEAD);
    expect(lookaheadFor(60)).toBe(MAX_LOOKAHEAD);
  });
});

describe('createAudio', () => {
  it('constructs without touching the Web Audio API', () => {
    const audio = createAudio();
    expect(audio.started).toBe(false);
    expect(typeof audio.start).toBe('function');
  });

  it('update before start is a no-op and leaves started false', () => {
    const audio = createAudio();
    expect(() => audio.update(0.016, snapshot())).not.toThrow();
    expect(() =>
      audio.update(1, snapshot({ biome: MATERIAL.FOREST, altitude: 210, speed: 3.1, nearWater: 1 })),
    ).not.toThrow();
    expect(() => audio.update(0.5, snapshot({ biome: MATERIAL.SNOW }))).not.toThrow();
    expect(audio.started).toBe(false);
  });

  it('discover before start is a no-op', () => {
    const audio = createAudio();
    expect(() => audio.discover()).not.toThrow();
    expect(audio.started).toBe(false);
  });

  it('start degrades to silence with no AudioContext available', async () => {
    const audio = createAudio();
    await expect(audio.start()).resolves.toBeUndefined();
    expect(audio.started).toBe(false);
    expect(() => audio.update(0.016, snapshot())).not.toThrow();
    expect(() => audio.discover()).not.toThrow();
  });

  it('getVolume reflects setVolume clamped to [0,1] before start', () => {
    const audio = createAudio();
    expect(audio.getVolume()).toBe(1);
    audio.setVolume(0.5);
    expect(audio.getVolume()).toBe(0.5);
    audio.setVolume(0);
    expect(audio.getVolume()).toBe(0);
    audio.setVolume(-3);
    expect(audio.getVolume()).toBe(0);
    audio.setVolume(4.2);
    expect(audio.getVolume()).toBe(1);
    audio.setVolume(Number.NaN);
    expect(audio.getVolume()).toBe(0);
    expect(audio.started).toBe(false);
  });
});

class FakeContext {
  static last: FakeContext | null = null;
  currentTime = 0;
  sampleRate = 16000;
  state = 'running';
  failures: string[] = [];
  nodes: FakeNode[] = [];
  playing = new Set<FakeSource>();
  started = 0;
  ended = 0;
  destination: FakeNode;

  constructor() {
    FakeContext.last = this;
    this.destination = new FakeNode(this);
  }

  fail(message: string): never {
    this.failures.push(message);
    throw new Error(message);
  }

  advance(dt: number): void {
    this.currentTime += dt;
    for (const source of Array.from(this.playing)) {
      if (source.stopAt <= this.currentTime) {
        this.playing.delete(source);
        this.ended++;
        source.onended?.();
      }
    }
  }

  connected(): number {
    return this.nodes.filter((n) => n.outputs.size > 0).length;
  }

  createGain() {
    const node = new FakeNode(this);
    return Object.assign(node, { gain: new FakeParam(this, 1) });
  }

  createBiquadFilter() {
    const node = new FakeNode(this);
    return Object.assign(node, {
      type: 'lowpass',
      frequency: new FakeParam(this, 350),
      Q: new FakeParam(this, 1),
      gain: new FakeParam(this, 0),
    });
  }

  createStereoPanner() {
    const node = new FakeNode(this);
    return Object.assign(node, { pan: new FakeParam(this, 0) });
  }

  createDynamicsCompressor() {
    const node = new FakeNode(this);
    return Object.assign(node, {
      threshold: new FakeParam(this, -24),
      knee: new FakeParam(this, 30),
      ratio: new FakeParam(this, 12),
      attack: new FakeParam(this, 0.003),
      release: new FakeParam(this, 0.25),
    });
  }

  createConvolver() {
    const node = new FakeNode(this);
    return Object.assign(node, { buffer: null as unknown, normalize: true });
  }

  createOscillator() {
    const node = new FakeSource(this);
    return Object.assign(node, {
      type: 'sine',
      frequency: new FakeParam(this, 440),
      detune: new FakeParam(this, 0),
      setPeriodicWave: () => undefined,
    });
  }

  createBufferSource() {
    const node = new FakeSource(this);
    return Object.assign(node, { buffer: null as unknown, loop: false, playbackRate: new FakeParam(this, 1) });
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c: number) => data[c] };
  }

  createPeriodicWave() {
    return {};
  }

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
}

class FakeNode {
  outputs = new Set<unknown>();
  constructor(protected ctx: FakeContext) {
    ctx.nodes.push(this);
  }
  connect(target: unknown): unknown {
    if (target === null || target === undefined) this.ctx.fail('connect to nothing');
    this.outputs.add(target);
    return target;
  }
  disconnect(): void {
    this.outputs.clear();
  }
}

class FakeSource extends FakeNode {
  onended: (() => void) | null = null;
  begun = false;
  stopAt = Infinity;
  start(when = 0): void {
    if (this.begun) this.ctx.fail('started twice');
    if (!(when >= 0)) this.ctx.fail('bad start time');
    this.begun = true;
    this.ctx.started++;
    this.ctx.playing.add(this);
  }
  stop(when = 0): void {
    if (!this.begun) this.ctx.fail('stopped before start');
    if (!(when >= 0)) this.ctx.fail('bad stop time');
    this.stopAt = Math.max(when, this.ctx.currentTime);
  }
}

class FakeParam {
  events: { time: number; end: number; curve: boolean }[] = [];
  constructor(
    private ctx: FakeContext,
    public value: number,
  ) {}
  private at(time: number, value: number, end: number = time, curve = false): this {
    if (!Number.isFinite(time) || time < 0) this.ctx.fail('bad automation time ' + time);
    if (!Number.isFinite(value)) this.ctx.fail('bad automation value ' + value);
    this.events = this.events.filter((e) => e.end >= this.ctx.currentTime - 1);
    for (const e of this.events) {
      if (e.curve && time >= e.time && time < e.end) this.ctx.fail('automation inside a value curve');
      if (curve && e.time > time && e.time < end) this.ctx.fail('value curve over another event');
    }
    this.events.push({ time, end, curve });
    return this;
  }
  setValueAtTime(value: number, time: number): this {
    return this.at(time, value);
  }
  linearRampToValueAtTime(value: number, time: number): this {
    return this.at(time, value);
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    if (!(value > 0)) this.ctx.fail('exponential ramp to non-positive value');
    return this.at(time, value);
  }
  setTargetAtTime(value: number, time: number, tau: number): this {
    if (!(tau > 0)) this.ctx.fail('bad time constant');
    return this.at(time, value);
  }
  setValueCurveAtTime(values: Float32Array, time: number, duration: number): this {
    if (values.length < 2 || !(duration > 0)) this.ctx.fail('bad value curve');
    for (const v of values) if (!Number.isFinite(v)) this.ctx.fail('bad curve value');
    return this.at(time, values[0], time + duration, true);
  }
  cancelScheduledValues(time: number): this {
    this.events = this.events.filter((e) => e.time < time);
    return this;
  }
}

describe('createAudio with a Web Audio context', () => {
  const scope = globalThis as unknown as { AudioContext?: unknown };

  afterEach(() => {
    vi.useRealTimers();
    delete scope.AudioContext;
    FakeContext.last = null;
  });

  it('plays for an hour through a changing world without leaking nodes or breaking automation rules', async () => {
    vi.useFakeTimers();
    scope.AudioContext = FakeContext;
    const audio = createAudio();
    audio.setVolume(0.7);
    audio.update(0.016, snapshot({ timeOfDay: 0.3 }));
    await audio.start();
    expect(audio.started).toBe(true);
    const ctx = FakeContext.last;
    expect(ctx).not.toBeNull();
    if (!ctx) return;
    const step = 0.05;
    let peak = 0;
    let atQuarter = 0;
    const steps = Math.round(3600 / step);
    for (let i = 0; i < steps; i++) {
      const t = i * step;
      ctx.advance(step);
      vi.advanceTimersByTime(step * 1000);
      const mood = journey(t * 3);
      const biome = { grass: MATERIAL.GRASS, forest: MATERIAL.FOREST, sand: MATERIAL.SAND, stone: MATERIAL.STONE, snow: MATERIAL.SNOW, water: MATERIAL.WATER }[mood.place];
      audio.update(step, {
        biome,
        nearWater: mood.water ? 0.55 : 0,
        altitude: mood.place === 'snow' ? 180 : mood.place === 'stone' ? 100 : 12,
        speed: i % 400 < 200 ? WALK_SPEED : RUN_SPEED,
        timeOfDay: (0.3 + (t * 3) / DAY_LENGTH_S) % 1,
      });
      if (i % 1500 === 0) audio.discover();
      if (i % 1200 === 0) audio.setVolume(0.5 + 0.5 * Math.sin(i));
      peak = Math.max(peak, ctx.connected());
      if (i === Math.round(steps / 4)) atQuarter = ctx.connected();
    }
    expect(ctx.failures).toEqual([]);
    expect(ctx.started).toBeGreaterThan(900);
    expect(ctx.started - ctx.ended).toBeLessThan(40);
    expect(ctx.connected()).toBeLessThan(140);
    expect(ctx.connected()).toBeLessThanOrEqual(Math.max(atQuarter, 60) + 40);
    expect(peak).toBeLessThan(200);
  });

  it('recovers a context that was suspended after start', async () => {
    vi.useFakeTimers();
    scope.AudioContext = FakeContext;
    const audio = createAudio();
    await audio.start();
    const ctx = FakeContext.last;
    if (!ctx) throw new Error('no context');
    ctx.state = 'suspended';
    for (let i = 0; i < 20; i++) audio.update(0.25, snapshot());
    expect(ctx.state).toBe('running');
    expect(ctx.failures).toEqual([]);
  });
});
