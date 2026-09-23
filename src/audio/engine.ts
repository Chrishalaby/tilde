import type { Tone } from './mood';
import { createReverb } from './reverb';
import { clamp, clamp01 } from './rng';

export { clamp01 };

export const MASTER_DB = -16;
export const MASTER_LEVEL = Math.pow(10, MASTER_DB / 20);
export const VOLUME_RAMP = 0.3;
export const MASTER_LOWPASS_HZ = 6500;
export const COMPRESSOR_THRESHOLD = -24;
export const COMPRESSOR_KNEE = 12;
export const COMPRESSOR_RATIO = 2;
export const COMPRESSOR_ATTACK = 0.03;
export const COMPRESSOR_RELEASE = 0.8;
export const PAD_CUTOFF_HZ = 1050;
export const PAD_CUTOFF_MIN = 700;
export const PAD_CUTOFF_MAX = 1300;
export const PAD_Q = 0.5;
export const PAD_LFO_HZ = 0.018;
export const PAD_LFO_DEPTH_HZ = 70;
export const MUSIC_SEND = 0.3;
export const BELL_SEND = 0.5;
export const AMBIENCE_SEND = 0.12;
export const REVERB_RETURN = 0.8;
export const TONE_TAU = 4;
export const BREATH_TAU_MIN = 0.5;

export interface Engine {
  ctx: BaseAudioContext;
  pads: AudioNode;
  melody: AudioNode;
  bells: AudioNode;
  ambience: AudioNode;
  ambienceSend: AudioNode;
  now(): number;
  running(): boolean;
  setVolume(v: number): void;
  setBreath(level: number, at: number, glide: number): void;
  setTone(tone: Tone): void;
  resume(): Promise<void>;
  dispose(): void;
}

type AudioCtor = new () => AudioContext;

function audioContextCtor(): AudioCtor | null {
  const scope = globalThis as unknown as {
    AudioContext?: AudioCtor;
    webkitAudioContext?: AudioCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

export function quietly(action: () => void): void {
  try {
    action();
  } catch {
    return;
  }
}

function closeQuietly(ctx: AudioContext): void {
  quietly(() => {
    ctx.close().catch(() => undefined);
  });
}

function gainNode(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

export function createEngine(volume: number): Engine | null {
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  const nodes: AudioNode[] = [];
  const keep = <T extends AudioNode>(node: T): T => {
    nodes.push(node);
    return node;
  };
  try {
    const master = keep(gainNode(ctx, MASTER_LEVEL * clamp01(volume)));
    master.connect(ctx.destination);

    const compressor = keep(ctx.createDynamicsCompressor());
    compressor.threshold.value = COMPRESSOR_THRESHOLD;
    compressor.knee.value = COMPRESSOR_KNEE;
    compressor.ratio.value = COMPRESSOR_RATIO;
    compressor.attack.value = COMPRESSOR_ATTACK;
    compressor.release.value = COMPRESSOR_RELEASE;
    compressor.connect(master);

    const lowpass = keep(ctx.createBiquadFilter());
    lowpass.type = 'lowpass';
    lowpass.frequency.value = MASTER_LOWPASS_HZ;
    lowpass.Q.value = 0.5;
    lowpass.connect(compressor);

    const mix = keep(gainNode(ctx, 1));
    mix.connect(lowpass);

    const reverbIn = keep(gainNode(ctx, 1));
    const reverbReturn = keep(gainNode(ctx, REVERB_RETURN));
    reverbReturn.connect(mix);
    const convolver = createReverb(ctx);
    if (convolver) {
      keep(convolver);
      reverbIn.connect(convolver);
      convolver.connect(reverbReturn);
    } else {
      reverbIn.gain.value = 0;
    }

    const trim = keep(gainNode(ctx, 1));
    trim.connect(mix);
    const music = keep(gainNode(ctx, 0));
    music.connect(trim);
    const musicSend = keep(gainNode(ctx, MUSIC_SEND));
    trim.connect(musicSend);
    musicSend.connect(reverbIn);

    const padFilter = keep(ctx.createBiquadFilter());
    padFilter.type = 'lowpass';
    padFilter.frequency.value = PAD_CUTOFF_HZ;
    padFilter.Q.value = PAD_Q;
    padFilter.connect(music);
    const pads = keep(gainNode(ctx, 1));
    pads.connect(padFilter);

    const lfo = keep(ctx.createOscillator());
    lfo.type = 'sine';
    lfo.frequency.value = PAD_LFO_HZ;
    const lfoDepth = keep(gainNode(ctx, PAD_LFO_DEPTH_HZ));
    lfo.connect(lfoDepth);
    lfoDepth.connect(padFilter.frequency);
    lfo.start();

    const melody = keep(gainNode(ctx, 1));
    melody.connect(music);

    const bells = keep(gainNode(ctx, 1));
    bells.connect(mix);
    const bellSend = keep(gainNode(ctx, BELL_SEND));
    bells.connect(bellSend);
    bellSend.connect(reverbIn);

    const ambience = keep(gainNode(ctx, 1));
    ambience.connect(mix);
    const ambienceSend = keep(gainNode(ctx, AMBIENCE_SEND));
    ambienceSend.connect(reverbIn);

    const now = (): number => {
      try {
        const t = ctx.currentTime;
        return Number.isFinite(t) ? t : 0;
      } catch {
        return 0;
      }
    };

    const glideTo = (param: AudioParam, value: number, tau: number): void => {
      try {
        if (Number.isFinite(value)) param.setTargetAtTime(value, now(), tau);
      } catch {
        return;
      }
    };

    return {
      ctx,
      pads,
      melody,
      bells,
      ambience,
      ambienceSend,
      now,
      running(): boolean {
        try {
          return ctx.state === 'running';
        } catch {
          return false;
        }
      },
      setVolume(v: number): void {
        const target = MASTER_LEVEL * clamp01(v);
        try {
          const t = ctx.currentTime;
          master.gain.cancelScheduledValues(t);
          master.gain.setValueAtTime(master.gain.value, t);
          master.gain.linearRampToValueAtTime(target, t + VOLUME_RAMP);
        } catch {
          try {
            master.gain.value = target;
          } catch {
            return;
          }
        }
      },
      setBreath(level: number, at: number, glide: number): void {
        try {
          if (!Number.isFinite(level) || !Number.isFinite(at)) return;
          const tau = Math.max(BREATH_TAU_MIN, (Number.isFinite(glide) ? glide : 0) / 3);
          music.gain.setTargetAtTime(clamp(level, 0, 1), Math.max(at, now()), tau);
        } catch {
          return;
        }
      },
      setTone(tone: Tone): void {
        glideTo(padFilter.frequency, clamp(tone.padCutoff, PAD_CUTOFF_MIN, PAD_CUTOFF_MAX), TONE_TAU);
        glideTo(musicSend.gain, clamp(tone.reverb, 0, 1), TONE_TAU);
        glideTo(trim.gain, clamp(tone.trim, 0, 1.5), TONE_TAU);
      },
      async resume(): Promise<void> {
        try {
          if (ctx.state !== 'running') await ctx.resume();
        } catch {
          return;
        }
      },
      dispose(): void {
        quietly(() => lfo.stop());
        for (const node of nodes) quietly(() => node.disconnect());
        closeQuietly(ctx);
      },
    };
  } catch {
    for (const node of nodes) quietly(() => node.disconnect());
    closeQuietly(ctx);
    return null;
  }
}
