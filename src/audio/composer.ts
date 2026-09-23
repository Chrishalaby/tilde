import { MATERIAL, type MaterialId } from '../config';
import type { Engine } from './engine';
import { DEFAULT_DENSITY } from './scheduler';

export const DRONE_MIDI = 36;
export const DRONE_GAIN = 0.04;
export const DRONE_FADE = 8;
export const PAD_LOWPASS_HZ = 1200;
export const BELL_RATIO = 3.5;
export const BELL_GAIN = 0.25;
export const BELL_INDEX_DECAY = 1.5;
export const BELL_RELEASE = 4;

const MAJOR_PENTATONIC_C3_A5 = [48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81];
const LYDIAN_COLOUR = [54, 66, 78];
const MINOR_PENTATONIC_A2_A4 = [45, 48, 50, 52, 55, 57, 60, 62, 64, 67, 69];

const WATER_SCALE = MAJOR_PENTATONIC_C3_A5.concat(LYDIAN_COLOUR).sort((a, b) => a - b);
const SNOW_SCALE = MINOR_PENTATONIC_A2_A4.map((n) => n + 12);

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function scaleFor(biome: MaterialId): number[] {
  switch (biome) {
    case MATERIAL.WATER:
      return WATER_SCALE;
    case MATERIAL.STONE:
      return MINOR_PENTATONIC_A2_A4;
    case MATERIAL.SNOW:
      return SNOW_SCALE;
    default:
      return MAJOR_PENTATONIC_C3_A5;
  }
}

export function densityFor(biome: MaterialId): number {
  switch (biome) {
    case MATERIAL.SNOW:
      return DEFAULT_DENSITY * 0.5;
    case MATERIAL.SAND:
      return DEFAULT_DENSITY * 0.6;
    default:
      return DEFAULT_DENSITY;
  }
}

export function hasDrone(biome: MaterialId): boolean {
  return biome === MATERIAL.FOREST;
}

export function playPad(engine: Engine, time: number, midi: number): void {
  try {
    const ctx = engine.ctx;
    const freq = midiToFreq(midi);
    const attack = 2 + Math.random() * 2;
    const release = 6 + Math.random() * 4;
    const peak = 0.12 + Math.random() * 0.08;
    const detune = (Math.random() * 2 - 1) * 4;
    const end = time + attack + release;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = PAD_LOWPASS_HZ;
    filter.Q.value = 0.6;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(peak, time + attack);
    gain.gain.linearRampToValueAtTime(0, end);
    filter.connect(gain);
    gain.connect(engine.bus);
    gain.connect(engine.reverbSend);

    const top = ctx.createOscillator();
    top.type = 'sine';
    top.frequency.value = freq;
    top.detune.value = detune;
    top.connect(filter);

    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    subGain.connect(filter);

    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.value = freq / 2;
    sub.detune.value = -detune;
    sub.connect(subGain);

    top.start(time);
    sub.start(time);
    top.stop(end + 0.05);
    sub.stop(end + 0.05);
    top.onended = (): void => {
      try {
        top.disconnect();
        sub.disconnect();
        subGain.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch {
        return;
      }
    };
  } catch {
    return;
  }
}

export function playBell(engine: Engine, time: number, midi: number): void {
  try {
    const ctx = engine.ctx;
    const freq = midiToFreq(midi);
    const end = time + BELL_RELEASE;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(BELL_GAIN, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    gain.connect(engine.bus);
    gain.connect(engine.reverbSend);

    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = freq;
    carrier.connect(gain);

    const index = ctx.createGain();
    index.gain.setValueAtTime(freq * 4, time);
    index.gain.exponentialRampToValueAtTime(freq * 0.01, time + BELL_INDEX_DECAY);
    index.connect(carrier.frequency);

    const modulator = ctx.createOscillator();
    modulator.type = 'sine';
    modulator.frequency.value = freq * BELL_RATIO;
    modulator.connect(index);

    carrier.start(time);
    modulator.start(time);
    carrier.stop(end + 0.05);
    modulator.stop(end + 0.05);
    carrier.onended = (): void => {
      try {
        carrier.disconnect();
        modulator.disconnect();
        index.disconnect();
        gain.disconnect();
      } catch {
        return;
      }
    };
  } catch {
    return;
  }
}

export interface Drone {
  setActive(on: boolean): void;
  dispose(): void;
}

export function createDrone(engine: Engine): Drone | null {
  try {
    const ctx = engine.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(engine.bus);
    gain.connect(engine.reverbSend);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = midiToFreq(DRONE_MIDI);
    osc.connect(gain);
    osc.start();

    let active = false;
    return {
      setActive(on: boolean): void {
        if (on === active) return;
        active = on;
        try {
          const t = engine.now();
          gain.gain.cancelScheduledValues(t);
          gain.gain.setValueAtTime(gain.gain.value, t);
          gain.gain.linearRampToValueAtTime(on ? DRONE_GAIN : 0, t + DRONE_FADE);
        } catch {
          return;
        }
      },
      dispose(): void {
        try {
          osc.stop();
          osc.disconnect();
          gain.disconnect();
        } catch {
          return;
        }
      },
    };
  } catch {
    return null;
  }
}
