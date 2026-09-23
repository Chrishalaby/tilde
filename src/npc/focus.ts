import type { NpcSnapshot } from './types';

export interface Eye {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export const TALK_REACH = 6;
export const TALK_CONE = (12 * Math.PI) / 180;

const HIP = 0.5;
const HEAD = 1.7;
const TOO_CLOSE = 0.25;

export function villagerInSight<T extends NpcSnapshot>(
  eye: Eye,
  crowd: readonly T[],
  reach = TALK_REACH,
  cone = TALK_CONE,
): T | null {
  const level = Math.cos(eye.pitch);
  const fx = -Math.sin(eye.yaw) * level;
  const fy = Math.sin(eye.pitch);
  const fz = -Math.cos(eye.yaw) * level;
  const slope = Math.tan(eye.pitch);
  let best: T | null = null;
  let bestDot = Math.cos(cone);
  for (let i = 0; i < crowd.length; i++) {
    const npc = crowd[i];
    const dx = npc.x - eye.x;
    const dz = npc.z - eye.z;
    const flat = Math.sqrt(dx * dx + dz * dz);
    if (flat > reach || flat < TOO_CLOSE) continue;
    const aim = eye.y + slope * flat;
    const target = Math.min(npc.y + HEAD, Math.max(npc.y + HIP, aim));
    const dy = target - eye.y;
    const dot = (fx * dx + fy * dy + fz * dz) / Math.sqrt(flat * flat + dy * dy);
    if (dot > bestDot) {
      bestDot = dot;
      best = npc;
    }
  }
  return best;
}
