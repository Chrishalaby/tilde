export function mix32(a: number, b = 0, c = 0, d = 0): number {
  let h = (a | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h ^= b | 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= c | 0;
  h = Math.imul(h ^ (h >>> 16), 0x27d4eb2f);
  h ^= d | 0;
  h = Math.imul(h ^ (h >>> 15), 0x165667b1);
  h ^= h >>> 13;
  h = Math.imul(h, 0x9e3779b1);
  return (h ^ (h >>> 16)) >>> 0;
}

export function hash01(a: number, b = 0, c = 0, d = 0): number {
  return mix32(a, b, c, d) / 4294967296;
}

export function sfc32(a: number, b: number, c: number, d: number): () => number {
  a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function chunkRng(seed: number, cx: number, cz: number, salt = 0): () => number {
  const s0 = mix32(seed, cx, cz, salt);
  const s1 = mix32(s0, cx, cz, salt + 1);
  const s2 = mix32(s1, cx, cz, salt + 2);
  const s3 = mix32(s2, cx, cz, salt + 3);
  const rng = sfc32(s0, s1, s2, s3);
  for (let i = 0; i < 8; i++) rng();
  return rng;
}

export function seedFromString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function randomSeed(): number {
  const buf = new Uint32Array(1);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  else buf[0] = Math.floor(Math.random() * 4294967296);
  return buf[0] >>> 0;
}

export function seedToString(seed: number): string {
  return (seed >>> 0).toString(36);
}

export function seedFromParam(param: string): number {
  const parsed = parseInt(param, 36);
  if (Number.isFinite(parsed) && /^[0-9a-z]+$/i.test(param)) return parsed >>> 0;
  return seedFromString(param);
}
