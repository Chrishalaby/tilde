import { InstancedMesh, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { MATERIAL, PROP } from '../src/config';
import type { GlyphAtlas } from '../src/render/glyph-atlas';
import { buildProps } from '../src/render/props';
import {
  CASTLE,
  STRUCTURE_REACH,
  castleGate,
  castleRuin,
  castleTurn,
  landmarkLayout,
  treeSolidRadius,
  treeTrunkRadius,
  treeVariant,
} from '../src/world/structures';
import type { Ground, Layout, Part } from '../src/world/structures';
import { generateChunk } from '../src/world/chunk-gen';
import { landmarkForRegion } from '../src/world/landmarks';
import { createSampler } from '../src/world/sampler';
import type { ChunkData, Landmark, LandmarkKind } from '../src/world/types';

declare const process: { stdout: { write(text: string): void } };

const KINDS: LandmarkKind[] = ['letter', 'castle', 'ring', 'tree', 'pool', 'shelter'];
const ATLAS = { index: new Map<string, number>([['Q', 7]]) } as unknown as GlyphAtlas;

function mark(kind: LandmarkKind, x: number, z: number, y = 12): Landmark {
  return { kind, letter: kind === 'letter' ? 'Q' : null, x, z, y, regionKey: `${x},${z}` };
}

function castles(): Landmark[] {
  const out: Landmark[] = [];
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) out.push(mark('castle', 156 + 25 * i + 512 * j, 356 + 25 * j));
  return out;
}

function slope(m: Landmark): Ground {
  return (x, z) => m.y + 0.16 * (x - m.x) - 0.09 * (z - m.z) + 0.4 * Math.sin(x * 0.7) * Math.cos(z * 0.5);
}

function corners(p: Part): Array<[number, number]> {
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  const hx = Math.abs((p.sx / 2) * Math.cos(p.tilt)) + Math.abs((p.sy / 2) * Math.sin(p.tilt));
  const hz = p.sz / 2;
  const out: Array<[number, number]> = [];
  for (const [u, v] of [[hx, hz], [hx, -hz], [-hx, hz], [-hx, -hz]]) out.push([p.x + c * u + s * v, p.z - s * u + c * v]);
  return out;
}

function reach(p: Part, m: Landmark): number {
  if (p.shape === 'box' || p.shape === 'gable') {
    let best = 0;
    for (const [x, z] of corners(p)) best = Math.max(best, Math.hypot(x - m.x, z - m.z));
    return best;
  }
  return Math.hypot(p.x - m.x, p.z - m.z) + Math.max(p.sx, p.sz) / 2;
}

function footprint(p: Part): Array<[number, number]> {
  if (p.shape === 'box' || p.shape === 'gable') {
    const ring = corners(p);
    const order = [0, 1, 3, 2];
    const out: Array<[number, number]> = [];
    for (let e = 0; e < 4; e++) {
      const [ax, az] = ring[order[e]];
      const [bx, bz] = ring[order[(e + 1) % 4]];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25));
      for (let k = 0; k < steps; k++) out.push([ax + ((bx - ax) * k) / steps, az + ((bz - az) * k) / steps]);
    }
    return out;
  }
  const r = Math.max(p.sx, p.sz) / 2;
  const out: Array<[number, number]> = [[p.x, p.z]];
  for (let k = 0; k < 16; k++) out.push([p.x + Math.cos((k / 16) * Math.PI * 2) * r, p.z + Math.sin((k / 16) * Math.PI * 2) * r]);
  return out;
}

function top(p: Part): number {
  return p.y + p.sy / 2;
}

function bottom(p: Part): number {
  return p.y - p.sy / 2;
}

function roles(layout: Layout, role: string): Part[] {
  return layout.parts.filter((p) => p.role === role);
}

describe('structures', () => {
  it('lays out every landmark kind the same way twice', () => {
    for (const kind of KINDS) {
      for (let k = 0; k < 12; k++) {
        const m = mark(kind, 180 + 512 * k + 25 * (k % 5), 300 - 512 * k);
        const a = landmarkLayout(m, slope(m));
        const b = landmarkLayout(m, slope(m));
        expect(a.parts.length).toBeGreaterThan(0);
        expect(b).toEqual(a);
      }
    }
  });

  it('never lets the ground move a footprint, so ruins collide as they render', () => {
    for (const m of castles().slice(0, 120)) {
      const flat = landmarkLayout(m, () => m.y);
      const hilly = landmarkLayout(m, slope(m));
      expect(hilly.parts.length).toBe(flat.parts.length);
      for (let i = 0; i < flat.parts.length; i++) {
        const a = flat.parts[i];
        const b = hilly.parts[i];
        expect([b.role, b.shape, b.material, b.blocks]).toEqual([a.role, a.shape, a.material, a.blocks]);
        expect(b.x).toBe(a.x);
        expect(b.z).toBe(a.z);
        expect(b.sx).toBe(a.sx);
        expect(b.sz).toBe(a.sz);
        expect(b.yaw).toBe(a.yaw);
      }
    }
  });

  it('keeps every castle part within 19 m of the landmark point', () => {
    let worst = 0;
    for (const m of castles()) {
      for (const p of landmarkLayout(m, slope(m)).parts) worst = Math.max(worst, reach(p, m));
    }
    process.stdout.write(`castle reach over 400 castles: ${worst.toFixed(2)} m (limit ${STRUCTURE_REACH} m)\n`);
    expect(worst).toBeLessThanOrEqual(STRUCTURE_REACH);
    for (const kind of KINDS) {
      const m = mark(kind, 777, -333);
      for (const p of landmarkLayout(m, slope(m)).parts) expect(reach(p, m)).toBeLessThanOrEqual(STRUCTURE_REACH);
    }
  });

  it('turns castles four ways and ruins about a quarter of them', () => {
    const turns = [0, 0, 0, 0];
    let ruined = 0;
    const all = castles();
    for (const m of all) {
      turns[castleTurn(m)]++;
      if (castleRuin(m) !== null) ruined++;
    }
    process.stdout.write(`castle turns ${turns.join('/')}, ruined ${ruined} of ${all.length}\n`);
    for (const n of turns) expect(n).toBeGreaterThan(all.length * 0.17);
    expect(ruined / all.length).toBeGreaterThan(0.17);
    expect(ruined / all.length).toBeLessThan(0.33);
  });

  it('builds a gatehouse, crenellations, taller towers, a roofed keep, slits, torches and a bonfire', () => {
    const intact = castles().filter((m) => castleRuin(m) === null).slice(0, 40);
    expect(intact.length).toBe(40);
    for (const m of intact) {
      const layout = landmarkLayout(m, slope(m));
      const walls = roles(layout, 'wall');
      const towers = roles(layout, 'tower');
      const keep = roles(layout, 'keep');
      const roof = roles(layout, 'roof');
      const lintels = roles(layout, 'lintel');
      expect(walls.length).toBe(6);
      expect(towers.length).toBe(4);
      expect(roles(layout, 'merlon').length).toBeGreaterThanOrEqual(60);
      expect(roles(layout, 'window').length).toBeGreaterThanOrEqual(6);
      expect(roles(layout, 'window').every((p) => p.material === MATERIAL.TRUNK)).toBe(true);
      const wallTop = Math.max(...walls.map(top));
      for (const tower of towers) {
        expect(tower.shape).toBe('cylinder');
        expect(tower.blocks).toBe(true);
        expect(top(tower)).toBeGreaterThan(wallTop + 3);
      }
      expect(roof.length).toBe(1);
      expect(roof[0].shape).toBe('gable');
      expect(roof[0].material).toBe(MATERIAL.TRUNK);
      expect(bottom(roof[0])).toBeCloseTo(Math.max(...keep.map(top)), 6);
      expect(lintels.length).toBe(2);
      const gate = castleGate(m);
      const passage = slope(m)(gate.x - gate.dx * 2.6, gate.z - gate.dz * 2.6);
      for (const lintel of lintels) {
        expect(lintel.blocks).toBe(false);
        expect(bottom(lintel) - passage).toBeGreaterThan(2.9);
      }
      expect(roles(layout, 'gate').every((p) => p.blocks && p.material === MATERIAL.TRUNK)).toBe(true);
      expect(roles(layout, 'portcullis').every((p) => !p.blocks)).toBe(true);
      const torches = layout.fires.filter((f) => !f.hearth);
      const hearths = layout.fires.filter((f) => f.hearth);
      expect(torches.length).toBe(6);
      expect(hearths.length).toBe(1);
      expect(Math.hypot(hearths[0].x - m.x, hearths[0].z - m.z)).toBeLessThan(1);
      expect(roles(layout, 'torch').filter((p) => p.material === MATERIAL.FIRE).length).toBe(6);
    }
  });

  it('keeps the courtyard clear for villagers within 8 m of the landmark point', () => {
    for (const m of castles().slice(0, 100)) {
      for (const p of landmarkLayout(m, () => m.y).parts) {
        if (!p.blocks || p.role === 'bonfire') continue;
        for (const [x, z] of footprint(p)) expect(Math.hypot(x - m.x, z - m.z)).toBeGreaterThan(8.3);
      }
    }
  });

  it('breaks ruins open: a wall run gone, a short jagged tower, fallen merlons', () => {
    const ruins = castles().filter((m) => castleRuin(m) !== null);
    const whole = castles().find((m) => castleRuin(m) === null);
    expect(ruins.length).toBeGreaterThan(40);
    expect(whole).toBeDefined();
    const intactMerlons = whole === undefined ? 0 : roles(landmarkLayout(whole, () => whole.y), 'merlon').length;
    expect(intactMerlons).toBe(72);
    let fallen = 0;
    for (const m of ruins) {
      const ruin = castleRuin(m);
      if (ruin === null) continue;
      const layout = landmarkLayout(m, slope(m));
      const towers = roles(layout, 'tower').filter((p) => p.shape === 'cylinder');
      const tops = towers.map(top).sort((a, b) => a - b);
      expect(tops[0]).toBeLessThan(tops[1] - 2.5);
      expect(roles(layout, 'tower').filter((p) => p.shape === 'box').length).toBeGreaterThan(0);
      expect(roles(layout, 'rubble').length).toBeGreaterThanOrEqual(5);
      expect(roles(layout, 'portcullis').length).toBe(0);
      expect(ruin.breachTo - ruin.breachFrom).toBeGreaterThan(4.5);
      expect(roles(layout, 'wall').length).toBeGreaterThan(6);
      fallen += roles(layout, 'fallen').length;
      expect(roles(layout, 'merlon').length).toBeLessThan(intactMerlons);
    }
    expect(fallen / ruins.length).toBeGreaterThan(2);
  });

  it('sinks every footing below the ground it stands on', () => {
    for (const kind of KINDS) {
      for (let k = 0; k < 8; k++) {
        const m = mark(kind, 150 + 512 * k, 420 + 25 * k);
        const ground = slope(m);
        for (const p of landmarkLayout(m, ground).parts) {
          if (!p.blocks) continue;
          let low = Infinity;
          for (const [x, z] of footprint(p)) low = Math.min(low, ground(x, z));
          expect(bottom(p)).toBeLessThan(low - 0.2);
        }
      }
    }
  });

  it('points castleGate at the passage through the gatehouse', () => {
    for (const m of castles().slice(0, 60)) {
      const gate = castleGate(m);
      expect(Math.hypot(gate.dx, gate.dz)).toBeCloseTo(1, 9);
      expect(Math.hypot(gate.x - m.x, gate.z - m.z)).toBeCloseTo(CASTLE.gateFront, 9);
      const lintels = roles(landmarkLayout(m, () => m.y), 'lintel');
      const front = lintels.find((p) => Math.abs(Math.hypot(p.x - m.x, p.z - m.z) - CASTLE.gateFront) < 1e-6);
      expect(front).toBeDefined();
    }
  });

  it('grows tall pines, young trees and the odd broadleaf from the tree position', () => {
    const n = 40000;
    let tall = 0;
    let young = 0;
    let grown = 0;
    let broad = 0;
    let hMin = Infinity;
    let hMax = -Infinity;
    let wMin = Infinity;
    let wMax = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = Math.fround(-3000 + (k % 211) * 3.07 + (k * 0.013) % 2);
      const z = Math.fround(1200 + Math.floor(k / 211) * 2.93);
      const v = treeVariant(x, z);
      expect(treeVariant(x, z)).toEqual(v);
      if (v.height >= 1.6) {
        tall++;
        expect(v.height).toBeLessThanOrEqual(2.2);
        expect(v.width).toBeGreaterThan(1);
        expect(v.broadleaf).toBe(false);
      } else if (v.height <= 0.75) {
        young++;
        expect(v.height).toBeGreaterThanOrEqual(0.45);
      } else {
        grown++;
        expect(v.height).toBeGreaterThanOrEqual(0.85);
        expect(v.height).toBeLessThanOrEqual(1.25);
      }
      if (v.broadleaf) broad++;
      hMin = Math.min(hMin, v.height);
      hMax = Math.max(hMax, v.height);
      wMin = Math.min(wMin, v.width);
      wMax = Math.max(wMax, v.width);
    }
    process.stdout.write(
      `trees: tall ${(tall / n * 100).toFixed(1)}%  young ${(young / n * 100).toFixed(1)}%  `
      + `grown ${(grown / n * 100).toFixed(1)}%  broadleaf ${(broad / n * 100).toFixed(1)}%  `
      + `height x${hMin.toFixed(2)}..${hMax.toFixed(2)}  width x${wMin.toFixed(2)}..${wMax.toFixed(2)}\n`,
    );
    expect(tall / n).toBeGreaterThan(0.12);
    expect(tall / n).toBeLessThan(0.18);
    expect(young / n).toBeGreaterThan(0.17);
    expect(young / n).toBeLessThan(0.23);
    expect(broad / n).toBeGreaterThan(0.04);
    expect(broad / n).toBeLessThan(0.16);
    expect(hMax / hMin).toBeGreaterThan(2 * (wMax / wMin));
  });

  it('sizes a tree collider from its trunk, and wider where branches hang at head height', () => {
    let wider = 0;
    for (let k = 0; k < 5000; k++) {
      const v = treeVariant(40 + k * 1.37, -90 + (k % 53) * 2.11);
      const scale = 0.8 + (k % 7) * 0.1;
      const solid = treeSolidRadius(v, scale);
      expect(solid).toBeGreaterThanOrEqual(treeTrunkRadius(v, scale));
      expect(solid).toBeLessThanOrEqual(1);
      if (solid > treeTrunkRadius(v, scale) + 1e-9) wider++;
    }
    expect(wider).toBeGreaterThan(0);
  });

  it('renders a castle from the parts in a handful of instanced meshes, bonfire included', () => {
    const sampler = createSampler(77);
    let chunk: ChunkData | null = null;
    for (let rz = 0; rz < 20 && chunk === null; rz++) {
      for (let rx = 0; rx < 20 && chunk === null; rx++) {
        const m = landmarkForRegion(77, rx, rz, sampler);
        if (m === null || m.kind !== 'castle') continue;
        chunk = generateChunk(77, Math.floor(m.x / 64), Math.floor(m.z / 64), sampler);
      }
    }
    expect(chunk).not.toBeNull();
    if (chunk === null || chunk.landmark === null) return;
    const bare: ChunkData = { ...chunk, props: new Float32Array(0) };
    const material = new ShaderMaterial();
    const group = buildProps(bare, material, ATLAS, sampler.height.bind(sampler));
    let meshes = 0;
    let instances = 0;
    group.traverse((child) => {
      const mesh = child as InstancedMesh;
      if (!mesh.isInstancedMesh) return;
      meshes++;
      instances += mesh.count;
    });
    const layout = landmarkLayout(chunk.landmark, sampler.height.bind(sampler));
    expect(instances).toBe(layout.parts.length);
    expect(meshes).toBeLessThanOrEqual(6);
    const fires = group.userData.fires as Array<{ x: number; z: number; hearth: boolean }>;
    expect(fires.filter((f) => f.hearth).length).toBe(1);
    expect(fires.length).toBe(layout.fires.length);
    const dispose = group.userData.dispose as () => void;
    dispose();
    material.dispose();
  });

  it('plants every tree prop into the pine or broadleaf mesh with its variant size', () => {
    const props = new Float32Array([
      10.5, 20.25, PROP.TREE, 1,
      13.75, 21.5, PROP.TREE, 1.2,
      16.125, 25.5, PROP.TREE, 0.9,
      20.5, 29.75, PROP.ROCK, 1,
    ]);
    const heights = new Float32Array(33 * 33).fill(4);
    const data: ChunkData = {
      cx: 0,
      cz: 0,
      genVersion: 1,
      heights,
      materials: new Uint8Array(33 * 33),
      props,
      landmark: null,
    };
    const material = new ShaderMaterial();
    const group = buildProps(data, material, ATLAS);
    const trees = group.userData.pines as { children: InstancedMesh[] } | null;
    expect(trees).not.toBeNull();
    let planted = 0;
    for (const mesh of trees === null ? [] : trees.children) planted += mesh.count;
    expect(planted).toBe(3);
    const dispose = group.userData.dispose as () => void;
    dispose();
    material.dispose();
  });
});
