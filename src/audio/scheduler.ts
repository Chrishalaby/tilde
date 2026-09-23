export const TICK_MS = 25;
export const LOOKAHEAD = 0.1;
export const NOTE_INTERVAL = 3.2;
export const DEFAULT_DENSITY = 0.35;
export const NOTES_MIN = 6;
export const NOTES_MAX = 10;
export const SILENCE_MIN = 20;
export const SILENCE_MAX = 60;

export interface SchedulerHost {
  now(): number;
  play(time: number, midi: number): void;
}

export interface Scheduler {
  start(): void;
  stop(): void;
  running(): boolean;
  setScale(midiNotes: number[]): void;
  setDensity(p: number): void;
}

function notesBeforeSilence(): number {
  return NOTES_MIN + Math.floor(Math.random() * (NOTES_MAX - NOTES_MIN + 1));
}

function silenceLength(): number {
  return SILENCE_MIN + Math.random() * (SILENCE_MAX - SILENCE_MIN);
}

export function createScheduler(host: SchedulerHost): Scheduler {
  let timer: ReturnType<typeof setInterval> | null = null;
  let scale: number[] = [];
  let density = DEFAULT_DENSITY;
  let nextTime = 0;
  let played = 0;
  let quota = notesBeforeSilence();
  let silentUntil = 0;
  let lastMidi = -1;

  const pick = (): number => {
    if (scale.length === 0) return -1;
    let midi = scale[Math.floor(Math.random() * scale.length)];
    if (scale.length > 1 && midi === lastMidi) {
      midi = scale[Math.floor(Math.random() * scale.length)];
    }
    lastMidi = midi;
    return midi;
  };

  const tick = (): void => {
    try {
      const t = host.now();
      if (nextTime < t) nextTime = t + LOOKAHEAD;
      let guard = 0;
      while (nextTime < t + LOOKAHEAD && guard < 64) {
        guard++;
        if (nextTime >= silentUntil && Math.random() < density) {
          const midi = pick();
          if (midi >= 0) {
            host.play(nextTime, midi);
            played++;
            if (played >= quota) {
              played = 0;
              quota = notesBeforeSilence();
              silentUntil = nextTime + silenceLength();
            }
          }
        }
        nextTime += NOTE_INTERVAL;
      }
    } catch {
      return;
    }
  };

  return {
    start(): void {
      if (timer !== null) return;
      nextTime = host.now() + LOOKAHEAD;
      played = 0;
      quota = notesBeforeSilence();
      silentUntil = 0;
      timer = setInterval(tick, TICK_MS);
    },
    stop(): void {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
    running(): boolean {
      return timer !== null;
    },
    setScale(midiNotes: number[]): void {
      scale = midiNotes.slice();
    },
    setDensity(p: number): void {
      density = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : density;
    },
  };
}
