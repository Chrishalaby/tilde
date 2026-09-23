export type Rng = () => number;

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

export function between(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

export function weighted<T>(rng: Rng, items: readonly T[], weights: readonly number[]): T | undefined {
  let total = 0;
  for (let i = 0; i < items.length; i++) total += Math.max(0, weights[i] ?? 0);
  if (!(total > 0)) return undefined;
  let r = rng() * total;
  let last: T | undefined;
  for (let i = 0; i < items.length; i++) {
    const w = Math.max(0, weights[i] ?? 0);
    if (w <= 0) continue;
    last = items[i];
    r -= w;
    if (r < 0) return items[i];
  }
  return last;
}

export function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0;
  const t = span === 0 ? (x < edge0 ? 0 : 1) : clamp01((x - edge0) / span);
  return t * t * (3 - 2 * t);
}
