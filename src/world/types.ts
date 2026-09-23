export type LandmarkKind = 'letter' | 'castle' | 'ring' | 'tree' | 'pool' | 'shelter';

export interface Landmark {
  kind: LandmarkKind;
  letter: string | null;
  x: number;
  z: number;
  y: number;
  regionKey: string;
}

export interface ChunkData {
  cx: number;
  cz: number;
  genVersion: number;
  heights: Float32Array;
  materials: Uint8Array;
  props: Float32Array;
  landmark: Landmark | null;
  roads?: Float32Array;
}

export interface GenRequest {
  type: 'gen';
  seed: number;
  cx: number;
  cz: number;
  genVersion: number;
}

export interface ChunkReply extends ChunkData {
  type: 'chunk';
}

export type WorkerMessage = ChunkReply;

export interface WorldSampler {
  height(x: number, z: number): number;
  moisture(x: number, z: number): number;
  temperature(x: number, z: number): number;
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export function regionKey(rx: number, rz: number): string {
  return `${rx},${rz}`;
}
