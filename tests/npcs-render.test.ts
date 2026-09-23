import { InstancedMesh, Matrix4, Mesh, PerspectiveCamera, ShaderMaterial } from 'three';
import type { Camera, Object3D, Scene } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MATERIAL } from '../src/config';
import type { NpcSnapshot, NpcState } from '../src/npc/types';
import type { GlyphAtlas } from '../src/render/glyph-atlas';
import { createNpcRenderer, type NpcRenderer } from '../src/render/npcs';

const GLYPHS = ' .|oabcdefghijklmnopqrstuvwxyz';
const ATLAS = {
  index: new Map(Array.from(GLYPHS, (glyph, i): [string, number] => [glyph, i])),
} as unknown as GlyphAtlas;
const FRAME_MS = 1000 / 60;
const GROUND = 4;
const SKIN_PER_VILLAGER = 9;
const KINDS = ['skin', 'face', 'trunk', 'cloak', 'stone', 'fire'] as const;

type Kind = (typeof KINDS)[number];
type Counts = Record<Kind, number>;
type Hook = (renderer: unknown, scene: unknown, camera: Camera) => void;

class FakeScene {
  readonly children = new Set<Object3D>();
  added = 0;
  removed = 0;

  add(object: Object3D): this {
    this.children.add(object);
    this.added++;
    return this;
  }

  remove(object: Object3D): this {
    if (this.children.delete(object)) this.removed++;
    return this;
  }
}

let clock = 0;

beforeEach(() => {
  clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function terrainMaterial(): ShaderMaterial {
  return new ShaderMaterial({ uniforms: { uLetterIndex: { value: -1 }, uTime: { value: 0 } } });
}

function build(scene: FakeScene, material = terrainMaterial()): NpcRenderer {
  return createNpcRenderer(scene as unknown as Scene, material, ATLAS);
}

function villager(
  id: string,
  glyph: string,
  state: NpcState,
  x: number,
  z: number,
  speaking: string | null = null,
): NpcSnapshot {
  return { id, name: glyph.toUpperCase() + 'ela', glyph, x, y: GROUND, z, yaw: 0, state, speaking };
}

function frame(renderer: NpcRenderer, snapshots: NpcSnapshot[]): void {
  clock += FRAME_MS;
  renderer.update(snapshots);
}

function instanced(scene: FakeScene): InstancedMesh[] {
  return Array.from(scene.children).filter((child): child is InstancedMesh => child instanceof InstancedMesh);
}

function torsos(scene: FakeScene): Mesh[] {
  return Array.from(scene.children).filter(
    (child): child is Mesh => child instanceof Mesh && !(child instanceof InstancedMesh),
  );
}

function letterOf(mesh: Mesh): number {
  return (mesh.material as ShaderMaterial).uniforms.uLetterIndex.value as number;
}

function kindOf(mesh: InstancedMesh): Kind {
  const id = mesh.geometry.getAttribute('material').getX(0);
  if (id === MATERIAL.FIGURE) return letterOf(mesh) === ATLAS.index.get('o') ? 'face' : 'skin';
  if (id === MATERIAL.TRUNK) return 'trunk';
  if (id === MATERIAL.TREE) return 'cloak';
  if (id === MATERIAL.STONE) return 'stone';
  if (id === MATERIAL.FIRE) return 'fire';
  throw new Error('unexpected material ' + id);
}

function meshOf(scene: FakeScene, kind: Kind): InstancedMesh {
  const found = instanced(scene).find((mesh) => kindOf(mesh) === kind);
  if (found === undefined) throw new Error('no ' + kind + ' mesh');
  return found;
}

function counts(scene: FakeScene): Counts {
  const out: Counts = { skin: 0, face: 0, trunk: 0, cloak: 0, stone: 0, fire: 0 };
  for (const mesh of instanced(scene)) out[kindOf(mesh)] += mesh.count;
  return out;
}

function torsoOf(scene: FakeScene, glyph: string): Mesh {
  const found = torsos(scene).find((mesh) => letterOf(mesh) === ATLAS.index.get(glyph));
  if (found === undefined) throw new Error('no torso for ' + glyph);
  return found;
}

function heights(mesh: InstancedMesh, from: number, to: number): number[] {
  const matrix = new Matrix4();
  const out: number[] = [];
  for (let i = from; i < to; i++) out.push(mesh.getMatrixAt(i, matrix).elements[13]);
  return out;
}

function spread(samples: number[][]): number {
  let widest = 0;
  for (let part = 0; part < samples[0].length; part++) {
    const column = samples.map((row) => row[part]);
    widest = Math.max(widest, Math.max(...column) - Math.min(...column));
  }
  return widest;
}

function look(scene: FakeScene, x: number, z: number): void {
  const camera = new PerspectiveCamera();
  camera.position.set(x, GROUND + 1.6, z);
  camera.updateMatrixWorld();
  for (const mesh of instanced(scene)) (mesh.onBeforeRender as unknown as Hook).call(mesh, null, null, camera);
}

describe('npc renderer', () => {
  it('draws one lettered torso per villager and every other part through six shared instanced meshes', () => {
    const scene = new FakeScene();
    const material = terrainMaterial();
    const renderer = build(scene, material);
    expect(instanced(scene)).toHaveLength(6);
    expect(new Set(instanced(scene).map(kindOf))).toEqual(new Set(KINDS));
    expect(torsos(scene)).toHaveLength(0);
    for (const mesh of instanced(scene)) {
      const kind = kindOf(mesh);
      if (kind === 'skin' || kind === 'face') expect(mesh.material).not.toBe(material);
      else expect(mesh.material).toBe(material);
    }
    expect(letterOf(meshOf(scene, 'skin'))).toBe(ATLAS.index.get('|'));

    const crowd = [
      villager('0,0:0', 'k', 'idle', 0, 0),
      villager('1,0:0', 'm', 'wander', 3, 0),
      villager('2,3:1', 't', 'talk', -3, 0, 'the fire is warm'),
    ];
    const solo = crowd.map((one) => {
      frame(renderer, [one]);
      expect(torsos(scene)).toHaveLength(1);
      return counts(scene);
    });
    for (const parts of solo) {
      expect(parts.skin).toBe(SKIN_PER_VILLAGER);
      expect(parts.face).toBe(1);
      expect(parts.fire).toBe(1);
      expect(parts.trunk).toBeGreaterThanOrEqual(5);
      expect(parts.trunk).toBeLessThanOrEqual(9);
      expect(parts.cloak).toBeLessThanOrEqual(1);
      expect(parts.stone).toBeLessThanOrEqual(2);
    }

    frame(renderer, crowd);
    const together = counts(scene);
    for (const kind of KINDS) {
      expect(together[kind]).toBe(solo.reduce((sum, parts) => sum + parts[kind], 0));
    }
    const bodies = torsos(scene);
    expect(bodies).toHaveLength(3);
    expect(bodies.map(letterOf).sort()).toEqual(['k', 'm', 't'].map((glyph) => ATLAS.index.get(glyph)).sort());
    expect(new Set(bodies.map((body) => body.material)).size).toBe(3);
    for (const body of bodies) expect(body.material).not.toBe(material);

    const town: NpcSnapshot[] = [];
    for (let i = 0; i < 30; i++) town.push(villager(`${i},9:${i % 3}`, GLYPHS[4 + (i % 26)], 'idle', i * 2, 0));
    frame(renderer, town);
    expect(instanced(scene)).toHaveLength(6);
    expect(torsos(scene)).toHaveLength(30);
    expect(counts(scene).skin).toBe(30 * SKIN_PER_VILLAGER);
    expect(counts(scene).face).toBe(30);
    expect(counts(scene).fire).toBe(30);
    for (const mesh of instanced(scene)) expect(mesh.count).toBeLessThanOrEqual(mesh.instanceMatrix.count);
    const last = meshOf(scene, 'fire').getMatrixAt(29, new Matrix4()).elements[12];
    expect(Math.abs(last - town[29].x)).toBeLessThan(1);
    renderer.dispose();
  });

  it('varies height, dress and how the lantern is carried by id', () => {
    const scene = new FakeScene();
    const renderer = build(scene);
    const tall = new Set<number>();
    const lanterns: number[] = [];
    const cloaks: number[] = [];
    const matrix = new Matrix4();
    for (let i = 0; i < 40; i++) {
      frame(renderer, [villager(`${i},${-i}:0`, 'a', 'idle', 0, 0)]);
      tall.add(Math.round(torsoOf(scene, 'a').matrix.elements[5] * 1000));
      lanterns.push(meshOf(scene, 'fire').getMatrixAt(0, matrix).elements[13] - GROUND);
      cloaks.push(counts(scene).cloak);
    }
    expect(tall.size).toBeGreaterThan(30);
    expect(lanterns.some((y) => y > 1.4)).toBe(true);
    expect(lanterns.some((y) => y < 0.8)).toBe(true);
    expect(cloaks).toContain(0);
    expect(cloaks).toContain(1);
    renderer.dispose();
  });

  it('walks, sits by the fire and gestures while speaking', () => {
    const scene = new FakeScene();
    const renderer = build(scene);
    const talk = 'the fire is warm tonight';
    const walkerAt = (f: number): NpcSnapshot => villager('0,0:0', 'k', 'wander', 0, -f * 0.02);
    const sitter = villager('1,0:0', 'm', 'rest', 6, 0);
    const talker = villager('2,3:1', 't', 'talk', -6, 0, talk);
    const walker: number[][] = [];
    const resting: number[][] = [];
    const speaking: number[][] = [];
    const bob: number[] = [];
    for (let f = 0; f < 150; f++) {
      frame(renderer, [walkerAt(f), sitter, talker]);
      if (f < 90) continue;
      const skin = meshOf(scene, 'skin');
      walker.push(heights(skin, 0, SKIN_PER_VILLAGER));
      resting.push(heights(skin, SKIN_PER_VILLAGER, 2 * SKIN_PER_VILLAGER));
      speaking.push(heights(skin, 2 * SKIN_PER_VILLAGER, 3 * SKIN_PER_VILLAGER));
      bob.push(torsoOf(scene, 'k').matrix.elements[13]);
    }
    expect(spread(walker)).toBeGreaterThan(0.03);
    expect(Math.max(...bob) - Math.min(...bob)).toBeGreaterThan(0.01);
    expect(spread(resting)).toBe(0);
    expect(spread(speaking)).toBeGreaterThan(0.01);

    const standing = torsoOf(scene, 'k').matrix.elements[13] - GROUND;
    const seated = torsoOf(scene, 'm').matrix.elements[13] - GROUND;
    const talking = torsoOf(scene, 't').matrix.elements[13] - GROUND;
    expect(seated).toBeLessThan(standing - 0.4);
    expect(seated).toBeLessThan(talking - 0.4);

    const quiet = villager('2,3:1', 't', 'idle', -6, 0);
    for (let f = 0; f < 240; f++) frame(renderer, [quiet]);
    const still: number[][] = [];
    for (let f = 0; f < 30; f++) {
      frame(renderer, [quiet]);
      still.push(heights(meshOf(scene, 'skin'), 0, SKIN_PER_VILLAGER));
    }
    expect(spread(still)).toBeLessThan(0.002);
    renderer.dispose();
  });

  it('hides villagers beyond 150 m, drops the ones who leave and disposes everything', () => {
    const scene = new FakeScene();
    const material = terrainMaterial();
    const renderer = build(scene, material);
    const crowd = [villager('0,0:0', 'k', 'idle', 0, 0), villager('1,0:0', 'm', 'idle', 5, 0)];

    frame(renderer, crowd);
    look(scene, 0, 20);
    frame(renderer, crowd);
    expect(counts(scene).fire).toBe(2);
    expect(torsos(scene).every((torso) => torso.visible)).toBe(true);

    look(scene, 1000, 0);
    frame(renderer, crowd);
    expect(counts(scene)).toEqual({ skin: 0, face: 0, trunk: 0, cloak: 0, stone: 0, fire: 0 });
    expect(torsos(scene)).toHaveLength(2);
    expect(torsos(scene).some((torso) => torso.visible)).toBe(false);

    look(scene, 0, 20);
    frame(renderer, crowd);
    expect(counts(scene).fire).toBe(2);
    expect(torsos(scene).every((torso) => torso.visible)).toBe(true);

    let letters = 0;
    for (const torso of torsos(scene)) {
      (torso.material as ShaderMaterial).addEventListener('dispose', () => letters++);
    }
    frame(renderer, [crowd[1]]);
    expect(torsos(scene)).toHaveLength(1);
    expect(letters).toBe(1);
    expect(counts(scene).fire).toBe(1);
    frame(renderer, []);
    expect(torsos(scene)).toHaveLength(0);
    expect(letters).toBe(2);
    expect(counts(scene).fire).toBe(0);
    expect(instanced(scene)).toHaveLength(6);

    let meshes = 0;
    let geometries = 0;
    let clones = 0;
    let shared = 0;
    material.addEventListener('dispose', () => shared++);
    for (const mesh of instanced(scene)) {
      mesh.addEventListener('dispose', () => meshes++);
      mesh.geometry.addEventListener('dispose', () => geometries++);
      if (mesh.material !== material) (mesh.material as ShaderMaterial).addEventListener('dispose', () => clones++);
    }
    renderer.dispose();
    expect(scene.children.size).toBe(0);
    expect(scene.added).toBe(scene.removed);
    expect(meshes).toBe(6);
    expect(geometries).toBe(6);
    expect(clones).toBe(2);
    expect(shared).toBe(0);
  });
});
