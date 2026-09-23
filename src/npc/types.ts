import type { Landmark } from '../world/types';

export type NpcState = 'idle' | 'wander' | 'return' | 'rest' | 'approach' | 'talk';

export type Temperament = 'curious' | 'quiet' | 'wistful' | 'cheerful';

export interface Npc {
  id: string;
  name: string;
  glyph: string;
  temperament: Temperament;
  homeKey: string;
  homeX: number;
  homeZ: number;
  x: number;
  z: number;
  y: number;
  yaw: number;
  speed: number;
  state: NpcState;
  speaking: string | null;
  speakUntil: number;
}

export interface NpcSnapshot {
  id: string;
  name: string;
  glyph: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  state: NpcState;
  speaking: string | null;
}

export interface PlayerView {
  x: number;
  z: number;
  yaw: number;
  lettersFound: ReadonlySet<string>;
}

export interface NpcWorld {
  heightAt(x: number, z: number): number;
  materialAt(x: number, z: number): number;
  timeOfDay(): number;
  player(): PlayerView;
  landmarksNear(x: number, z: number, radius: number): Landmark[];
  discovered(key: string): boolean;
  fires(): Array<{ x: number; z: number }>;
  collide?(x: number, z: number, radius: number): { x: number; z: number };
}

export interface Intent {
  moveX: number;
  moveZ: number;
  state: NpcState;
}

export type Speaker = 'player' | 'npc';

export interface ChatLine {
  who: Speaker;
  text: string;
}

export interface ChatTurn {
  history: ChatLine[];
  message: string;
  metBefore: boolean;
  homeKind: string;
}

export interface Brain {
  decide(npc: Npc, world: NpcWorld, dt: number, rng: () => number): Intent;
  speak(npc: Npc, world: NpcWorld, rng: () => number): string;
  speakAsync?(npc: Npc, world: NpcWorld, rng: () => number): Promise<string | null>;
  chat?(npc: Npc, world: NpcWorld, turn: ChatTurn, rng: () => number): Promise<string>;
}
