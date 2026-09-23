import { mix32 } from './hash';
import { createNoise2, fbm, ridged } from './noise';
import type { WorldSampler } from './types';

const WARP_FREQ = 1 / 700;
const WARP_AMPLITUDE = 60;
const WARP_GAIN = 1.7;

const CONTINENT_FREQ = 1 / 2000;
const CONTINENT_GAIN = 1.15;
const CONTINENT_AMPLITUDE = 110;
const CONTINENT_BIAS = 12;

const RIDGE_FREQ = 1 / 400;
const RIDGE_AMPLITUDE = 90;
const RIDGE_LOW = 0.68;
const RIDGE_HIGH = 0.96;
const RIDGE_LAND_BIAS = 0.25;

const HILL_FREQ = 1 / 100;
const HILL_GAIN = 0.6;
const HILL_AMPLITUDE = 18;
const HILL_ROUGHNESS = 0.4;

const DETAIL_FREQ = 1 / 12;
const DETAIL_GAIN = 0.7;
const DETAIL_AMPLITUDE = 1.5;
const DETAIL_ROUGHNESS = 0.45;

const MOISTURE_FREQ = 1 / 250;
const MOISTURE_GAIN = 1.9;

const TEMPERATURE_FREQ = 1 / 1500;
const TEMPERATURE_GAIN = 1.8;

function clampUnit(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

function soften(v: number): number {
  return v / Math.sqrt(1 + v * v);
}

function smoothstep(edge0: number, edge1: number, v: number): number {
  const t = (v - edge0) / (edge1 - edge0);
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

export function createSampler(seed: number): WorldSampler {
  const warpX = createNoise2(mix32(seed, 0x57a1));
  const warpZ = createNoise2(mix32(seed, 0x57a2));
  const continentNoise = createNoise2(mix32(seed, 0xc07a));
  const ridgeNoise = createNoise2(mix32(seed, 0x21d6));
  const hillNoise = createNoise2(mix32(seed, 0x4111));
  const detailNoise = createNoise2(mix32(seed, 0xde7a));
  const moistureNoise = createNoise2(mix32(seed, 0x0157));
  const temperatureNoise = createNoise2(mix32(seed, 0x7e90));

  function height(x: number, z: number): number {
    const wx = x * WARP_FREQ;
    const wz = z * WARP_FREQ;
    const px = x + clampUnit(fbm(warpX, wx, wz, 3) * WARP_GAIN) * WARP_AMPLITUDE;
    const pz = z + clampUnit(fbm(warpZ, wx, wz, 3) * WARP_GAIN) * WARP_AMPLITUDE;

    const continent = soften(
      fbm(continentNoise, px * CONTINENT_FREQ, pz * CONTINENT_FREQ, 4) * CONTINENT_GAIN,
    );
    let h = continent * CONTINENT_AMPLITUDE + CONTINENT_BIAS;

    const land = continent + RIDGE_LAND_BIAS;
    if (land > 0) {
      const mask = land > 1 ? 1 : land;
      const r = ridged(ridgeNoise, px * RIDGE_FREQ, pz * RIDGE_FREQ, 4);
      const crest = smoothstep(RIDGE_LOW, RIDGE_HIGH, r);
      if (crest > 0) h += crest * RIDGE_AMPLITUDE * mask;
    }

    const hills = fbm(hillNoise, px * HILL_FREQ, pz * HILL_FREQ, 4, 2, HILL_ROUGHNESS);
    h += clampUnit(hills * HILL_GAIN) * HILL_AMPLITUDE;

    const detail = fbm(detailNoise, x * DETAIL_FREQ, z * DETAIL_FREQ, 2, 2, DETAIL_ROUGHNESS);
    h += clampUnit(detail * DETAIL_GAIN) * DETAIL_AMPLITUDE;

    return h;
  }

  function moisture(x: number, z: number): number {
    return clampUnit(
      fbm(moistureNoise, x * MOISTURE_FREQ, z * MOISTURE_FREQ, 3) * MOISTURE_GAIN,
    );
  }

  function temperature(x: number, z: number): number {
    return clampUnit(
      fbm(temperatureNoise, x * TEMPERATURE_FREQ, z * TEMPERATURE_FREQ, 2) * TEMPERATURE_GAIN,
    );
  }

  return { height, moisture, temperature };
}
