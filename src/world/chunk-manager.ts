import { Mesh, Object3D, Scene, ShaderMaterial } from 'three';
import {
  BUILDS_PER_FRAME, CHUNK_SIZE, CHUNK_VERTS, GEN_VERSION, KEEP_MULTIPLIER,
  PREFETCH_RADIUS, RENDER_RADIUS, SEA_LEVEL, VERTEX_SPACING, WORKER_MAX, WORKER_MIN,
} from '../config';
import type { ChunkData, ChunkReply, GenRequest, Landmark, WorldSampler } from './types';
import { chunkKey } from './types';
import { buildTerrainGeometry } from '../render/terrain-mesh';
import { buildProps } from '../render/props';
import type { GlyphAtlas } from '../render/glyph-atlas';

type State = 'wanted' | 'generating' | 'ready' | 'built';

interface Entry {
  cx: number;
  cz: number;
  key: string;
  state: State;
  dist: number;
  wanted: boolean;
  data: ChunkData | null;
  mesh: Mesh | null;
  props: Object3D | null;
}

interface PoolWorker {
  worker: Worker;
  busy: Entry | null;
}

export interface ChunkManagerOptions {
  seed: number;
  scene: Scene;
  terrainMaterial: ShaderMaterial;
  atlas: GlyphAtlas;
  sampler: WorldSampler;
  onVisit?: (key: string) => void;
}

export interface FirePoint {
  x: number;
  y: number;
  z: number;
}

export interface ChunkStats {
  loaded: number;
  visible: number;
  pending: number;
  workers: number;
}

export interface PropHit {
  x: number;
  z: number;
  kind: number;
  scale: number;
}

export interface ChunkManager {
  update(px: number, pz: number): void;
  heightAt(x: number, z: number): number;
  materialAt(x: number, z: number): number;
  landmarksNear(x: number, z: number, radius: number): Landmark[];
  firesNear(x: number, z: number, radius: number): Array<{ x: number; z: number }>;
  propsNear(x: number, z: number, radius: number): PropHit[];
  stats(): ChunkStats;
  dispose(): void;
}

function workerCount(): number {
  const hc = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  return Math.max(WORKER_MIN, Math.min(WORKER_MAX, hc - 1));
}

export function createChunkManager(opts: ChunkManagerOptions): ChunkManager {
  const { seed, scene, terrainMaterial, atlas, sampler } = opts;
  const entries = new Map<string, Entry>();
  const pool: PoolWorker[] = [];
  let lastPlayerKey = '';
  let disposed = false;

  const handleReply = (pw: PoolWorker, reply: ChunkReply) => {
    pw.busy = null;
    if (disposed) return;
    const entry = entries.get(chunkKey(reply.cx, reply.cz));
    if (!entry || reply.genVersion !== GEN_VERSION) return;
    if (!entry.wanted) {
      entries.delete(entry.key);
      return;
    }
    const { type: _type, ...data } = reply;
    entry.data = data;
    entry.state = 'ready';
  };

  for (let i = 0; i < workerCount(); i++) {
    const worker = new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module' });
    const pw: PoolWorker = { worker, busy: null };
    worker.onmessage = (ev: MessageEvent<ChunkReply>) => {
      if (ev.data && ev.data.type === 'chunk') handleReply(pw, ev.data);
    };
    worker.onerror = () => {
      if (pw.busy) {
        pw.busy.state = 'wanted';
        pw.busy = null;
      }
    };
    pool.push(pw);
  }

  const dispatch = () => {
    for (const pw of pool) {
      if (pw.busy) continue;
      let best: Entry | null = null;
      for (const e of entries.values()) {
        if (e.state !== 'wanted' || !e.wanted) continue;
        if (!best || e.dist < best.dist) best = e;
      }
      if (!best) return;
      best.state = 'generating';
      pw.busy = best;
      const req: GenRequest = { type: 'gen', seed, cx: best.cx, cz: best.cz, genVersion: GEN_VERSION };
      pw.worker.postMessage(req);
    }
  };

  const setPines = (e: Entry, visible: boolean) => {
    const pines = e.props ? (e.props.userData.pines as Object3D | null | undefined) : null;
    if (pines) pines.visible = visible;
  };

  const destroyEntry = (e: Entry) => {
    if (e.mesh) {
      scene.remove(e.mesh);
      e.mesh.geometry.dispose();
      e.mesh = null;
    }
    if (e.props) {
      scene.remove(e.props);
      const dispose = e.props.userData.dispose as (() => void) | undefined;
      if (dispose) dispose();
      e.props = null;
    }
    e.data = null;
    entries.delete(e.key);
  };

  const build = (e: Entry) => {
    if (!e.data) return;
    const geometry = buildTerrainGeometry(e.data);
    const mesh = new Mesh(geometry, terrainMaterial);
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    e.mesh = mesh;
    const props = buildProps(e.data, terrainMaterial, atlas);
    props.matrixAutoUpdate = false;
    scene.add(props);
    e.props = props;
    e.state = 'built';
  };

  const update = (px: number, pz: number) => {
    if (disposed) return;
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    const playerKey = chunkKey(pcx, pcz);
    if (playerKey !== lastPlayerKey) {
      lastPlayerKey = playerKey;
      if (opts.onVisit) opts.onVisit(playerKey);
    }

    const fx = px / CHUNK_SIZE - 0.5;
    const fz = pz / CHUNK_SIZE - 0.5;
    const prefetchSq = (PREFETCH_RADIUS + 0.5) * (PREFETCH_RADIUS + 0.5);
    const renderSq = (RENDER_RADIUS + 0.5) * (RENDER_RADIUS + 0.5);
    const treeSq = (RENDER_RADIUS - 1.5) * (RENDER_RADIUS - 1.5);

    for (const e of entries.values()) e.wanted = false;
    let desired = 0;
    for (let dz = -PREFETCH_RADIUS; dz <= PREFETCH_RADIUS; dz++) {
      for (let dx = -PREFETCH_RADIUS; dx <= PREFETCH_RADIUS; dx++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const ddx = cx - fx;
        const ddz = cz - fz;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 > prefetchSq) continue;
        desired++;
        const key = chunkKey(cx, cz);
        let e = entries.get(key);
        if (!e) {
          e = { cx, cz, key, state: 'wanted', dist: d2, wanted: true, data: null, mesh: null, props: null };
          entries.set(key, e);
        }
        e.wanted = true;
        e.dist = d2;
        const visible = d2 <= renderSq;
        if (e.mesh) e.mesh.visible = visible;
        if (e.props) e.props.visible = visible;
        setPines(e, d2 <= treeSq);
      }
    }

    const keepLimit = Math.ceil(desired * KEEP_MULTIPLIER);
    if (entries.size > keepLimit) {
      const stale: Entry[] = [];
      for (const e of entries.values()) {
        if (!e.wanted && e.state !== 'generating') {
          const ddx = e.cx - fx;
          const ddz = e.cz - fz;
          e.dist = ddx * ddx + ddz * ddz;
          stale.push(e);
        }
      }
      stale.sort((a, b) => b.dist - a.dist);
      let excess = entries.size - keepLimit;
      for (const e of stale) {
        if (excess <= 0) break;
        destroyEntry(e);
        excess--;
      }
    }
    for (const e of entries.values()) {
      if (!e.wanted && e.mesh) e.mesh.visible = false;
      if (!e.wanted && e.props) e.props.visible = false;
      if (!e.wanted && e.state === 'wanted') entries.delete(e.key);
    }

    dispatch();

    let builds = 0;
    while (builds < BUILDS_PER_FRAME) {
      let best: Entry | null = null;
      for (const e of entries.values()) {
        if (e.state !== 'ready' || !e.wanted) continue;
        if (!best || e.dist < best.dist) best = e;
      }
      if (!best) break;
      build(best);
      const visible = best.dist <= renderSq;
      if (best.mesh) best.mesh.visible = visible;
      if (best.props) best.props.visible = visible;
      setPines(best, best.dist <= treeSq);
      builds++;
    }
  };

  const dataAt = (x: number, z: number): ChunkData | null => {
    const e = entries.get(chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)));
    return e && e.data ? e.data : null;
  };

  const heightAt = (x: number, z: number): number => {
    const data = dataAt(x, z);
    if (!data) return sampler.height(x, z);
    const lx = (x - data.cx * CHUNK_SIZE) / VERTEX_SPACING;
    const lz = (z - data.cz * CHUNK_SIZE) / VERTEX_SPACING;
    const i0 = Math.min(CHUNK_VERTS - 2, Math.max(0, Math.floor(lx)));
    const j0 = Math.min(CHUNK_VERTS - 2, Math.max(0, Math.floor(lz)));
    const fx = Math.min(1, Math.max(0, lx - i0));
    const fz = Math.min(1, Math.max(0, lz - j0));
    const h = data.heights;
    const a = h[j0 * CHUNK_VERTS + i0];
    const b = h[j0 * CHUNK_VERTS + i0 + 1];
    const c = h[(j0 + 1) * CHUNK_VERTS + i0];
    const d = h[(j0 + 1) * CHUNK_VERTS + i0 + 1];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  };

  const materialAt = (x: number, z: number): number => {
    const data = dataAt(x, z);
    if (!data) return heightAt(x, z) < SEA_LEVEL ? 5 : 0;
    const i = Math.min(CHUNK_VERTS - 1, Math.max(0, Math.round((x - data.cx * CHUNK_SIZE) / VERTEX_SPACING)));
    const j = Math.min(CHUNK_VERTS - 1, Math.max(0, Math.round((z - data.cz * CHUNK_SIZE) / VERTEX_SPACING)));
    return data.materials[j * CHUNK_VERTS + i];
  };

  const landmarksNear = (x: number, z: number, radius: number): Landmark[] => {
    const out: Landmark[] = [];
    const r2 = radius * radius;
    for (const e of entries.values()) {
      const lm = e.data && e.data.landmark;
      if (!lm) continue;
      const dx = lm.x - x;
      const dz = lm.z - z;
      if (dx * dx + dz * dz <= r2) out.push(lm);
    }
    return out;
  };

  const firesNear = (x: number, z: number, radius: number): Array<{ x: number; z: number }> => {
    const out: FirePoint[] = [];
    const r2 = radius * radius;
    for (const e of entries.values()) {
      if (!e.props) continue;
      const fires = e.props.userData.fires as FirePoint[] | undefined;
      if (!fires) continue;
      for (let i = 0; i < fires.length; i++) {
        const fire = fires[i];
        const dx = fire.x - x;
        const dz = fire.z - z;
        if (dx * dx + dz * dz <= r2) out.push(fire);
      }
    }
    return out;
  };

  const stats = (): ChunkStats => {
    let loaded = 0;
    let visible = 0;
    let pending = 0;
    for (const e of entries.values()) {
      if (e.state === 'built') {
        loaded++;
        if (e.mesh && e.mesh.visible) visible++;
      } else pending++;
    }
    return { loaded, visible, pending, workers: pool.length };
  };

  const dispose = () => {
    disposed = true;
    for (const pw of pool) pw.worker.terminate();
    for (const e of Array.from(entries.values())) destroyEntry(e);
  };

  const propsNear = (x: number, z: number, radius: number): PropHit[] => {
    const out: PropHit[] = [];
    const r2 = radius * radius;
    const reach = radius + CHUNK_SIZE;
    for (const e of entries.values()) {
      const data = e.data;
      if (!data) continue;
      const ccx = (data.cx + 0.5) * CHUNK_SIZE;
      const ccz = (data.cz + 0.5) * CHUNK_SIZE;
      if (Math.abs(ccx - x) > reach || Math.abs(ccz - z) > reach) continue;
      const props = data.props;
      for (let i = 0; i + 3 < props.length; i += 4) {
        const dx = props[i] - x;
        const dz = props[i + 1] - z;
        if (dx * dx + dz * dz <= r2) out.push({ x: props[i], z: props[i + 1], kind: props[i + 2], scale: props[i + 3] });
      }
    }
    return out;
  };

  return { update, heightAt, materialAt, landmarksNear, firesNear, propsNear, stats, dispose };
}
