import { mix32 } from '../world/hash';

const ONSETS = [
  'b', 'br', 'd', 'dr', 'f', 'g', 'h', 'k', 'kr', 'l', 'm', 'n', 'p', 'r',
  's', 'sh', 'sl', 'sn', 'st', 't', 'th', 'tr', 'v', 'w', 'y', 'z',
];

const MIDS = ['n', 'l', 'r', 's', 'm', 'v', 'd', 't', 'th', 'll', 'nn', 'rr', 'sh', 'k'];

const VOWELS = [
  'a', 'e', 'i', 'o', 'u', 'a', 'e', 'i', 'o', 'u',
  'a', 'e', 'i', 'o', 'ai', 'ei', 'ia', 'ou',
];

const PLAIN = 14;

const CODAS = ['', '', '', '', '', 'n', 'l', 'r', 's', 'm', 'th', 'ne', 'ra'];

export function nameFor(seed: number, salt: number): string {
  const count = mix32(seed, salt, 3) % 4 === 0 ? 3 : 2;
  let out = ONSETS[mix32(seed, salt, 11) % ONSETS.length];
  out += VOWELS[mix32(seed, salt, 17) % VOWELS.length];
  for (let i = 1; i < count; i++) {
    out += MIDS[mix32(seed, salt, 23, i) % MIDS.length];
    out += VOWELS[mix32(seed, salt, 29, i) % PLAIN];
  }
  out += CODAS[mix32(seed, salt, 31) % CODAS.length];
  return out.charAt(0).toUpperCase() + out.slice(1);
}
