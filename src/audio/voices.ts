import type { MusicEvent, NoteOn } from './composer';
import { quietly, type Engine } from './engine';
import { between, createRng, type Rng } from './rng';
import { midiToFreq } from './theory';

export const DETUNE_MIN = 0.25;
export const DETUNE_MAX = 1;
export const SHIMMER_LEVEL = 0.15;
export const DRONE_OCTAVE_LEVEL = 0.25;
export const WARM_HARMONICS: readonly number[] = [0, 1, 0.3];
export const CURVE_POINTS = 64;
export const RELEASE_SHAPE = 4.5;
export const MELODY_TAU = 1.5;
export const TRIANGLE_LEVEL = 0.32;
export const FELT_BRIGHT = 3.5;
export const FELT_DARK = 1.6;
export const FELT_TAU = 0.45;
export const FELT_MAX_HZ = 3200;
export const FELT_Q = 0.4;
export const SHORTEST_NOTE = 0.4;
export const START_MARGIN = 0.005;
export const STOP_MARGIN = 0.05;
export const RELEASE_FLOOR = 1.5;
export const ATTACK_FLOOR = 1.5;

export interface BellPartial {
  ratio: number;
  level: number;
  tau: number;
}

export const BELL_PARTIALS: readonly BellPartial[] = [
  { ratio: 1, level: 1, tau: 2.2 },
  { ratio: 2, level: 0.22, tau: 0.9 },
  { ratio: 3, level: 0.07, tau: 0.4 },
];

export function padDetune(rng: Rng): [number, number] {
  const d = between(rng, DETUNE_MIN, DETUNE_MAX);
  return rng() < 0.5 ? [d, -d] : [-d, d];
}

export function riseCurve(points: number = CURVE_POINTS): Float32Array {
  const n = Math.max(2, Math.floor(points));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = Math.sin((Math.PI / 2) * (i / (n - 1)));
    out[i] = s * s;
  }
  return out;
}

export function fallCurve(points: number = CURVE_POINTS, shape: number = RELEASE_SHAPE): Float32Array {
  const n = Math.max(2, Math.floor(points));
  const out = new Float32Array(n);
  const floor = Math.exp(-shape);
  for (let i = 0; i < n; i++) out[i] = (Math.exp(-shape * (i / (n - 1))) - floor) / (1 - floor);
  out[n - 1] = 0;
  return out;
}

export function decayCurve(duration: number, tau: number, points: number = CURVE_POINTS): Float32Array {
  const shape = Math.max(0.5, duration / Math.max(0.01, tau));
  return fallCurve(points, shape);
}

export function scaled(curve: Float32Array, level: number): Float32Array {
  const out = new Float32Array(curve.length);
  for (let i = 0; i < curve.length; i++) out[i] = curve[i] * level;
  return out;
}

export interface Voices {
  play(ev: MusicEvent): void;
  live(): number;
  dispose(): void;
}

interface OpenVoice {
  release(at: number, release: number): void;
  pan(at: number, pan: number, glide: number): void;
  stop(): void;
}

export function createVoices(engine: Engine, seed: number): Voices {
  const ctx = engine.ctx;
  const rng = createRng(seed);
  const live = new Map<number, OpenVoice>();
  const rise = riseCurve();
  const fall = fallCurve();
  let warm: PeriodicWave | null = null;
  try {
    warm = ctx.createPeriodicWave(new Float32Array(WARM_HARMONICS.length), Float32Array.from(WARM_HARMONICS));
  } catch {
    warm = null;
  }

  const unplug = (nodes: AudioNode[]): void => {
    for (const node of nodes) quietly(() => node.disconnect());
  };

  const panTo = (nodes: AudioNode[], source: AudioNode, pan: number, out: AudioNode): StereoPannerNode | null => {
    try {
      const panner = ctx.createStereoPanner();
      nodes.push(panner);
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      source.connect(panner);
      panner.connect(out);
      return panner;
    } catch {
      source.connect(out);
      return null;
    }
  };

  const oscillator = (nodes: AudioNode[], freq: number, type: OscillatorType): OscillatorNode => {
    const osc = ctx.createOscillator();
    nodes.push(osc);
    osc.type = type;
    osc.frequency.value = freq;
    return osc;
  };

  const gain = (nodes: AudioNode[], value: number): GainNode => {
    const g = ctx.createGain();
    nodes.push(g);
    g.gain.value = value;
    return g;
  };

  const openVoice = (ev: NoteOn): void => {
    const nodes: AudioNode[] = [];
    try {
      const start = Math.max(ev.time, engine.now() + START_MARGIN);
      const attack = Math.max(ATTACK_FLOOR, ev.attack - (start - ev.time));
      const freq = midiToFreq(ev.midi);
      const drone = ev.part === 'drone';
      const env = gain(nodes, 0);
      env.gain.setValueCurveAtTime(scaled(rise, ev.level), start, attack);
      const main = oscillator(nodes, freq, 'sine');
      if (warm) main.setPeriodicWave(warm);
      const second = oscillator(nodes, drone ? freq * 2 : freq, 'sine');
      const secondGain = gain(nodes, drone ? DRONE_OCTAVE_LEVEL : SHIMMER_LEVEL);
      if (!drone) {
        const [a, b] = padDetune(rng);
        main.detune.value = a;
        second.detune.value = b;
      }
      main.connect(env);
      second.connect(secondGain);
      secondGain.connect(env);
      const panner = panTo(nodes, env, ev.pan, engine.pads);
      main.start(start);
      second.start(start);
      let released = false;
      const voice: OpenVoice = {
        release(at: number, release: number): void {
          if (released) return;
          released = true;
          const t = Math.max(at, engine.now() + 0.01, start + attack + 0.01);
          const d = Math.max(RELEASE_FLOOR, at + release - t);
          try {
            env.gain.setValueCurveAtTime(scaled(fall, ev.level), t, d);
          } catch {
            quietly(() => env.gain.setTargetAtTime(0, t, d / 5));
          }
          quietly(() => main.stop(t + d + STOP_MARGIN));
          quietly(() => second.stop(t + d + STOP_MARGIN));
        },
        pan(at: number, pan: number, glide: number): void {
          if (!panner) return;
          panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), Math.max(at, engine.now()), Math.max(0.1, glide / 3));
        },
        stop(): void {
          quietly(() => main.stop());
          quietly(() => second.stop());
        },
      };
      main.onended = (): void => {
        unplug(nodes);
        live.delete(ev.id);
      };
      live.set(ev.id, voice);
    } catch {
      unplug(nodes);
      live.delete(ev.id);
    }
  };

  const strike = (ev: NoteOn): { start: number; duration: number; attack: number } | null => {
    const start = Math.max(ev.time, engine.now() + START_MARGIN);
    const duration = ev.time + ev.duration - start;
    if (!(duration >= SHORTEST_NOTE)) return null;
    return { start, duration, attack: Math.min(ev.attack, duration * 0.2) };
  };

  const shapeStrike = (param: AudioParam, level: number, start: number, attack: number, duration: number, tau: number): void => {
    param.setValueAtTime(0, start);
    param.linearRampToValueAtTime(level, start + attack);
    const tail = duration - attack - 0.002;
    param.setValueCurveAtTime(scaled(decayCurve(tail, tau), level), start + attack + 0.002, tail);
  };

  const melodyNote = (ev: NoteOn): void => {
    const timing = strike(ev);
    if (!timing) return;
    const { start, duration, attack } = timing;
    const nodes: AudioNode[] = [];
    try {
      const freq = midiToFreq(ev.midi);
      const env = gain(nodes, 0);
      shapeStrike(env.gain, ev.level, start, attack, duration, MELODY_TAU);
      const sine = oscillator(nodes, freq, 'sine');
      sine.connect(env);
      const tri = oscillator(nodes, freq, 'triangle');
      const felt = ctx.createBiquadFilter();
      nodes.push(felt);
      felt.type = 'lowpass';
      felt.Q.value = FELT_Q;
      felt.frequency.value = Math.min(FELT_MAX_HZ, freq * FELT_BRIGHT);
      felt.frequency.setValueAtTime(Math.min(FELT_MAX_HZ, freq * FELT_BRIGHT), start);
      felt.frequency.setTargetAtTime(freq * FELT_DARK, start + attack, FELT_TAU);
      const triGain = gain(nodes, TRIANGLE_LEVEL);
      tri.connect(felt);
      felt.connect(triGain);
      triGain.connect(env);
      panTo(nodes, env, ev.pan, engine.melody);
      const stop = start + duration + STOP_MARGIN;
      sine.start(start);
      tri.start(start);
      sine.stop(stop);
      tri.stop(stop);
      sine.onended = (): void => unplug(nodes);
    } catch {
      unplug(nodes);
    }
  };

  const bellNote = (ev: NoteOn): void => {
    const timing = strike(ev);
    if (!timing) return;
    const { start, duration, attack } = timing;
    const nodes: AudioNode[] = [];
    try {
      const freq = midiToFreq(ev.midi);
      const sum = gain(nodes, 1);
      const stop = start + duration + STOP_MARGIN;
      const oscs: OscillatorNode[] = [];
      for (const p of BELL_PARTIALS) {
        const osc = oscillator(nodes, freq * p.ratio, 'sine');
        const g = gain(nodes, 0);
        shapeStrike(g.gain, ev.level * p.level, start, attack, duration, p.tau);
        osc.connect(g);
        g.connect(sum);
        oscs.push(osc);
      }
      panTo(nodes, sum, ev.pan, engine.bells);
      for (const osc of oscs) {
        osc.start(start);
        osc.stop(stop);
      }
      oscs[0].onended = (): void => unplug(nodes);
    } catch {
      unplug(nodes);
    }
  };

  return {
    play(ev: MusicEvent): void {
      try {
        switch (ev.kind) {
          case 'on':
            if (ev.part === 'melody') melodyNote(ev);
            else if (ev.part === 'bell') bellNote(ev);
            else openVoice(ev);
            break;
          case 'off':
            live.get(ev.id)?.release(ev.time, ev.release);
            break;
          case 'pan':
            live.get(ev.id)?.pan(ev.time, ev.pan, ev.glide);
            break;
          case 'breath':
            engine.setBreath(ev.level, ev.time, ev.glide);
            break;
          default:
            break;
        }
      } catch {
        return;
      }
    },
    live(): number {
      return live.size;
    },
    dispose(): void {
      for (const voice of live.values()) voice.stop();
      live.clear();
    },
  };
}
