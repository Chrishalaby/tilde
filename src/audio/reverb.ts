export const IMPULSE_SECONDS = 4.5;
export const IMPULSE_RT60 = 3.2;
export const IMPULSE_PREDELAY = 0.02;
export const IMPULSE_ONSET = 0.008;
export const IMPULSE_BRIGHT = 0.5;
export const IMPULSE_DARK = 0.1;

export function createImpulseResponse(
  ctx: BaseAudioContext,
  seconds: number = IMPULSE_SECONDS,
  rt60: number = IMPULSE_RT60,
  random: () => number = Math.random,
): AudioBuffer | null {
  try {
    const rate = ctx.sampleRate;
    const length = Math.max(2, Math.floor(seconds * rate));
    const buffer = ctx.createBuffer(2, length, rate);
    const decayPerSample = Math.pow(10, -3 / Math.max(0.001, rt60) / rate);
    const pre = Math.min(length - 1, Math.floor(IMPULSE_PREDELAY * rate));
    const onset = Math.max(1, Math.floor(IMPULSE_ONSET * rate));
    const span = Math.max(1, length - pre);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let lp = 0;
      let envelope = 1;
      for (let i = pre; i < length; i++) {
        const n = i - pre;
        const k = IMPULSE_BRIGHT + (IMPULSE_DARK - IMPULSE_BRIGHT) * (n / span);
        lp += (random() * 2 - 1 - lp) * k;
        data[i] = lp * envelope * Math.min(1, n / onset);
        envelope *= decayPerSample;
      }
    }
    return buffer;
  } catch {
    return null;
  }
}

export function createReverb(ctx: BaseAudioContext): ConvolverNode | null {
  try {
    const convolver = ctx.createConvolver();
    convolver.normalize = true;
    const impulse = createImpulseResponse(ctx);
    if (!impulse) return null;
    convolver.buffer = impulse;
    return convolver;
  } catch {
    return null;
  }
}
