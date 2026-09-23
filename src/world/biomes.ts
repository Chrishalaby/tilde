import { MATERIAL, type MaterialId } from '../config';

const WATER_LEVEL = 0;
const SAND_LEVEL = 3;
const SNOW_LEVEL = 125;
const STONE_LEVEL = 90;
const STONE_SLOPE = 0.85;
const FOREST_MOISTURE = 0.12;
const FOREST_LEVEL = 65;

export function materialFor(
  height: number,
  slope: number,
  moisture: number,
  temperature: number,
): MaterialId {
  if (height < WATER_LEVEL) return MATERIAL.WATER;
  if (height < SAND_LEVEL) return MATERIAL.SAND;
  if (height > SNOW_LEVEL) return MATERIAL.SNOW;
  if (slope > STONE_SLOPE || height > STONE_LEVEL) return MATERIAL.STONE;
  if (moisture > FOREST_MOISTURE && height < FOREST_LEVEL) return MATERIAL.FOREST;
  return MATERIAL.GRASS;
}
