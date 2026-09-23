import { SEA_LEVEL } from '../config';
import type { Player } from './controller';

export interface Drift {
  update(dt: number): void;
  reset(): void;
}

const TURN_RATE = 0.2;
const ESCAPE_TURN_RATE = 0.45;
const RETARGET_MIN = 18;
const RETARGET_SPAN = 14;
const BLOCK_COOLDOWN = 2.5;
const PAUSE_MIN = 45;
const PAUSE_SPAN = 50;
const REST_MIN = 7;
const REST_SPAN = 9;
const CANDIDATES = [0, 0.25, -0.25, 0.5, -0.5, 0.9, -0.9, 1.3, -1.3, 1.9, -1.9, 2.6, -2.6, Math.PI];
const STALL_TIME = 1.5;
const STALL_DISTANCE = 0.3;
const STALL_MEMORY = 8;
const SETTLE_ANGLE = 0.6;
const ESCAPES = [1.3, 1.9, 2.6, Math.PI];

export function createDrift(player: Player, heightAt: (x: number, z: number) => number): Drift {
  let targetYaw = player.pose.yaw;
  let untilRetarget = RETARGET_MIN;
  let restLeft = 0;
  let untilPause = PAUSE_MIN;
  let blockCooldown = 0;
  let targetPitch = -0.02;
  let escaping = false;
  let anchorX = player.pose.x;
  let anchorZ = player.pose.z;
  let stalledFor = 0;
  let settling = false;
  let escapeSign = 1;
  let sinceEscape = Infinity;

  const probe = (yaw: number, dist: number): number => {
    const x = player.pose.x - Math.sin(yaw) * dist;
    const z = player.pose.z - Math.cos(yaw) * dist;
    return heightAt(x, z);
  };

  const clear = (yaw: number): boolean => {
    const here = player.groundHeight;
    for (const d of [10, 22, 38]) {
      const h = probe(yaw, d);
      if (h < SEA_LEVEL + 0.5) return false;
      if ((h - here) / d > 0.55) return false;
    }
    return true;
  };

  const retarget = (rng: number) => {
    const base = player.pose.yaw;
    const wander = base + (rng - 0.5) * 1.5;
    if (clear(wander)) {
      targetYaw = wander;
      escaping = false;
      return;
    }
    for (const c of CANDIDATES) {
      const yaw = base + c + (c === 0 ? 0 : (rng - 0.5) * 0.2);
      if (clear(yaw)) {
        targetYaw = yaw;
        escaping = Math.abs(c) > 1.2;
        return;
      }
    }
    targetYaw = base + Math.PI;
    escaping = true;
  };

  const holdAnchor = () => {
    anchorX = player.pose.x;
    anchorZ = player.pose.z;
    stalledFor = 0;
  };

  const headingError = (): number => {
    const diff = targetYaw - player.pose.yaw;
    return Math.atan2(Math.sin(diff), Math.cos(diff));
  };

  const stalled = (dt: number): boolean => {
    const dx = player.pose.x - anchorX;
    const dz = player.pose.z - anchorZ;
    if (dx * dx + dz * dz > STALL_DISTANCE * STALL_DISTANCE) {
      holdAnchor();
      return false;
    }
    stalledFor += dt;
    return stalledFor >= STALL_TIME;
  };

  const unstick = (rng: number) => {
    if (sinceEscape > STALL_MEMORY) escapeSign = rng < 0.5 ? -1 : 1;
    sinceEscape = 0;
    const base = player.pose.yaw;
    let chosen = base + escapeSign * Math.PI;
    for (const turn of ESCAPES) {
      if (clear(base + escapeSign * turn)) {
        chosen = base + escapeSign * turn;
        break;
      }
      if (clear(base - escapeSign * turn)) {
        chosen = base - escapeSign * turn;
        break;
      }
    }
    targetYaw = chosen;
    escaping = true;
    settling = true;
  };

  const update = (dt: number) => {
    const input = player.driftInput;
    input.strafe = 0;
    input.stroll = true;
    input.run = false;
    input.turn = 0;

    if (blockCooldown > 0) blockCooldown -= dt;
    sinceEscape += dt;
    untilRetarget -= dt;
    if (untilRetarget <= 0) {
      retarget(Math.random());
      untilRetarget = RETARGET_MIN + Math.random() * RETARGET_SPAN;
    }

    if (restLeft > 0) {
      restLeft -= dt;
      input.forward = 0;
      holdAnchor();
    } else {
      untilPause -= dt;
      if (untilPause <= 0) {
        restLeft = REST_MIN + Math.random() * REST_SPAN;
        untilPause = PAUSE_MIN + Math.random() * PAUSE_SPAN;
        targetPitch = 0.05 + Math.random() * 0.08;
      } else {
        targetPitch = -0.02;
      }
      if (blockCooldown <= 0 && !clear(player.pose.yaw)) {
        retarget(Math.random());
        blockCooldown = BLOCK_COOLDOWN;
        untilRetarget = RETARGET_MIN + Math.random() * RETARGET_SPAN;
      }
      input.forward = 1;
      if (settling) {
        if (Math.abs(headingError()) > SETTLE_ANGLE) {
          input.forward = 0;
          holdAnchor();
        } else {
          settling = false;
        }
      } else if (stalled(dt)) {
        unstick(Math.random());
        holdAnchor();
        blockCooldown = BLOCK_COOLDOWN;
        untilRetarget = RETARGET_MIN + Math.random() * RETARGET_SPAN;
        input.forward = 0;
      }
    }

    const diff = headingError();
    const rate = escaping ? ESCAPE_TURN_RATE : TURN_RATE;
    const stepSize = rate * dt;
    if (Math.abs(diff) <= stepSize) {
      player.pose.yaw = targetYaw;
      escaping = false;
    } else {
      player.pose.yaw += Math.sign(diff) * stepSize;
    }
    player.pose.pitch += (targetPitch - player.pose.pitch) * Math.min(1, dt / 5);
  };

  const reset = () => {
    targetYaw = player.pose.yaw;
    untilRetarget = RETARGET_MIN;
    restLeft = 0;
    blockCooldown = 0;
    escaping = false;
    settling = false;
    holdAnchor();
  };

  return { update, reset };
}
