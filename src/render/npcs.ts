import {
  BoxGeometry,
  BufferAttribute,
  DynamicDrawUsage,
  Euler,
  InstancedMesh,
  Matrix4,
  Mesh,
  Scene,
  ShaderMaterial,
  Vector3,
  type Camera,
} from 'three';
import { MATERIAL } from '../config';
import type { NpcSnapshot } from '../npc/types';
import { hash01, seedFromString } from '../world/hash';
import type { GlyphAtlas } from './glyph-atlas';

export interface NpcRenderer {
  update(snapshots: NpcSnapshot[]): void;
  dispose(): void;
}

const TAU = Math.PI * 2;
const HIDE_DISTANCE = 150;
const TELEPORT = 3;
const STILL = 0.0005;
const MAX_STEP = 0.1;
const START_CROWD = 12;
const STACK_DEPTH = 5;
const FACE_GLYPH = 'o';
const LIMB_GLYPH = '|';
const LOOK_SALT = 211;

const HEIGHT_MIN = 1.55;
const HEIGHT_SPAN = 0.35;
const LEG = 0.26;
const PELVIS = 0.06;
const TORSO_TOP = 0.295;
const SHOULDER = 0.275;
const NECK = 0.025;
const HEAD_H = 0.135;
const HEAD_W = 0.11;
const HEAD_D = 0.125;
const UPPER_ARM = 0.17;
const FOREARM = 0.19;
const BOOT_H = 0.065;
const BELT_H = 0.04;
const BELT_Y = 0.035;
const SHAWL_H = 0.085;
const CLOAK_LENGTH = 0.56;
const SEAT_GAP = 0.012;
const SATCHEL_W = 0.16;
const SATCHEL_H = 0.17;
const SATCHEL_D = 0.07;
const BRIM_H = 0.05;

const STAFF_W = 0.05;
const STAFF_EXTRA = 0.22;
const STAFF_SPAN = 0.1;
const CROOK = 0.2;
const CROOK_H = 0.065;
const LANTERN_W = 0.24;
const LANTERN_H = 0.32;
const CAP_W = 0.28;
const CAP_H = 0.05;
const BAIL = 0.05;

const BARE = 0;
const HOOD = 1;
const HAT = 2;

const SKIN_PARTS = 9;
const TRUNK_PARTS = 9;
const STONE_PARTS = 2;

const RISE_RATE = 8;
const FALL_RATE = 5;
const SIT_RATE = 1.8;
const LOOK_RATE = 4;
const GESTURE_RATE = 4;
const TURN_FAST = 8;
const TURN_SLOW = 3;
const HEAD_RATE = 7;
const HEAD_TURN = 0.75;

const KNEE_REST = 0.04;
const KNEE_SWING = 0.7;
const LEG_ROLL = 0.03;
const ELBOW_REST = 0.12;
const ELBOW_SWING = 0.35;
const ARM_ROLL = 0.06;
const WALK_LEAN = 0.05;
const TWIST = 0.07;
const SWAY = 0.02;
const CARRY_PITCH = 0.22;
const CARRY_ELBOW = 1.0;
const CARRY_ROLL = 0.14;
const CARRY_ARM = 0.1;
const STAFF_PITCH = 0.12;
const STAFF_ROLL = 0.08;
const STAFF_ELBOW = 0.85;
const STAFF_ARM = 0.35;
const STAFF_SWAY = 0.06;
const LANTERN_SWING = 0.22;
const LANTERN_ROLL = 0.06;
const CLOAK_FLARE = 0.06;
const CLOAK_WALK = 0.16;

const SEAT_THIGH = 2.2;
const SEAT_KNEE = 1.64;
const SEAT_SPLAY = 0.25;
const SEAT_LEAN = 0.14;
const SEAT_LOOK = -0.2;
const SEAT_ARM_PITCH = 0.55;
const SEAT_ARM_ROLL = 0.12;
const SEAT_ELBOW = 0.9;
const SEAT_CARRY_PITCH = 0.25;
const SEAT_CARRY_ROLL = 0.3;
const SEAT_CARRY_ELBOW = 0.5;
const SEAT_STAFF_PITCH = 0.35;
const SEAT_STAFF_ELBOW = 0.85;
const SEAT_CLOAK = 0.5;

const GESTURE_PITCH = 0.45;
const GESTURE_LIFT = 0.08;
const GESTURE_ROLL = 0.18;
const GESTURE_ELBOW = 1;
const GESTURE_WAVE = 0.3;
const LIFT_SPEED = 1.9;
const WAVE_SPEED = 3.7;
const NOD = 0.05;
const NOD_SPEED = 2.3;
const TILT = 0.07;

interface Body {
  leg: number;
  hip: number;
  seat: number;
  hipX: number;
  legW: number;
  legD: number;
  boot: number;
  torsoW: number;
  torsoD: number;
  torsoH: number;
  torsoY: number;
  top: number;
  beltY: number;
  belt: number;
  shawlH: number;
  shoulderX: number;
  shoulderY: number;
  neck: number;
  headW: number;
  headH: number;
  headD: number;
  armW: number;
  upper: number;
  fore: number;
  cloakLength: number;
  staffLength: number;
  stride: number;
  cycle: number;
  swing: number;
  head: number;
  longHair: boolean;
  brim: number;
  crown: number;
  cloak: boolean;
  satchel: boolean;
  shawl: boolean;
  staff: boolean;
  side: number;
  tilt: number;
  seed: number;
}

interface Entry {
  body: Body;
  torso: Mesh;
  material: ShaderMaterial;
  stamp: number;
  fresh: boolean;
  x: number;
  z: number;
  phase: number;
  moving: number;
  sit: number;
  look: number;
  gesture: number;
  yaw: number;
  headYaw: number;
}

interface Batch {
  mesh: InstancedMesh;
  geometry: BoxGeometry;
  material: ShaderMaterial;
  capacity: number;
  count: number;
}

function tagged(geometry: BoxGeometry, id: number): BoxGeometry {
  const count = geometry.getAttribute('position').count;
  const values = new Float32Array(count);
  values.fill(id);
  geometry.setAttribute('material', new BufferAttribute(values, 1));
  return geometry;
}

function unitBox(id: number): BoxGeometry {
  return tagged(new BoxGeometry(1, 1, 1), id);
}

function glyphIndex(atlas: GlyphAtlas, glyph: string): number {
  const direct = atlas.index.get(glyph);
  if (direct !== undefined) return direct;
  const upper = atlas.index.get(glyph.toUpperCase());
  return upper === undefined ? -1 : upper;
}

function fixedGlyph(atlas: GlyphAtlas, glyph: string): number {
  return atlas.index.get(glyph) ?? atlas.index.get(' ') ?? 0;
}

function withGlyph(base: ShaderMaterial, glyph: number): ShaderMaterial {
  const clone = base.clone();
  const uniforms: Record<string, { value: unknown }> = { ...base.uniforms };
  uniforms.uLetterIndex = { value: glyph };
  clone.uniforms = uniforms;
  return clone;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function wrap(angle: number): number {
  return angle - TAU * Math.round(angle / TAU);
}

function ease(value: number, target: number, rate: number, dt: number): number {
  return value + (target - value) * (1 - Math.exp(-rate * dt));
}

function bodyFor(id: string): Body {
  const key = seedFromString(id);
  const pick = (k: number): number => hash01(key, k, LOOK_SALT);
  const height = HEIGHT_MIN + HEIGHT_SPAN * 0.5 * (pick(1) + pick(2));
  const build = pick(3);
  const torsoW = (0.17 + 0.05 * build) * height;
  const legW = (0.058 + 0.012 * build) * height;
  const armW = (0.045 + 0.01 * build) * height;
  const leg = LEG * height;
  const stride = 0.3 + 0.08 * pick(10);
  const style = pick(4);
  const cloak = pick(5) < 0.35;
  return {
    leg,
    hip: 2 * leg,
    seat: PELVIS * height + SEAT_GAP,
    hipX: torsoW * 0.27,
    legW,
    legD: legW * 1.05,
    boot: BOOT_H * height,
    torsoW,
    torsoD: (0.11 + 0.03 * build) * height,
    torsoH: (TORSO_TOP + PELVIS) * height,
    torsoY: 0.5 * (TORSO_TOP - PELVIS) * height,
    top: TORSO_TOP * height,
    beltY: BELT_Y * height,
    belt: BELT_H * height,
    shawlH: SHAWL_H * height,
    shoulderX: torsoW / 2 + armW / 2 + 0.004,
    shoulderY: SHOULDER * height,
    neck: NECK * height,
    headW: HEAD_W * height,
    headH: HEAD_H * height,
    headD: HEAD_D * height,
    armW,
    upper: UPPER_ARM * height,
    fore: FOREARM * height,
    cloakLength: CLOAK_LENGTH * height,
    staffLength: height + STAFF_EXTRA + STAFF_SPAN * pick(12),
    stride,
    cycle: 8 * leg * Math.sin(stride),
    swing: 0.28 + 0.14 * pick(11),
    head: style < 0.4 ? BARE : style < 0.7 ? HOOD : HAT,
    longHair: pick(13) < 0.4,
    brim: 0.12 + 0.14 * pick(14),
    crown: 0.07 + 0.11 * pick(15),
    cloak,
    satchel: !cloak && pick(6) < 0.4,
    shawl: !cloak && pick(7) < 0.35,
    staff: pick(8) < 0.38,
    side: pick(9) < 0.72 ? 1 : -1,
    tilt: pick(16) < 0.5 ? 1 : -1,
    seed: pick(17) * TAU,
  };
}

export function createNpcRenderer(
  scene: Scene,
  material: ShaderMaterial,
  atlas: GlyphAtlas,
): NpcRenderer {
  const faceMaterial = withGlyph(material, fixedGlyph(atlas, FACE_GLYPH));
  const skinMaterial = withGlyph(material, fixedGlyph(atlas, LIMB_GLYPH));
  const torsoGeometry = unitBox(MATERIAL.FIGURE);
  const entries = new Map<string, Entry>();
  const stack: Matrix4[] = [];
  for (let i = 0; i < STACK_DEPTH; i++) stack.push(new Matrix4());
  const step = new Matrix4();
  const part = new Matrix4();
  const euler = new Euler();
  const viewer = new Vector3();
  const hand = new Vector3();
  const tip = new Vector3();
  let depth = 0;
  let seen = false;
  let stamp = 0;
  let clock = -1;
  let disposed = false;

  const capture = (_renderer: unknown, _scene: unknown, camera: Camera): void => {
    viewer.setFromMatrixPosition(camera.matrixWorld);
    seen = true;
  };

  const spawn = (geometry: BoxGeometry, shared: ShaderMaterial, capacity: number): InstancedMesh => {
    const mesh = new InstancedMesh(geometry, shared, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.onBeforeRender = capture;
    scene.add(mesh);
    return mesh;
  };

  const batch = (id: number, shared: ShaderMaterial, parts: number): Batch => {
    const geometry = unitBox(id);
    const capacity = parts * START_CROWD;
    return { mesh: spawn(geometry, shared, capacity), geometry, material: shared, capacity, count: 0 };
  };

  const skin = batch(MATERIAL.FIGURE, skinMaterial, SKIN_PARTS);
  const face = batch(MATERIAL.FIGURE, faceMaterial, 1);
  const trunk = batch(MATERIAL.TRUNK, material, TRUNK_PARTS);
  const cloth = batch(MATERIAL.TREE, material, 1);
  const stone = batch(MATERIAL.STONE, material, STONE_PARTS);
  const fire = batch(MATERIAL.FIRE, material, 1);
  const batches = [skin, face, trunk, cloth, stone, fire];

  const grow = (target: Batch): void => {
    const capacity = target.capacity * 2;
    const mesh = spawn(target.geometry, target.material, capacity);
    const from = target.mesh.instanceMatrix.array;
    const to = mesh.instanceMatrix.array;
    for (let i = 0; i < target.count * 16; i++) to[i] = from[i];
    scene.remove(target.mesh);
    target.mesh.dispose();
    target.mesh = mesh;
    target.capacity = capacity;
  };

  const reset = (x: number, y: number, z: number, yaw: number): void => {
    depth = 0;
    stack[0].makeRotationY(yaw).setPosition(x, y, z);
  };

  const push = (): void => {
    stack[depth + 1].copy(stack[depth]);
    depth++;
  };

  const pop = (): void => {
    depth--;
  };

  const move = (x: number, y: number, z: number): void => {
    stack[depth].multiply(step.makeTranslation(x, y, z));
  };

  const turn = (yaw: number, roll: number, pitch: number): void => {
    euler.set(pitch, yaw, roll, 'YZX');
    stack[depth].multiply(step.makeRotationFromEuler(euler));
  };

  const place = (x: number, y: number, z: number, sx: number, sy: number, sz: number): Matrix4 => {
    return part.makeScale(sx, sy, sz).setPosition(x, y, z).premultiply(stack[depth]);
  };

  const box = (target: Batch, x: number, y: number, z: number, sx: number, sy: number, sz: number): void => {
    if (target.count === target.capacity) grow(target);
    place(x, y, z, sx, sy, sz).toArray(target.mesh.instanceMatrix.array, target.count * 16);
    target.count++;
  };

  const shape = (mesh: Mesh, x: number, y: number, z: number, sx: number, sy: number, sz: number): void => {
    mesh.matrix.copy(place(x, y, z, sx, sy, sz));
    mesh.matrixWorldNeedsUpdate = true;
  };

  const mark = (out: Vector3, x: number, y: number, z: number): void => {
    out.set(x, y, z).applyMatrix4(stack[depth]);
  };

  const legs = (b: Body, hip: number, sin: number, cos: number, w: number, s: number): void => {
    for (let k = 0; k < 2; k++) {
      const sx = k === 0 ? 1 : -1;
      const cap = b.legD * 0.5;
      push();
      move(sx * b.hipX, hip, 0);
      turn(sx * SEAT_SPLAY * s, sx * LEG_ROLL * (1 - s), mix(b.stride * sx * sin * w, SEAT_THIGH, s));
      box(skin, 0, -b.leg / 2, 0, b.legW, b.leg, b.legD);
      move(0, -b.leg, 0);
      turn(0, 0, -mix(KNEE_REST + KNEE_SWING * Math.max(0, sx * cos) * w, SEAT_KNEE, s));
      box(skin, 0, (cap - b.leg) / 2, 0, b.legW * 0.94, b.leg + cap, b.legD * 0.94);
      box(trunk, 0, b.boot / 2 - b.leg - 0.005, -0.025, b.legW + 0.024, b.boot, b.legD + 0.07);
      pop();
    }
  };

  const cloak = (b: Body, hip: number, w: number, s: number): void => {
    const flare = mix(CLOAK_FLARE + CLOAK_WALK * w, SEAT_CLOAK, s);
    const reach = (hip + b.shoulderY - 0.03) / Math.max(0.3, Math.cos(flare));
    const length = Math.min(b.cloakLength, reach);
    push();
    move(0, b.shoulderY + 0.01, b.torsoD / 2 + 0.004);
    turn(0, 0, -flare);
    box(cloth, 0, -length / 2, 0.011, b.torsoW + 0.02, length, 0.022);
    pop();
  };

  const head = (entry: Entry, s: number, time: number): void => {
    const b = entry.body;
    const nod = NOD * entry.gesture * Math.sin(time * NOD_SPEED + b.seed);
    push();
    move(0, b.top, 0);
    box(skin, 0, b.neck / 2, 0, b.headW * 0.45, b.neck + 0.03, b.headW * 0.45);
    move(0, b.neck, 0);
    turn(entry.headYaw, TILT * b.tilt * entry.look, mix(0, SEAT_LOOK, s) + nod);
    box(face, 0, b.headH / 2, -0.005, b.headW, b.headH, b.headD);
    if (b.head === HOOD) {
      box(trunk, 0, b.headH / 2 + 0.02, 0.03, b.headW + 0.05, b.headH + 0.06, b.headD + 0.05);
    } else {
      if (b.head === HAT) {
        box(trunk, 0, b.headH * 0.86, 0, b.headW + b.brim, BRIM_H, b.headD + b.brim);
        box(trunk, 0, b.headH * 0.86 + b.crown / 2, 0, b.headW + 0.015, b.crown, b.headD + 0.015);
      } else {
        box(trunk, 0, b.headH * 0.8, 0.003, b.headW + 0.02, b.headH * 0.45, b.headD + 0.03);
      }
      const back = b.longHair ? b.headH * 1.35 : b.headH * 0.85;
      box(trunk, 0, b.headH + 0.01 - back / 2, b.headD / 2 + 0.01, b.headW + 0.01, back, 0.03);
    }
    pop();
  };

  const arm = (b: Body, sx: number, pitch: number, roll: number, elbow: number): void => {
    const cap = b.armW * 0.5;
    push();
    move(sx * b.shoulderX, b.shoulderY, 0);
    turn(0, sx * roll, pitch);
    box(skin, 0, -b.upper / 2, 0, b.armW, b.upper, b.armW);
    move(0, -b.upper, 0);
    turn(0, 0, elbow);
    box(skin, 0, (cap - b.fore) / 2, 0, b.armW * 0.92, b.fore + cap, b.armW * 0.92);
    if (sx === b.side) mark(hand, 0, -b.fore, 0);
    pop();
  };

  const arms = (entry: Entry, sin: number, w: number, s: number, time: number): void => {
    const b = entry.body;
    const g = entry.gesture;
    for (let k = 0; k < 2; k++) {
      const sx = k === 0 ? 1 : -1;
      const free = -b.swing * sx * sin * w;
      if (sx !== b.side) {
        const lift = GESTURE_PITCH + GESTURE_LIFT * Math.sin(time * LIFT_SPEED + b.seed);
        const wave = GESTURE_ELBOW + GESTURE_WAVE * Math.sin(time * WAVE_SPEED + b.seed);
        const bend = ELBOW_REST + ELBOW_SWING * Math.max(0, free);
        arm(
          b,
          sx,
          mix(mix(free, SEAT_ARM_PITCH, s), lift, g),
          mix(mix(ARM_ROLL, SEAT_ARM_ROLL, s), GESTURE_ROLL, g),
          mix(mix(bend, SEAT_ELBOW, s), wave, g),
        );
      } else if (b.staff) {
        arm(
          b,
          sx,
          mix(STAFF_PITCH + STAFF_ARM * free, SEAT_STAFF_PITCH, s),
          STAFF_ROLL,
          mix(STAFF_ELBOW, SEAT_STAFF_ELBOW, s),
        );
      } else {
        arm(
          b,
          sx,
          mix(CARRY_PITCH + CARRY_ARM * free, SEAT_CARRY_PITCH, s),
          mix(CARRY_ROLL, SEAT_CARRY_ROLL, s),
          mix(CARRY_ELBOW, SEAT_CARRY_ELBOW, s),
        );
      }
    }
  };

  const upperBody = (
    entry: Entry,
    hip: number,
    sin: number,
    cos: number,
    w: number,
    s: number,
    time: number,
  ): void => {
    const b = entry.body;
    push();
    move(0, hip, 0);
    turn(-TWIST * sin * w, SWAY * cos * w, -mix(WALK_LEAN * w, SEAT_LEAN, s));
    shape(entry.torso, 0, b.torsoY, 0, b.torsoW, b.torsoH, b.torsoD);
    box(trunk, 0, b.beltY, 0, b.torsoW + 0.02, b.belt, b.torsoD + 0.02);
    if (b.shawl) {
      const wide = b.torsoW + 2 * b.armW + 0.03;
      box(stone, 0, b.top + 0.012 - b.shawlH / 2, 0, wide, b.shawlH, b.torsoD + 0.045);
    }
    if (b.satchel) {
      const x = -b.side * (b.torsoW / 2 - 0.07);
      box(stone, x, b.beltY - 0.04, b.torsoD / 2 + 0.03, SATCHEL_W, SATCHEL_H, SATCHEL_D);
    }
    if (b.cloak) cloak(b, hip, w, s);
    head(entry, s, time);
    arms(entry, sin, w, s, time);
    pop();
  };

  const lantern = (at: Vector3, ground: number, yaw: number, swing: number, sway: number): void => {
    const drop = Math.min(BAIL, at.y - ground - CAP_H - LANTERN_H - 0.01);
    reset(at.x, at.y, at.z, yaw);
    turn(0, sway, swing);
    box(trunk, 0, -drop - CAP_H / 2, 0, CAP_W, CAP_H, CAP_W);
    box(fire, 0, -drop - CAP_H - LANTERN_H / 2, 0, LANTERN_W, LANTERN_H, LANTERN_W);
  };

  const carry = (entry: Entry, ground: number, sin: number, cos: number, w: number): void => {
    const b = entry.body;
    const swing = -LANTERN_SWING * cos * w;
    const sway = LANTERN_ROLL * sin * w;
    if (!b.staff) {
      lantern(hand, ground, entry.yaw, swing, sway);
      return;
    }
    const grip = hand.y - ground;
    reset(hand.x, hand.y, hand.z, entry.yaw);
    turn(0, 0, STAFF_SWAY * sin * w);
    box(trunk, 0, b.staffLength / 2 - grip, 0, STAFF_W, b.staffLength, STAFF_W);
    move(0, b.staffLength - grip, 0);
    box(trunk, (b.side * (CROOK - STAFF_W)) / 2, 0, 0, CROOK, CROOK_H, STAFF_W);
    mark(tip, b.side * (CROOK - STAFF_W), -CROOK_H / 2, 0);
    lantern(tip, ground, entry.yaw, swing * 0.6, sway);
  };

  const draw = (entry: Entry, snapshot: NpcSnapshot, time: number): void => {
    const b = entry.body;
    const s = entry.sit;
    const w = entry.moving * (1 - s);
    const sin = Math.sin(entry.phase);
    const cos = Math.cos(entry.phase);
    const hip = mix(b.hip * Math.cos(b.stride * sin * w), b.seat, s);
    reset(snapshot.x, snapshot.y, snapshot.z, entry.yaw);
    legs(b, hip, sin, cos, w, s);
    upperBody(entry, hip, sin, cos, w, s, time);
    carry(entry, snapshot.y, sin, cos, w);
  };

  const animate = (entry: Entry, snapshot: NpcSnapshot, dt: number): void => {
    const dx = snapshot.x - entry.x;
    const dz = snapshot.z - entry.z;
    const resting = snapshot.state === 'rest';
    const facing = snapshot.state === 'talk' || snapshot.state === 'approach';
    let moved = Math.sqrt(dx * dx + dz * dz);
    entry.x = snapshot.x;
    entry.z = snapshot.z;
    if (entry.fresh || moved > TELEPORT) {
      entry.fresh = false;
      entry.moving = 0;
      entry.sit = resting ? 1 : 0;
      entry.look = 0;
      entry.gesture = 0;
      entry.yaw = snapshot.yaw;
      entry.headYaw = 0;
      moved = 0;
    }
    const walking = moved > STILL;
    entry.phase = (entry.phase + (moved / entry.body.cycle) * TAU) % TAU;
    entry.moving = ease(entry.moving, walking ? 1 : 0, walking ? RISE_RATE : FALL_RATE, dt);
    entry.sit = ease(entry.sit, resting ? 1 : 0, SIT_RATE, dt);
    entry.look = ease(entry.look, facing ? 1 : 0, LOOK_RATE, dt);
    entry.gesture = ease(entry.gesture, snapshot.speaking !== null ? 1 : 0, GESTURE_RATE, dt);
    const turnRate = facing ? TURN_SLOW : TURN_FAST;
    entry.yaw = wrap(entry.yaw + wrap(snapshot.yaw - entry.yaw) * (1 - Math.exp(-turnRate * dt)));
    const lead = Math.max(-HEAD_TURN, Math.min(HEAD_TURN, wrap(snapshot.yaw - entry.yaw)));
    entry.headYaw = ease(entry.headYaw, lead * entry.look, HEAD_RATE, dt);
  };

  const far = (snapshot: NpcSnapshot): boolean => {
    if (!seen) return false;
    const dx = snapshot.x - viewer.x;
    const dz = snapshot.z - viewer.z;
    return dx * dx + dz * dz > HIDE_DISTANCE * HIDE_DISTANCE;
  };

  const create = (snapshot: NpcSnapshot): Entry => {
    const letter = withGlyph(material, glyphIndex(atlas, snapshot.glyph));
    const torso = new Mesh(torsoGeometry, letter);
    torso.matrixAutoUpdate = false;
    scene.add(torso);
    return {
      body: bodyFor(snapshot.id),
      torso,
      material: letter,
      stamp,
      fresh: true,
      x: snapshot.x,
      z: snapshot.z,
      phase: 0,
      moving: 0,
      sit: 0,
      look: 0,
      gesture: 0,
      yaw: snapshot.yaw,
      headYaw: 0,
    };
  };

  const drop = (entry: Entry): void => {
    scene.remove(entry.torso);
    entry.material.dispose();
  };

  const sweep = (entry: Entry, id: string): void => {
    if (entry.stamp === stamp) return;
    drop(entry);
    entries.delete(id);
  };

  const update = (snapshots: NpcSnapshot[]): void => {
    if (disposed) return;
    stamp++;
    const now = performance.now() / 1000;
    const dt = clock < 0 ? 0 : Math.min(MAX_STEP, Math.max(0, now - clock));
    clock = now;
    for (let i = 0; i < batches.length; i++) batches[i].count = 0;
    for (let i = 0; i < snapshots.length; i++) {
      const snapshot = snapshots[i];
      let entry = entries.get(snapshot.id);
      if (entry === undefined) {
        entry = create(snapshot);
        entries.set(snapshot.id, entry);
      }
      entry.stamp = stamp;
      if (far(snapshot)) {
        entry.torso.visible = false;
        entry.fresh = true;
        entry.x = snapshot.x;
        entry.z = snapshot.z;
        continue;
      }
      entry.torso.visible = true;
      animate(entry, snapshot, dt);
      draw(entry, snapshot, now);
    }
    entries.forEach(sweep);
    for (let i = 0; i < batches.length; i++) {
      const target = batches[i];
      target.mesh.count = target.count;
      if (target.count > 0) target.mesh.instanceMatrix.needsUpdate = true;
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    entries.forEach(drop);
    entries.clear();
    for (let i = 0; i < batches.length; i++) {
      const target = batches[i];
      scene.remove(target.mesh);
      target.mesh.dispose();
      target.geometry.dispose();
    }
    torsoGeometry.dispose();
    faceMaterial.dispose();
    skinMaterial.dispose();
  };

  return { update, dispose };
}
