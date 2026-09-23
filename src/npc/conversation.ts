import { placePhrase } from './lines';
import type { NpcManager } from './manager';
import type { ChatLine } from './types';

export const LEAVE_RANGE = 8;
export const HISTORY_LIMIT = 12;
export const TEXT_LIMIT = 240;

const KEPT_LINES = 24;
const REMEMBERED = 32;

export interface ConversationView {
  id: string;
  name: string;
  home: string;
  lines: ChatLine[];
  pending: boolean;
  metBefore: boolean;
}

export interface ConversationOptions {
  metBefore?(id: string): boolean;
  onChange?(view: ConversationView | null): void;
  onReply?(view: ConversationView, line: string): void;
}

export interface Conversation {
  open(id: string): ConversationView | null;
  say(text: string): boolean;
  close(): void;
  view(): ConversationView | null;
  active(): string | null;
  check(x: number, z: number): boolean;
}

interface Talk {
  id: string;
  name: string;
  home: string;
  lines: ChatLine[];
  pending: boolean;
  metBefore: boolean;
}

export function clipText(text: string): string {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, TEXT_LIMIT);
}

export function historyFor(lines: readonly ChatLine[]): ChatLine[] {
  const out: ChatLine[] = [];
  for (let i = Math.max(0, lines.length - HISTORY_LIMIT); i < lines.length; i++) {
    const text = clipText(lines[i].text);
    if (text.length > 0) out.push({ who: lines[i].who, text });
  }
  return out;
}

export function createConversation(manager: NpcManager, opts: ConversationOptions = {}): Conversation {
  const memory = new Map<string, ChatLine[]>();
  let current: Talk | null = null;
  let serial = 0;

  const copy = (talk: Talk): ConversationView => ({
    id: talk.id,
    name: talk.name,
    home: talk.home,
    lines: talk.lines.map((line) => ({ who: line.who, text: line.text })),
    pending: talk.pending,
    metBefore: talk.metBefore,
  });

  const changed = (): void => {
    if (opts.onChange) opts.onChange(current ? copy(current) : null);
  };

  const keep = (talk: Talk): void => {
    if (talk.lines.length > KEPT_LINES) talk.lines.splice(0, talk.lines.length - KEPT_LINES);
    memory.delete(talk.id);
    memory.set(talk.id, talk.lines.slice(-HISTORY_LIMIT));
    while (memory.size > REMEMBERED) {
      const oldest = memory.keys().next().value;
      if (oldest === undefined) break;
      memory.delete(oldest);
    }
  };

  const heard = (talk: Talk, text: string): void => {
    talk.lines.push({ who: 'npc', text });
    keep(talk);
    if (opts.onReply) opts.onReply(copy(talk), text);
  };

  const land = (talk: Talk, ticket: number, line: string | null): void => {
    if (current !== talk || ticket !== serial) return;
    talk.pending = false;
    const text = line === null ? '' : clipText(line);
    if (text.length > 0) heard(talk, text);
    changed();
  };

  const ask = (talk: Talk, message: string, history: ChatLine[]): void => {
    const ticket = ++serial;
    talk.pending = true;
    manager.reply(talk.id, { history, message, metBefore: talk.metBefore }).then(
      (line) => land(talk, ticket, line),
      () => land(talk, ticket, null),
    );
  };

  const close = (): void => {
    const talk = current;
    if (!talk) return;
    current = null;
    serial++;
    keep(talk);
    manager.release(talk.id);
    changed();
  };

  const open = (id: string): ConversationView | null => {
    if (current && current.id === id) return copy(current);
    if (current) close();
    const info = manager.info(id);
    if (!info || !manager.hold(id)) return null;
    const talk: Talk = {
      id,
      name: info.name.toLowerCase(),
      home: placePhrase(info.homeKind, info.homeLetter),
      lines: (memory.get(id) ?? []).map((line) => ({ who: line.who, text: line.text })),
      pending: false,
      metBefore: opts.metBefore ? opts.metBefore(id) : false,
    };
    current = talk;
    const greeting = info.speaking === null ? '' : clipText(info.speaking);
    if (greeting.length > 0) heard(talk, greeting);
    else ask(talk, '', historyFor(talk.lines));
    changed();
    return copy(talk);
  };

  const say = (text: string): boolean => {
    const talk = current;
    if (!talk || talk.pending) return false;
    const message = clipText(text);
    const history = historyFor(talk.lines);
    if (message.length > 0) talk.lines.push({ who: 'player', text: message });
    ask(talk, message, history);
    changed();
    return true;
  };

  const check = (x: number, z: number): boolean => {
    const talk = current;
    if (!talk) return false;
    const info = manager.info(talk.id);
    if (!info || manager.holding() !== talk.id || Math.hypot(info.x - x, info.z - z) > LEAVE_RANGE) {
      close();
      return false;
    }
    return true;
  };

  return {
    open,
    say,
    close,
    view: () => (current ? copy(current) : null),
    active: () => (current ? current.id : null),
    check,
  };
}
