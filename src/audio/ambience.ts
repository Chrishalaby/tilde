import { RUN_SPEED } from '../config';
import { quietly, type Engine } from './engine';
import { PLACES, type PlaceName } from './mood';
import { between, chance, clamp01, createRng, smoothstep, type Rng } from './rng';
import { KEY, PENTATONIC, midiToFreq } from './theory';

export const NOISE_SECONDS = 9.3;
export const NOISE_RMS = 0.25;
export const NOISE_SEAM = 4096;

export const WIND_BASE = 0.05;
export const WIND_ALTITUDE_GAIN = 0.025;
export const WIND_ALTITUDE_REF = 150;
export const WIND_MOTION_GAIN = 0.004;
export const WIND_CUTOFF_BASE = 320;
export const WIND_CUTOFF_ALTITUDE = 180;
export const WIND_CUTOFF_MOTION = 40;
export const WIND_Q = 0.4;
export const WIND_TAU = 3;
export const GUST_MIN = 0.78;
export const GUST_MAX = 1.18;
export const GUST_EVERY_MIN = 6;
export const GUST_EVERY_MAX = 14;

export const WATER_GAIN = 0.14;
export const WATER_CURVE = 1.2;
export const WATER_TAU = 2.5;
export const WATER_HIGHPASS_HZ = 150;
export const WATER_DARK_HZ = 420;
export const WATER_BRIGHT_HZ = 900;
export const WATER_RATE = 0.71;
export const LAP_TROUGH = 0.3;
export const LAP_EVERY_MIN = 2.2;
export const LAP_EVERY_MAX = 4.6;
export const LAP_RISE_MIN = 0.5;
export const LAP_RISE_MAX = 0.95;
export const LAP_FALL_MIN = 1.2;
export const LAP_FALL_MAX = 2.3;
export const LAP_HORIZON = 1.5;

export const LIFE_ALTITUDE_START = 60;
export const LIFE_ALTITUDE_END = 140;
export const BIRD_DAYLIGHT = 0.6;
export const BIRD_LEVEL = 0.0035;
export const BIRD_EVERY_MIN = 25;
export const BIRD_EVERY_MAX = 70;
export const BIRD_OCTAVE = 48;
export const INSECT_NIGHT = 0.6;
export const CRICKET_LEVEL = 0.0022;
export const CRICKET_EVERY_MIN = 30;
export const CRICKET_EVERY_MAX = 75;
export const CRICKET_LOW_HZ = 4200;
export const CRICKET_HIGH_HZ = 4800;
export const CRICKET_PULSE = 0.014;
export const LIFE_PAN = 0.7;

export interface AmbienceSnapshot {
  altitude: number;
  speed: number;
  nearWater: number;
  daylight: number;
  place: PlaceName;
}

export interface Ambience {
  update(snap: AmbienceSnapshot): void;
  dispose(): void;
}

export function windLevel(altitude: number, speed: number): number {
  const high = smoothstep(0, 1, clamp01(altitude / WIND_ALTITUDE_REF));
  const motion = clamp01(speed / RUN_SPEED);
  return WIND_BASE + WIND_ALTITUDE_GAIN * high + WIND_MOTION_GAIN * motion * motion;
}

export function windCutoff(altitude: number, speed: number): number {
  const high = smoothstep(0, 1, clamp01(altitude / WIND_ALTITUDE_REF));
  const motion = clamp01(speed / RUN_SPEED);
  return WIND_CUTOFF_BASE + WIND_CUTOFF_ALTITUDE * high + WIND_CUTOFF_MOTION * motion;
}

export function waterLevel(nearWater: number): number {
  return Math.pow(clamp01(nearWater), WATER_CURVE);
}

export interface Lap {
  time: number;
  rise: number;
  fall: number;
  peak: number;
  bright: number;
}

export function nextLap(rng: Rng, after: number): Lap {
  return {
    time: after + between(rng, LAP_EVERY_MIN, LAP_EVERY_MAX),
    rise: between(rng, LAP_RISE_MIN, LAP_RISE_MAX),
    fall: between(rng, LAP_FALL_MIN, LAP_FALL_MAX),
    peak: between(rng, 0.65, 1),
    bright: between(rng, 0.4, 1),
  };
}

function lifeAtAltitude(altitude: number): number {
  return 1 - smoothstep(LIFE_ALTITUDE_START, LIFE_ALTITUDE_END, altitude);
}

export function birdChance(daylight: number, place: PlaceName, altitude: number): number {
  if (daylight < BIRD_DAYLIGHT) return 0;
  return clamp01(PLACES[place].birds * lifeAtAltitude(altitude) * 0.6);
}

export function insectChance(daylight: number, place: PlaceName, altitude: number): number {
  if (1 - daylight < INSECT_NIGHT) return 0;
  return clamp01(PLACES[place].insects * lifeAtAltitude(altitude) * 0.7);
}

export interface Chirp {
  time: number;
  from: number;
  to: number;
  length: number;
  level: number;
}

export function birdCall(rng: Rng, time: number): Chirp[] {
  const count = 2 + Math.floor(rng() * 3);
  const home = KEY + BIRD_OCTAVE + PENTATONIC[Math.floor(rng() * PENTATONIC.length)];
  const out: Chirp[] = [];
  let t = time;
  for (let i = 0; i < count; i++) {
    const from = home + (rng() < 0.5 ? 0 : 2);
    const to = from + (rng() < 0.6 ? 1 : -1) * (2 + Math.floor(rng() * 4));
    const length = between(rng, 0.07, 0.14);
    out.push({ time: t, from: midiToFreq(from), to: midiToFreq(to), length, level: BIRD_LEVEL * between(rng, 0.6, 1) });
    t += length + between(rng, 0.1, 0.28);
  }
  return out;
}

export interface CricketSong {
  freq: number;
  pulses: number[];
  level: number;
  end: number;
}

export function cricketSong(rng: Rng, time: number): CricketSong {
  const freq = between(rng, CRICKET_LOW_HZ, CRICKET_HIGH_HZ);
  const length = between(rng, 6, 14);
  const every = between(rng, 0.72, 1.05);
  const perChirp = 2 + Math.floor(rng() * 3);
  const gap = between(rng, 0.028, 0.036);
  const pulses: number[] = [];
  for (let t = time; t < time + length; t += every * between(rng, 0.95, 1.05)) {
    for (let k = 0; k < perChirp; k++) pulses.push(t + k * gap);
  }
  const last = pulses.length > 0 ? pulses[pulses.length - 1] : time;
  return { freq, pulses, level: CRICKET_LEVEL * between(rng, 0.6, 1), end: last + CRICKET_PULSE + 0.1 };
}

export function createNoiseBuffer(ctx: BaseAudioContext, rng: Rng, seconds: number = NOISE_SECONDS): AudioBuffer | null {
  try {
    const rate = ctx.sampleRate;
    const length = Math.max(NOISE_SEAM * 2, Math.floor(seconds * rate));
    const buffer = ctx.createBuffer(2, length, rate);
    const raw = new Float32Array(length + NOISE_SEAM);
    for (let ch = 0; ch < 2; ch++) {
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let b3 = 0;
      let b4 = 0;
      let b5 = 0;
      let b6 = 0;
      let energy = 0;
      for (let i = 0; i < raw.length; i++) {
        const white = rng() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
        energy += raw[i] * raw[i];
      }
      const scale = NOISE_RMS / Math.max(1e-9, Math.sqrt(energy / raw.length));
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = raw[i] * scale;
      for (let i = 0; i < NOISE_SEAM; i++) {
        const k = i / NOISE_SEAM;
        data[i] = data[i] * Math.sqrt(k) + raw[length + i] * scale * Math.sqrt(1 - k);
      }
      for (let i = 0; i < length; i++) data[i] = Math.max(-1, Math.min(1, data[i]));
    }
    return buffer;
  } catch {
    return null;
  }
}

export function createAmbience(engine: Engine, seed: number): Ambience | null {
  const ctx = engine.ctx;
  const rng = createRng(seed);
  const buffer = createNoiseBuffer(ctx, rng);
  if (!buffer) return null;
  const nodes: AudioNode[] = [];
  const keep = <T extends AudioNode>(node: T): T => {
    nodes.push(node);
    return node;
  };
  try {
    const windGain = keep(ctx.createGain());
    windGain.gain.value = 0;
    windGain.connect(engine.ambience);
    const windFilter = keep(ctx.createBiquadFilter());
    windFilter.type = 'lowpass';
    windFilter.frequency.value = WIND_CUTOFF_BASE;
    windFilter.Q.value = WIND_Q;
    windFilter.connect(windGain);
    const wind = keep(ctx.createBufferSource());
    wind.buffer = buffer;
    wind.loop = true;
    wind.connect(windFilter);

    const waterGain = keep(ctx.createGain());
    waterGain.gain.value = 0;
    waterGain.connect(engine.ambience);
    const lapGain = keep(ctx.createGain());
    lapGain.gain.value = LAP_TROUGH;
    lapGain.connect(waterGain);
    const waterFilter = keep(ctx.createBiquadFilter());
    waterFilter.type = 'lowpass';
    waterFilter.frequency.value = WATER_DARK_HZ;
    waterFilter.Q.value = 0.5;
    waterFilter.connect(lapGain);
    const waterHigh = keep(ctx.createBiquadFilter());
    waterHigh.type = 'highpass';
    waterHigh.frequency.value = WATER_HIGHPASS_HZ;
    waterHigh.Q.value = 0.5;
    waterHigh.connect(waterFilter);
    const water = keep(ctx.createBufferSource());
    water.buffer = buffer;
    water.loop = true;
    water.playbackRate.value = WATER_RATE;
    water.connect(waterHigh);

    const t0 = engine.now();
    wind.start(t0);
    water.start(t0, NOISE_SECONDS * 0.43);

    let gust = 1;
    let nextGust = t0 + between(rng, GUST_EVERY_MIN, GUST_EVERY_MAX);
    let lap = nextLap(rng, t0);
    let nextBird = t0 + between(rng, 8, 20);
    let nextCricket = t0 + between(rng, 10, 30);

    const scheduleLap = (l: Lap): void => {
      lapGain.gain.setTargetAtTime(l.peak, l.time, l.rise / 3);
      lapGain.gain.setTargetAtTime(LAP_TROUGH, l.time + l.rise, l.fall / 3);
      waterFilter.frequency.setTargetAtTime(WATER_DARK_HZ + (WATER_BRIGHT_HZ - WATER_DARK_HZ) * l.bright, l.time, l.rise / 2);
      waterFilter.frequency.setTargetAtTime(WATER_DARK_HZ, l.time + l.rise, l.fall / 2);
    };

    const panned = (list: AudioNode[], source: AudioNode, pan: number): void => {
      try {
        const panner = ctx.createStereoPanner();
        list.push(panner);
        panner.pan.value = pan;
        source.connect(panner);
        panner.connect(engine.ambience);
      } catch {
        source.connect(engine.ambience);
      }
      source.connect(engine.ambienceSend);
    };

    const playCall = (chirps: Chirp[]): void => {
      if (chirps.length === 0) return;
      const list: AudioNode[] = [];
      try {
        const osc = ctx.createOscillator();
        list.push(osc);
        osc.type = 'sine';
        osc.frequency.value = chirps[0].from;
        const g = ctx.createGain();
        list.push(g);
        g.gain.value = 0;
        osc.connect(g);
        panned(list, g, between(rng, -LIFE_PAN, LIFE_PAN));
        for (const c of chirps) {
          osc.frequency.setValueAtTime(c.from, c.time);
          osc.frequency.exponentialRampToValueAtTime(c.to, c.time + c.length);
          g.gain.setValueAtTime(0, c.time);
          g.gain.linearRampToValueAtTime(c.level, c.time + 0.012);
          g.gain.linearRampToValueAtTime(0, c.time + c.length);
        }
        const last = chirps[chirps.length - 1];
        osc.onended = (): void => {
          for (const node of list) quietly(() => node.disconnect());
        };
        osc.start(chirps[0].time);
        osc.stop(last.time + last.length + 0.05);
      } catch {
        for (const node of list) quietly(() => node.disconnect());
      }
    };

    const playSong = (song: CricketSong): void => {
      if (song.pulses.length === 0) return;
      const list: AudioNode[] = [];
      try {
        const osc = ctx.createOscillator();
        list.push(osc);
        osc.type = 'sine';
        osc.frequency.value = song.freq;
        const g = ctx.createGain();
        list.push(g);
        g.gain.value = 0;
        osc.connect(g);
        panned(list, g, between(rng, -LIFE_PAN, LIFE_PAN));
        for (const p of song.pulses) {
          g.gain.setTargetAtTime(song.level, p, 0.003);
          g.gain.setTargetAtTime(0, p + CRICKET_PULSE, 0.004);
        }
        osc.onended = (): void => {
          for (const node of list) quietly(() => node.disconnect());
        };
        osc.start(song.pulses[0] - 0.01);
        osc.stop(song.end);
      } catch {
        for (const node of list) quietly(() => node.disconnect());
      }
    };

    return {
      update(snap: AmbienceSnapshot): void {
        try {
          const t = engine.now();
          if (t >= nextGust) {
            gust = between(rng, GUST_MIN, GUST_MAX);
            nextGust = t + between(rng, GUST_EVERY_MIN, GUST_EVERY_MAX);
          }
          windGain.gain.setTargetAtTime(windLevel(snap.altitude, snap.speed) * gust, t, WIND_TAU);
          windFilter.frequency.setTargetAtTime(windCutoff(snap.altitude, snap.speed), t, WIND_TAU);
          const wet = waterLevel(snap.nearWater);
          waterGain.gain.setTargetAtTime(wet * WATER_GAIN, t, WATER_TAU);
          if (lap.time < t) lap = nextLap(rng, t);
          while (lap.time < t + LAP_HORIZON) {
            if (wet > 0.001) scheduleLap(lap);
            lap = nextLap(rng, lap.time);
          }
          if (t >= nextBird) {
            if (chance(rng, birdChance(snap.daylight, snap.place, snap.altitude))) playCall(birdCall(rng, t + 0.2));
            nextBird = t + between(rng, BIRD_EVERY_MIN, BIRD_EVERY_MAX);
          }
          if (t >= nextCricket) {
            if (chance(rng, insectChance(snap.daylight, snap.place, snap.altitude))) playSong(cricketSong(rng, t + 0.2));
            nextCricket = t + between(rng, CRICKET_EVERY_MIN, CRICKET_EVERY_MAX);
          }
        } catch {
          return;
        }
      },
      dispose(): void {
        quietly(() => wind.stop());
        quietly(() => water.stop());
        for (const node of nodes) quietly(() => node.disconnect());
      },
    };
  } catch {
    for (const node of nodes) quietly(() => node.disconnect());
    return null;
  }
}
