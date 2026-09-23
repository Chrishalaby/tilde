import { createReverb } from './reverb';

export const MASTER_DB = -12;
export const MASTER_LEVEL = Math.pow(10, MASTER_DB / 20);
export const VOLUME_RAMP = 0.3;
export const MASTER_LOWPASS_HZ = 7000;
export const REVERB_SEND = 0.35;
export const REVERB_RETURN = 0.8;

export interface Engine {
  ctx: BaseAudioContext;
  bus: GainNode;
  reverbSend: GainNode;
  lowpass: BiquadFilterNode;
  master: GainNode;
  now(): number;
  setVolume(v: number): void;
  resume(): Promise<void>;
  dispose(): void;
}

type AudioCtor = new () => AudioContext;

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function audioContextCtor(): AudioCtor | null {
  const scope = globalThis as unknown as {
    AudioContext?: AudioCtor;
    webkitAudioContext?: AudioCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
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
  try {
    const master = ctx.createGain();
    master.gain.value = MASTER_LEVEL * clamp01(volume);
    master.connect(ctx.destination);

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = MASTER_LOWPASS_HZ;
    lowpass.Q.value = 0.5;
    lowpass.connect(master);

    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(lowpass);

    const reverbSend = ctx.createGain();
    reverbSend.gain.value = REVERB_SEND;

    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = REVERB_RETURN;
    reverbReturn.connect(lowpass);

    const convolver = createReverb(ctx);
    if (convolver) {
      reverbSend.connect(convolver);
      convolver.connect(reverbReturn);
    } else {
      reverbSend.gain.value = 0;
    }

    return {
      ctx,
      bus,
      reverbSend,
      lowpass,
      master,
      now(): number {
        try {
          return ctx.currentTime;
        } catch {
          return 0;
        }
      },
      setVolume(v: number): void {
        try {
          const t = ctx.currentTime;
          const target = MASTER_LEVEL * clamp01(v);
          master.gain.cancelScheduledValues(t);
          master.gain.setValueAtTime(master.gain.value, t);
          master.gain.linearRampToValueAtTime(target, t + VOLUME_RAMP);
        } catch {
          try {
            master.gain.value = MASTER_LEVEL * clamp01(v);
          } catch {
            return;
          }
        }
      },
      async resume(): Promise<void> {
        try {
          if (ctx.state !== 'running') await ctx.resume();
        } catch {
          return;
        }
      },
      dispose(): void {
        try {
          reverbSend.disconnect();
          reverbReturn.disconnect();
          if (convolver) convolver.disconnect();
          bus.disconnect();
          lowpass.disconnect();
          master.disconnect();
          void ctx.close();
        } catch {
          return;
        }
      },
    };
  } catch {
    try {
      void ctx.close();
    } catch {
      return null;
    }
    return null;
  }
}
