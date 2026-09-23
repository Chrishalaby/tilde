import { composeLine, gatherFacts, homeLetterFor } from './lines';
import type { Brain, ChatLine, ChatTurn, Npc, NpcWorld } from './types';

const DEFAULT_ENDPOINT = '/api/npc/speak';
const DEFAULT_CHAT_ENDPOINT = '/api/npc/chat';
const TIMEOUT = 3500;
const CHAT_TIMEOUT = 9000;
const COOL_OFF = 600000;
const BUSY_COOL_OFF = 60000;
const DOWN_COOL_OFF = 15000;
const RECENT = 3;
const MAX_LENGTH = 90;
const MAX_REPLY = 200;
const MAX_HISTORY = 12;
const MAX_TEXT = 240;
const MAX_BODY = 8000;

interface ChatBody {
  npc: { name: string; glyph: string; temperament: string; homeKind: string; homeLetter: string };
  world: { phase: string; ground: string; hint: string; lettersFound: number; metBefore: boolean };
  history: ChatLine[];
  message: string;
}

function clip(text: string): string {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

function byteLength(text: string): number {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
  return text.length * 3;
}

function chatBody(npc: Npc, world: NpcWorld, turn: ChatTurn): ChatBody {
  const facts = gatherFacts(npc, world);
  const history: ChatLine[] = [];
  for (let i = Math.max(0, turn.history.length - MAX_HISTORY); i < turn.history.length; i++) {
    const line = turn.history[i];
    const text = clip(line.text);
    if (text.length > 0 && (line.who === 'player' || line.who === 'npc')) history.push({ who: line.who, text });
  }
  return {
    npc: {
      name: npc.name,
      glyph: npc.glyph,
      temperament: npc.temperament,
      homeKind: turn.homeKind,
      homeLetter: homeLetterFor(npc, world) ?? '',
    },
    world: {
      phase: facts.phase,
      ground: facts.ground,
      hint: facts.hint,
      lettersFound: Math.min(26, facts.lettersFound),
      metBefore: turn.metBefore,
    },
    history,
    message: clip(turn.message),
  };
}

function encode(body: ChatBody): string {
  let text = JSON.stringify(body);
  while (byteLength(text) > MAX_BODY && body.history.length > 0) {
    body.history.shift();
    text = JSON.stringify(body);
  }
  return text;
}

function isAbort(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError';
}

async function post(url: string, body: string, timeout: number): Promise<Response> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: controller ? controller.signal : undefined,
    });
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export function createRemoteBrain(base: Brain, endpoint?: string, chatEndpoint?: string): Brain {
  const url = endpoint ?? DEFAULT_ENDPOINT;
  const chatUrl = chatEndpoint ?? DEFAULT_CHAT_ENDPOINT;
  const recent = new Map<string, string[]>();
  let silentUntil = 0;
  let chatSilentUntil = 0;

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
      const response = await post(url, JSON.stringify(body), TIMEOUT);
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

  async function askChat(npc: Npc, world: NpcWorld, turn: ChatTurn): Promise<string | null> {
    try {
      if (typeof fetch !== 'function') return null;
      if (Date.now() < chatSilentUntil) return null;
      const payload = encode(chatBody(npc, world, turn));
      let response: Response;
      try {
        response = await post(chatUrl, payload, CHAT_TIMEOUT);
      } catch (error) {
        if (!isAbort(error)) chatSilentUntil = Date.now() + DOWN_COOL_OFF;
        return null;
      }
      if (response.status === 503 || response.status === 404 || response.status === 405) {
        chatSilentUntil = Date.now() + COOL_OFF;
        return null;
      }
      if (response.status === 429) {
        chatSilentUntil = Date.now() + BUSY_COOL_OFF;
        return null;
      }
      if (response.status === 500 || response.status === 502 || response.status === 504) {
        chatSilentUntil = Date.now() + DOWN_COOL_OFF;
        return null;
      }
      if (!response.ok) return null;
      const data = (await response.json()) as { line?: unknown };
      const line = typeof data.line === 'string' ? data.line.trim() : '';
      if (line.length === 0 || line.length > MAX_REPLY) return null;
      return line;
    } catch {
      return null;
    }
  }

  async function chat(npc: Npc, world: NpcWorld, turn: ChatTurn, rng: () => number): Promise<string> {
    const remote = await askChat(npc, world, turn);
    if (remote !== null) {
      remember(npc.id, remote);
      return remote;
    }
    if (base.chat) return base.chat(npc, world, turn, rng);
    return composeLine(npc, world, rng);
  }

  return {
    decide: (npc, world, dt, rng) => base.decide(npc, world, dt, rng),
    speak: (npc, world, rng) => base.speak(npc, world, rng),
    speakAsync,
    chat,
  };
}
