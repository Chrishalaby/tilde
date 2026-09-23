import { gatherFacts, homeLetterFor } from './lines';
import type { Brain, Npc, NpcWorld } from './types';

const DEFAULT_ENDPOINT = '/api/npc/speak';
const TIMEOUT = 3500;
const COOL_OFF = 600000;
const RECENT = 3;
const MAX_LENGTH = 90;

export function createRemoteBrain(base: Brain, endpoint?: string): Brain {
  const url = endpoint ?? DEFAULT_ENDPOINT;
  const recent = new Map<string, string[]>();
  let silentUntil = 0;

  function remember(id: string, line: string): void {
    const said = recent.get(id);
    if (!said) {
      recent.set(id, [line]);
      return;
    }
    said.push(line);
    while (said.length > RECENT) said.shift();
  }

  async function speakAsync(npc: Npc, world: NpcWorld): Promise<string | null> {
    try {
      if (typeof fetch !== 'function') return null;
      if (Date.now() < silentUntil) return null;
      const facts = gatherFacts(npc, world);
      const body = {
        npc: {
          name: npc.name,
          glyph: npc.glyph,
          temperament: npc.temperament,
          homeLetter: homeLetterFor(npc, world) ?? '',
        },
        world: {
          phase: facts.phase,
          ground: facts.ground,
          hint: facts.hint,
          lettersFound: facts.lettersFound,
          recent: recent.get(npc.id) ?? [],
        },
      };
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT) : null;
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller ? controller.signal : undefined,
        });
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
      if (response.status === 503 || response.status === 429) {
        silentUntil = Date.now() + COOL_OFF;
        return null;
      }
      if (!response.ok) return null;
      const data = (await response.json()) as { line?: unknown };
      const line = typeof data.line === 'string' ? data.line.trim() : '';
      if (line.length === 0 || line.length >= MAX_LENGTH) return null;
      remember(npc.id, line);
      return line;
    } catch {
      return null;
    }
  }

  return {
    decide: (npc, world, dt, rng) => base.decide(npc, world, dt, rng),
    speak: (npc, world, rng) => base.speak(npc, world, rng),
    speakAsync,
  };
}
