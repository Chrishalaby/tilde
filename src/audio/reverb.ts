export const IMPULSE_SECONDS = 4;
export const IMPULSE_RT60 = 3;

export function createImpulseResponse(
  ctx: BaseAudioContext,
  seconds: number = IMPULSE_SECONDS,
  rt60: number = IMPULSE_RT60,
): AudioBuffer | null {
  try {
    const rate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(seconds * rate));
    const buffer = ctx.createBuffer(2, length, rate);
    const decayK = -3 / Math.max(0.001, rt60);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        const t = i / rate;
        const progress = i / length;
        const k = 1 - 0.6 * progress;
        const white = Math.random() * 2 - 1;
        lp += (white - lp) * k;
        data[i] = lp * Math.pow(10, decayK * t);
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
