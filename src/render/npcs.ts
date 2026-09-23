import { BoxGeometry, BufferAttribute, Mesh, Scene, ShaderMaterial } from 'three';
import { MATERIAL } from '../config';
import type { NpcSnapshot } from '../npc/types';
import type { GlyphAtlas } from './glyph-atlas';

export interface NpcRenderer {
  update(snapshots: NpcSnapshot[]): void;
  dispose(): void;
}

const FIGURE_W = 0.5;
const FIGURE_H = 1.8;
const FIGURE_D = 0.35;
const FIGURE_LIFT = 0.85;
const FIGURE_MATERIAL = MATERIAL.FIGURE;
const LANTERN_W = 0.26;
const LANTERN_H = 0.34;
const LANTERN_LIFT = 0.35;
const LANTERN_SIDE = 0.34;

function tagged(geometry: BoxGeometry, id: number): BoxGeometry {
  const count = geometry.getAttribute('position').count;
  const values = new Float32Array(count);
  values.fill(id);
  geometry.setAttribute('material', new BufferAttribute(values, 1));
  return geometry;
}

function figureGeometry(): BoxGeometry {
  return tagged(new BoxGeometry(FIGURE_W, FIGURE_H, FIGURE_D), FIGURE_MATERIAL);
}

function lanternGeometry(): BoxGeometry {
  return tagged(new BoxGeometry(LANTERN_W, LANTERN_H, LANTERN_W), MATERIAL.FIRE);
}

function glyphIndex(atlas: GlyphAtlas, glyph: string): number {
  const direct = atlas.index.get(glyph);
  if (direct !== undefined) return direct;
  const upper = atlas.index.get(glyph.toUpperCase());
  return upper === undefined ? -1 : upper;
}

function withGlyph(base: ShaderMaterial, glyph: number): ShaderMaterial {
  const clone = base.clone();
  const uniforms: Record<string, { value: unknown }> = { ...base.uniforms };
  uniforms.uLetterIndex = { value: glyph };
  clone.uniforms = uniforms;
  return clone;
}

interface Entry {
  mesh: Mesh;
  lamp: Mesh;
  material: ShaderMaterial;
  stamp: number;
}

export function createNpcRenderer(
  scene: Scene,
  material: ShaderMaterial,
  atlas: GlyphAtlas,
): NpcRenderer {
  const geometry = figureGeometry();
  const lantern = lanternGeometry();
  const entries = new Map<string, Entry>();
  let stamp = 0;

  const drop = (entry: Entry): void => {
    scene.remove(entry.mesh);
    scene.remove(entry.lamp);
    entry.material.dispose();
  };

  const sweep = (entry: Entry, id: string): void => {
    if (entry.stamp === stamp) return;
    drop(entry);
    entries.delete(id);
  };

  const create = (snapshot: NpcSnapshot): Entry => {
    const figureMaterial = withGlyph(material, glyphIndex(atlas, snapshot.glyph));
    const mesh = new Mesh(geometry, figureMaterial);
    mesh.matrixAutoUpdate = false;
    mesh.rotation.order = 'YXZ';
    scene.add(mesh);
    const lamp = new Mesh(lantern, material);
    lamp.matrixAutoUpdate = false;
    scene.add(lamp);
    return { mesh, lamp, material: figureMaterial, stamp };
  };

  const update = (snapshots: NpcSnapshot[]): void => {
    stamp++;
    for (let i = 0; i < snapshots.length; i++) {
      const snapshot = snapshots[i];
      let entry = entries.get(snapshot.id);
      if (entry === undefined) {
        entry = create(snapshot);
        entries.set(snapshot.id, entry);
      }
      entry.stamp = stamp;
      const mesh = entry.mesh;
      mesh.position.set(snapshot.x, snapshot.y + FIGURE_LIFT, snapshot.z);
      mesh.rotation.y = snapshot.yaw;
      mesh.updateMatrix();
      const lamp = entry.lamp;
      lamp.position.set(
        snapshot.x + Math.cos(snapshot.yaw) * LANTERN_SIDE,
        snapshot.y + FIGURE_LIFT + LANTERN_LIFT,
        snapshot.z - Math.sin(snapshot.yaw) * LANTERN_SIDE,
      );
      lamp.updateMatrix();
    }
    entries.forEach(sweep);
  };

  const dispose = (): void => {
    entries.forEach(drop);
    entries.clear();
    geometry.dispose();
    lantern.dispose();
  };

  return { update, dispose };
}
