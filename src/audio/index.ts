import { MATERIAL } from '../config';
import { createAmbience, type Ambience } from './ambience';
import { createComposer, type Composer } from './composer';
import { clamp01, createEngine, type Engine } from './engine';
import { initialMood, moodOf, stepMood, toneFor, type Mood, type MoodState, type Tone } from './mood';
import { randomSeed } from './rng';
import { createScheduler, type Scheduler } from './scheduler';
import { createVoices, type Voices } from './voices';

export interface AudioContextSnapshot {
  biome: number;
  nearWater: number;
  altitude: number;
  speed: number;
  timeOfDay: number;
}

export interface Audio {
  start(): Promise<void>;
  started: boolean;
  update(dt: number, snap: AudioContextSnapshot): void;
  discover(): void;
  setVolume(v: number): void;
  getVolume(): number;
}

const UPDATE_INTERVAL = 0.5;
const RESUME_INTERVAL = 2;
const FIRST_NOTE_DELAY = 0.1;
const BELL_DELAY = 0.03;
const TONE_EPSILON = 0.002;
const AMBIENCE_SEED = 0x5bd1e995;
const DEFAULT_SNAPSHOT: AudioContextSnapshot = { biome: MATERIAL.GRASS, nearWater: 0, altitude: 0, speed: 0, timeOfDay: 0.34 };

function sameTone(a: Tone, b: Tone): boolean {
  return (
    Math.abs(a.padCutoff - b.padCutoff) < 1 &&
    Math.abs(a.reverb - b.reverb) < TONE_EPSILON &&
    Math.abs(a.trim - b.trim) < TONE_EPSILON
  );
}

export function createAudio(): Audio {
  let engine: Engine | null = null;
  let scheduler: Scheduler | null = null;
  let ambience: Ambience | null = null;
  let voices: Voices | null = null;
  let composer: Composer | null = null;
  let moodState: MoodState | null = null;
  let mood: Mood | null = null;
  let tone: Tone | null = null;
  let volume = 1;
  let failed = false;
  let starting = false;
  let since = UPDATE_INTERVAL;
  let resumeWait = 0;
  let pending: AudioContextSnapshot | null = null;

  const applyTone = (next: Tone): void => {
    if (!engine || (tone && sameTone(tone, next))) return;
    tone = next;
    engine.setTone(next);
  };

  const api: Audio = {
    started: false,

    async start(): Promise<void> {
      if (api.started || starting || failed) return;
      starting = true;
      try {
        const made = createEngine(volume);
        if (!made) {
          failed = true;
          return;
        }
        engine = made;
        await made.resume();
        const seed = randomSeed();
        const first = pending ?? DEFAULT_SNAPSHOT;
        moodState = initialMood(first);
        mood = moodOf(moodState);
        applyTone(toneFor(mood));
        const renderer = createVoices(made, seed);
        voices = renderer;
        ambience = createAmbience(made, (seed ^ AMBIENCE_SEED) >>> 0);
        const score = createComposer(seed, made.now() + FIRST_NOTE_DELAY);
        composer = score;
        scheduler = createScheduler({
          now: () => made.now(),
          due: (until: number, now: number) => {
            if (!mood) return;
            for (const ev of score.advance(until, mood, now)) renderer.play(ev);
          },
        });
        scheduler.start();
        api.started = true;
        since = UPDATE_INTERVAL;
        pending = null;
        api.update(0, first);
      } catch {
        failed = true;
        api.started = false;
        scheduler?.stop();
        engine?.dispose();
        engine = null;
        scheduler = null;
      } finally {
        starting = false;
      }
    },

    update(dt: number, snap: AudioContextSnapshot): void {
      if (!api.started || !engine || !moodState) {
        pending = snap;
        return;
      }
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
      since += step;
      resumeWait += step;
      if (since < UPDATE_INTERVAL) return;
      moodState = stepMood(moodState, snap, since);
      since = 0;
      mood = moodOf(moodState);
      applyTone(toneFor(mood));
      if (ambience) {
        ambience.update({
          altitude: snap.altitude,
          speed: snap.speed,
          nearWater: snap.nearWater,
          daylight: mood.daylight,
          place: mood.place,
        });
      }
      if (resumeWait >= RESUME_INTERVAL) {
        resumeWait = 0;
        if (!engine.running()) void engine.resume();
      }
    },

    discover(): void {
      if (!api.started || !engine || !composer || !voices) return;
      const ev = composer.bell(engine.now() + BELL_DELAY);
      if (ev) voices.play(ev);
    },

    setVolume(v: number): void {
      volume = clamp01(v);
      if (engine) engine.setVolume(volume);
    },

    getVolume(): number {
      return volume;
    },
  };

  return api;
}
