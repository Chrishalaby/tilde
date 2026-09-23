import { MATERIAL, type MaterialId } from '../config';
import { createAmbience, type Ambience } from './ambience';
import { createDrone, densityFor, hasDrone, playBell, playPad, scaleFor, type Drone } from './composer';
import { clamp01, createEngine, type Engine } from './engine';
import { createScheduler, type Scheduler } from './scheduler';

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

export function createAudio(): Audio {
  let engine: Engine | null = null;
  let scheduler: Scheduler | null = null;
  let ambience: Ambience | null = null;
  let drone: Drone | null = null;
  let volume = 1;
  let failed = false;
  let starting = false;
  let biome: MaterialId = MATERIAL.GRASS;
  let scale = scaleFor(MATERIAL.GRASS);
  let since = UPDATE_INTERVAL;
  let pending: AudioContextSnapshot | null = null;

  const applyBiome = (next: MaterialId): void => {
    biome = next;
    scale = scaleFor(next);
    if (scheduler) {
      scheduler.setScale(scale);
      scheduler.setDensity(densityFor(next));
    }
    if (drone) drone.setActive(hasDrone(next));
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
        ambience = createAmbience(made);
        drone = createDrone(made);
        scheduler = createScheduler({
          now: () => made.now(),
          play: (time: number, midi: number) => playPad(made, time, midi),
        });
        scheduler.setScale(scale);
        scheduler.setDensity(densityFor(biome));
        if (drone) drone.setActive(hasDrone(biome));
        scheduler.start();
        api.started = true;
        since = UPDATE_INTERVAL;
        if (pending) {
          api.update(0, pending);
          pending = null;
        }
      } catch {
        failed = true;
      } finally {
        starting = false;
      }
    },

    update(dt: number, snap: AudioContextSnapshot): void {
      if (!api.started || !engine) {
        pending = snap;
        return;
      }
      const next = snap.biome as MaterialId;
      const changed = next !== biome;
      since += Number.isFinite(dt) ? dt : 0;
      if (!changed && since < UPDATE_INTERVAL) return;
      since = 0;
      if (changed) applyBiome(next);
      if (ambience) ambience.update(snap);
    },

    discover(): void {
      if (!api.started || !engine) return;
      const top = scale.length - 1;
      const midi = scale[Math.max(0, top - Math.floor(Math.random() * 3))];
      playBell(engine, engine.now() + 0.02, midi);
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
