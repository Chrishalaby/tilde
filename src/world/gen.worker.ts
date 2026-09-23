import { GEN_VERSION } from '../config';
import { generateChunk } from './chunk-gen';
import { createSampler } from './sampler';
import type { ChunkReply, GenRequest, WorldSampler } from './types';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const samplers = new Map<number, WorldSampler>();

function samplerFor(seed: number): WorldSampler {
  let sampler = samplers.get(seed);
  if (!sampler) {
    sampler = createSampler(seed);
    samplers.set(seed, sampler);
  }
  return sampler;
}

ctx.onmessage = (event: MessageEvent<GenRequest>) => {
  const req = event.data;
  if (!req || req.type !== 'gen') return;
  if (req.genVersion !== GEN_VERSION) return;
  const data = generateChunk(req.seed, req.cx, req.cz, samplerFor(req.seed));
  const reply: ChunkReply = { type: 'chunk', ...data };
  const transfer: Transferable[] = [reply.heights.buffer, reply.materials.buffer, reply.props.buffer];
  if (reply.roads) transfer.push(reply.roads.buffer);
  ctx.postMessage(reply, transfer);
};
