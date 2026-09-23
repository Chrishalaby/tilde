import { SEA_LEVEL } from '../config';
import type { Player } from './controller';

export interface Drift {
  update(dt: number): void;
  reset(): void;
}

export function createDrift(player: Player, heightAt: (x: number, z: number) => number): Drift {
  let targetYaw = player.pose.yaw;
  let untilRetarget = 4;
  let pauseLeft = 0;
  let untilPause = 30 + Math.random() * 40;
  let targetPitch = 0;

  const probe = (yaw: number, dist: number): number => {
    const x = player.pose.x - Math.sin(yaw) * dist;
    const z = player.pose.z - Math.cos(yaw) * dist;
    return heightAt(x, z);
  };

  const clear = (yaw: number): boolean => {
    const here = player.groundHeight;
    for (const d of [12, 24, 40]) {
      const h = probe(yaw, d);
      if (h < SEA_LEVEL + 0.5) return false;
      if ((h - here) / d > 0.55) return false;
    }
    return true;
  };

  const retarget = () => {
    const base = player.pose.yaw;
    const candidates = [0, 0.35, -0.35, 0.8, -0.8, 1.4, -1.4, 2.2, -2.2, Math.PI];
    for (const c of candidates) {
      const yaw = base + c + (Math.random() - 0.5) * 0.25;
      if (clear(yaw)) {
        targetYaw = yaw;
        return;
      }
    }
    targetYaw = base + Math.PI;
  };

  const update = (dt: number) => {
    const input = player.driftInput;
    untilRetarget -= dt;
    if (untilRetarget <= 0) {
      retarget();
      untilRetarget = 5 + Math.random() * 7;
    }
    if (pauseLeft > 0) {
      pauseLeft -= dt;
      input.forward = 0;
      input.turn = 0;
      input.stroll = true;
    } else {
      untilPause -= dt;
      if (untilPause <= 0) {
        pauseLeft = 6 + Math.random() * 9;
        untilPause = 30 + Math.random() * 40;
        targetPitch = 0.08 + Math.random() * 0.12;
      } else {
        targetPitch = -0.02;
      }
      if (!clear(player.pose.yaw)) retarget();
      input.forward = 1;
      input.stroll = true;
    }
    input.strafe = 0;
    let diff = targetYaw - player.pose.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    player.pose.yaw += diff * Math.min(1, dt * 0.9);
    player.pose.pitch += (targetPitch - player.pose.pitch) * Math.min(1, dt * 0.6);
  };

  const reset = () => {
    targetYaw = player.pose.yaw;
    untilRetarget = 2;
    pauseLeft = 0;
  };

  return { update, reset };
}
