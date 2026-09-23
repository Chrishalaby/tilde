import {
  ACCEL_TIME, CAMERA_LAG, DECEL_TIME, EYE_HEIGHT, LOOK_SENSITIVITY, MAX_WADE_DEPTH,
  RUN_SPEED, SEA_LEVEL, STROLL_SPEED, WALK_SPEED,
} from '../config';
import { keyCode } from './keys';

export interface PlayerPose {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface PlayerView {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface PlayerInput {
  forward: number;
  strafe: number;
  turn: number;
  stroll: boolean;
  run: boolean;
}

export interface Player {
  pose: PlayerPose;
  view: PlayerView;
  speed: number;
  groundHeight: number;
  locked: boolean;
  drifting: boolean;
  driftInput: PlayerInput;
  update(dt: number): void;
  onFirstLock(cb: () => void): void;
  dispose(): void;
}

export interface PlayerOptions {
  canvas: HTMLCanvasElement;
  heightAt(x: number, z: number): number;
  initial: PlayerPose;
  headBob?: boolean;
  collide?: (x: number, z: number, radius: number) => { x: number; z: number };
}

export const PLAYER_RADIUS = 0.35;

const TURN_RATE = 1.1;
const PITCH_LIMIT = Math.PI / 2 - 0.05;
const PUSH_EPSILON = 1e-6;

export function createPlayer(opts: PlayerOptions): Player {
  const { canvas, heightAt, collide } = opts;
  const pose: PlayerPose = { ...opts.initial };
  const view: PlayerView = { x: pose.x, y: 0, z: pose.z, yaw: pose.yaw, pitch: pose.pitch };
  const keys = new Set<string>();
  let vx = 0;
  let vz = 0;
  let locked = false;
  let firstLockCb: (() => void) | null = null;
  let bobPhase = 0;

  const player: Player = {
    pose,
    view,
    speed: 0,
    groundHeight: 0,
    locked: false,
    drifting: false,
    driftInput: { forward: 0, strafe: 0, turn: 0, stroll: true, run: false },
    update,
    onFirstLock: (cb) => { firstLockCb = cb; },
    dispose,
  };

  const isTyping = (ev: KeyboardEvent) => {
    const t = ev.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (isTyping(ev)) return;
    const code = keyCode(ev);
    keys.add(code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) ev.preventDefault();
  };
  const onKeyUp = (ev: KeyboardEvent) => { keys.delete(keyCode(ev)); };
  const onBlur = () => { keys.clear(); };
  const onClick = () => {
    if (!locked && canvas.requestPointerLock) {
      try {
        const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch { }
    }
  };
  const onLockChange = () => {
    const nowLocked = document.pointerLockElement === canvas;
    if (nowLocked && !locked && firstLockCb) {
      const cb = firstLockCb;
      firstLockCb = null;
      cb();
    }
    locked = nowLocked;
    player.locked = locked;
  };
  const onMouseMove = (ev: MouseEvent) => {
    if (!locked) return;
    pose.yaw -= ev.movementX * LOOK_SENSITIVITY;
    pose.pitch -= ev.movementY * LOOK_SENSITIVITY;
    if (pose.pitch > PITCH_LIMIT) pose.pitch = PITCH_LIMIT;
    if (pose.pitch < -PITCH_LIMIT) pose.pitch = -PITCH_LIMIT;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('click', onClick);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('mousemove', onMouseMove);

  const readInput = (): PlayerInput => {
    if (player.drifting) return player.driftInput;
    let forward = 0;
    let strafe = 0;
    let turn = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) forward += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) forward -= 1;
    if (keys.has('KeyD')) strafe += 1;
    if (keys.has('KeyA')) strafe -= 1;
    if (keys.has('ArrowLeft')) turn += 1;
    if (keys.has('ArrowRight')) turn -= 1;
    return {
      forward,
      strafe,
      turn,
      stroll: keys.has('ControlLeft') || keys.has('ControlRight'),
      run: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    };
  };

  player.groundHeight = heightAt(pose.x, pose.z);
  view.y = Math.max(player.groundHeight, SEA_LEVEL - MAX_WADE_DEPTH) + EYE_HEIGHT;

  function update(dt: number) {
    const input = readInput();
    pose.yaw += input.turn * TURN_RATE * dt;

    const len = Math.hypot(input.forward, input.strafe);
    const maxSpeed = input.stroll ? STROLL_SPEED : input.run ? RUN_SPEED : WALK_SPEED;
    let tx = 0;
    let tz = 0;
    if (len > 0) {
      const f = input.forward / len;
      const s = input.strafe / len;
      const sy = Math.sin(pose.yaw);
      const cy = Math.cos(pose.yaw);
      tx = (-sy * f + cy * s) * maxSpeed;
      tz = (-cy * f - sy * s) * maxSpeed;
    }
    const ahead = heightAt(pose.x + tx * 0.4, pose.z + tz * 0.4);
    const here = heightAt(pose.x, pose.z);
    const rise = ahead - here;
    let slopeFactor = 1;
    if (len > 0 && rise > 0) {
      const run = Math.hypot(tx, tz) * 0.4;
      const grade = rise / Math.max(0.01, run);
      slopeFactor = grade > 1 ? Math.max(0.25, 1 / grade) : 1;
    }
    if (ahead < SEA_LEVEL - MAX_WADE_DEPTH && len > 0) slopeFactor = 0;
    tx *= slopeFactor;
    tz *= slopeFactor;

    const tau = len > 0 && slopeFactor > 0 ? ACCEL_TIME : DECEL_TIME;
    const k = 1 - Math.exp(-dt / tau);
    vx += (tx - vx) * k;
    vz += (tz - vz) * k;

    const freeX = pose.x + vx * dt;
    const freeZ = pose.z + vz * dt;
    let nx = freeX;
    let nz = freeZ;
    if (collide) {
      const settled = collide(freeX, freeZ, PLAYER_RADIUS);
      nx = settled.x;
      nz = settled.z;
      const pushX = nx - freeX;
      const pushZ = nz - freeZ;
      const push = Math.hypot(pushX, pushZ);
      if (push > PUSH_EPSILON) {
        const ux = pushX / push;
        const uz = pushZ / push;
        const into = vx * ux + vz * uz;
        if (into < 0) {
          vx -= into * ux;
          vz -= into * uz;
        }
      }
    }
    const nh = heightAt(nx, nz);
    if (nh >= SEA_LEVEL - MAX_WADE_DEPTH) {
      pose.x = nx;
      pose.z = nz;
      player.groundHeight = nh;
    } else {
      vx *= 0.5;
      vz *= 0.5;
      player.groundHeight = here;
    }
    player.speed = Math.hypot(vx, vz);

    const lagK = 1 - Math.exp(-dt / CAMERA_LAG);
    view.x += (pose.x - view.x) * lagK;
    view.z += (pose.z - view.z) * lagK;
    const eyeGround = Math.max(player.groundHeight, SEA_LEVEL - MAX_WADE_DEPTH);
    let targetY = eyeGround + EYE_HEIGHT;
    if (opts.headBob && player.speed > 0.2) {
      bobPhase += dt * player.speed * 2.2;
      targetY += Math.sin(bobPhase) * 0.035;
    }
    view.y += (targetY - view.y) * (1 - Math.exp(-dt / 0.12));
    const lookK = 1 - Math.exp(-dt / 0.06);
    view.yaw += (pose.yaw - view.yaw) * lookK;
    view.pitch += (pose.pitch - view.pitch) * lookK;
  }

  function dispose() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    canvas.removeEventListener('click', onClick);
    document.removeEventListener('pointerlockchange', onLockChange);
    document.removeEventListener('mousemove', onMouseMove);
  }

  return player;
}
