import { WALK_SPEED } from '../config';
import type { Engine } from './engine';

export const NOISE_SECONDS = 2;
export const SMOOTH_TAU = 1.5;
export const WIND_BASE_GAIN = 0.03;
export const WIND_HIGH_GAIN = 0.12;
export const WIND_ALTITUDE_REF = 150;
export const WIND_SPEED_GAIN = 0.05;
export const WATER_GAIN = 0.08;
export const WATER_LOWPASS_HZ = 400;

export interface AmbienceSnapshot {
  nearWater: number;
  altitude: number;
  speed: number;
}

export interface Ambience {
  update(snap: AmbienceSnapshot): void;
  dispose(): void;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function createNoiseBuffer(ctx: BaseAudioContext, seconds: number = NOISE_SECONDS): AudioBuffer | null {
  try {
    const rate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(seconds * rate));
    const buffer = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        lp += (white - lp) * 0.16;
        data[i] = lp * 2.6;
      }
      const fade = Math.min(1024, length >> 1);
      for (let i = 0; i < fade; i++) {
        const k = i / fade;
        data[i] *= k;
        data[length - 1 - i] *= k;
      }
    }
    return buffer;
  } catch {
    return null;
  }
}

export function createAmbience(engine: Engine): Ambience | null {
  try {
    const ctx = engine.ctx;
    const buffer = createNoiseBuffer(ctx);
    if (!buffer) return null;

    const windGain = ctx.createGain();
    windGain.gain.value = WIND_BASE_GAIN;
    windGain.connect(engine.bus);

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 400;
    windFilter.Q.value = 0.7;
    windFilter.connect(windGain);

    const wind = ctx.createBufferSource();
    wind.buffer = buffer;
    wind.loop = true;
    wind.connect(windFilter);

    const waterGain = ctx.createGain();
    waterGain.gain.value = 0;
    waterGain.connect(engine.bus);

    const waterFilter = ctx.createBiquadFilter();
    waterFilter.type = 'lowpass';
    waterFilter.frequency.value = WATER_LOWPASS_HZ;
    waterFilter.Q.value = 0.9;
    waterFilter.connect(waterGain);

    const water = ctx.createBufferSource();
    water.buffer = buffer;
    water.loop = true;
    water.playbackRate.value = 0.83;
    water.connect(waterFilter);

    const t0 = engine.now();
    wind.start(t0);
    water.start(t0 + NOISE_SECONDS * 0.37);

    return {
      update(snap: AmbienceSnapshot): void {
        try {
          const t = engine.now();
          const altitude = clamp01(snap.altitude / WIND_ALTITUDE_REF);
          const motion = clamp01(snap.speed / WALK_SPEED);
          const near = clamp01(snap.nearWater);
          const gain =
            WIND_BASE_GAIN +
            (WIND_HIGH_GAIN - WIND_BASE_GAIN) * altitude +
            WIND_SPEED_GAIN * motion;
          const cutoff = 260 + 820 * altitude + 420 * motion;
          windGain.gain.setTargetAtTime(gain, t, SMOOTH_TAU);
          windFilter.frequency.setTargetAtTime(cutoff, t, SMOOTH_TAU);
          waterGain.gain.setTargetAtTime(near * WATER_GAIN, t, SMOOTH_TAU);
        } catch {
          return;
        }
      },
      dispose(): void {
        try {
          wind.stop();
          water.stop();
          wind.disconnect();
          water.disconnect();
          windFilter.disconnect();
          waterFilter.disconnect();
          windGain.disconnect();
          waterGain.disconnect();
        } catch {
          return;
        }
      },
    };
  } catch {
    return null;
  }
}
