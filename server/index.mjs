import OpenAI from 'openai';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = resolve(ROOT, process.env.TILDE_DIST || 'dist');
const PORT = Number(process.env.PORT) || 4173;
const HOST = '0.0.0.0';

const MAX_BODY = 4096;
const IP_CAPACITY = 10;
const IP_WINDOW = 60000;
const GLOBAL_CAPACITY = 400;
const GLOBAL_WINDOW = 3600000;
const CALL_TIMEOUT = 6000;
const MAX_LINE = 88;
const MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';

const MAX_CHAT_BODY = 8192;
const CHAT_IP_CAPACITY = 20;
const CHAT_GLOBAL_CAPACITY = 600;
const CHAT_TIMEOUT = 7000;
const MAX_REPLY = 200;
const MAX_HISTORY = 12;
const MAX_TEXT = 240;
const MAX_HINT = 200;
const NAME_PATTERN = /^[A-Za-z]{1,24}$/;
const GLYPH_PATTERN = /^[a-z]$/;
const KIND_PATTERN = /^[a-z]{0,12}$/;
const LETTER_PATTERN = /^[a-z]?$/;
const TEMPERAMENTS = new Set(['curious', 'quiet', 'wistful', 'cheerful']);
const PHASES = new Set(['dawn', 'morning', 'noon', 'dusk', 'night']);
const GROUNDS = new Set(['grass', 'forest', 'stone', 'sand', 'snow', 'water', 'bare']);
const SPEAKERS = new Set(['player', 'npc']);
const HOMES = new Map([
  ['castle', 'by the castle'],
  ['ring', 'by the ring of standing stones'],
  ['shelter', 'at the low stone shelter'],
  ['tree', 'by the lone tall tree'],
  ['pool', 'by the still pool'],
]);
const GROUND_WORDS = new Map([
  ['grass', 'grass'],
  ['forest', 'the forest floor'],
  ['stone', 'bare stone'],
  ['sand', 'sand'],
  ['snow', 'snow'],
  ['water', 'shallow water'],
  ['bare', 'bare ground'],
]);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const SYSTEM_PROMPT = [
  'You are a villager in a quiet endless world made of punctuation.',
  'The only capital letters in this world are giant monoliths standing on the hills, and the villagers are lowercase letters who live near them.',
  'You speak one short plain sentence, in lowercase, with no exclamation marks.',
  'You are a little strange, the way someone is who has lived in one small place a long time.',
  'You never explain the game, never mention keys, controls, screens, players or being an AI, and never break the world.',
  'If the facts include a hint, you may point the traveller toward the thing they have not found yet.',
  'Keep the sentence under 90 characters.',
].join(' ');

const client = process.env.OPENAI_API_KEY ? new OpenAI() : null;

function takeToken(bucket, capacity, window, now) {
  bucket.tokens = Math.min(capacity, bucket.tokens + ((now - bucket.stamp) / window) * capacity);
  bucket.stamp = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

function createLimiter(ipCapacity, ipWindow, globalCapacity, globalWindow) {
  const buckets = new Map();
  const globalBucket = { tokens: globalCapacity, stamp: Date.now() };
  const sweep = (now) => {
    if (buckets.size < 2048) return;
    for (const [key, bucket] of buckets) {
      if (now - bucket.stamp > ipWindow) buckets.delete(key);
    }
  };
  return (ip) => {
    const now = Date.now();
    sweep(now);
    let bucket = buckets.get(ip);
    if (!bucket) {
      bucket = { tokens: ipCapacity, stamp: now };
      buckets.set(ip, bucket);
    }
    if (!takeToken(bucket, ipCapacity, ipWindow, now)) return false;
    return takeToken(globalBucket, globalCapacity, globalWindow, now);
  };
}

const allow = createLimiter(IP_CAPACITY, IP_WINDOW, GLOBAL_CAPACITY, GLOBAL_WINDOW);
const allowChat = createLimiter(CHAT_IP_CAPACITY, IP_WINDOW, CHAT_GLOBAL_CAPACITY, GLOBAL_WINDOW);

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return req.socket.remoteAddress || 'unknown';
}

function log(method, path, status, started, note) {
  const ms = Date.now() - started;
  process.stdout.write(`${method} ${path} ${status} ${ms}ms${note ? ` ${note}` : ''}\n`);
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
  return status;
}

function sendText(res, status, text) {
  const body = `${text}\n`;
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-cache',
  });
  res.end(body);
  return status;
}

function fileFor(pathname) {
  if (pathname === '/') return resolve(DIST, 'index.html');
  if (pathname === '/design' || pathname === '/design.html') return resolve(DIST, 'design.html');
  const target = resolve(DIST, `.${pathname}`);
  if (target !== DIST && !target.startsWith(DIST + sep)) return null;
  return target;
}

async function serveStatic(res, pathname) {
  const file = fileFor(pathname);
  if (!file) return sendText(res, 404, 'not found');
  const info = await stat(file).catch(() => null);
  if (!info || !info.isFile()) return sendText(res, 404, 'not found');
  const ext = extname(file).toLowerCase();
  const headers = {
    'content-type': TYPES[ext] || 'application/octet-stream',
    'content-length': info.size,
  };
  if (pathname.startsWith('/assets/')) headers['cache-control'] = 'public, max-age=31536000, immutable';
  else if (ext === '.html') headers['cache-control'] = 'no-cache';
  res.writeHead(200, headers);
  await pipeline(createReadStream(file), res);
  return 200;
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((done) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk) => {
      if (over) return;
      size += chunk.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        done(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => done(over ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => done(null));
    req.on('close', () => done(null));
  });
}

function isPlain(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isText(value) {
  return typeof value === 'string';
}

function parseSpeak(text) {
  if (text === null || text.length > MAX_BODY) return null;
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlain(body) || !isPlain(body.npc) || !isPlain(body.world)) return null;
  const npc = body.npc;
  const world = body.world;
  if (!isText(npc.name) || !isText(npc.glyph) || !isText(npc.temperament) || !isText(npc.homeLetter)) return null;
  if (!isText(world.phase) || !isText(world.ground) || !isText(world.hint)) return null;
  if (typeof world.lettersFound !== 'number' || !Number.isFinite(world.lettersFound)) return null;
  const recent = world.recent === undefined ? [] : world.recent;
  if (!Array.isArray(recent) || recent.length > 3) return null;
  for (const line of recent) if (!isText(line)) return null;
  return {
    npc: {
      name: npc.name,
      glyph: npc.glyph,
      temperament: npc.temperament,
      homeLetter: npc.homeLetter,
    },
    world: {
      phase: world.phase,
      ground: world.ground,
      hint: world.hint,
      lettersFound: world.lettersFound,
      recent,
    },
  };
}

function clean(text) {
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseChat(text) {
  if (text === null || text.length > MAX_CHAT_BODY) return null;
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlain(body) || !isPlain(body.npc) || !isPlain(body.world)) return null;
  const npc = body.npc;
  const world = body.world;
  if (!isText(npc.name) || !NAME_PATTERN.test(npc.name)) return null;
  if (!isText(npc.glyph) || !GLYPH_PATTERN.test(npc.glyph)) return null;
  if (!TEMPERAMENTS.has(npc.temperament)) return null;
  if (!isText(npc.homeKind) || !KIND_PATTERN.test(npc.homeKind)) return null;
  if (!isText(npc.homeLetter) || !LETTER_PATTERN.test(npc.homeLetter)) return null;
  if (!PHASES.has(world.phase) || !GROUNDS.has(world.ground)) return null;
  if (!isText(world.hint) || world.hint.length > MAX_HINT) return null;
  if (!Number.isInteger(world.lettersFound) || world.lettersFound < 0 || world.lettersFound > 26) return null;
  if (typeof world.metBefore !== 'boolean') return null;
  if (!Array.isArray(body.history) || body.history.length > MAX_HISTORY) return null;
  const history = [];
  for (const entry of body.history) {
    if (!isPlain(entry) || !SPEAKERS.has(entry.who) || !isText(entry.text)) return null;
    if (entry.text.length > MAX_TEXT) return null;
    const said = clean(entry.text);
    if (!said) return null;
    history.push({ who: entry.who, text: said });
  }
  if (!isText(body.message) || body.message.length > MAX_TEXT) return null;
  return {
    npc: {
      name: npc.name,
      glyph: npc.glyph,
      temperament: npc.temperament,
      homeKind: npc.homeKind,
      homeLetter: npc.homeLetter,
    },
    world: {
      phase: world.phase,
      ground: world.ground,
      hint: clean(world.hint),
      lettersFound: world.lettersFound,
      metBefore: world.metBefore,
    },
    history,
    message: clean(body.message),
  };
}

function userTextFor(facts) {
  const lines = [
    `your name: ${facts.npc.name}`,
    `your glyph: ${facts.npc.glyph}`,
    `your temperament: ${facts.npc.temperament}`,
  ];
  if (facts.npc.homeLetter) lines.push(`the letter you live under: ${facts.npc.homeLetter}`);
  lines.push(`time of day: ${facts.world.phase}`);
  lines.push(`ground the traveller is standing on: ${facts.world.ground}`);
  if (facts.world.hint) lines.push(`something they have not found: ${facts.world.hint}`);
  lines.push(`letters they have found so far: ${facts.world.lettersFound}`);
  if (facts.world.recent.length > 0) lines.push(`do not repeat: ${facts.world.recent.join(' | ')}`);
  lines.push('reply with the sentence only');
  return lines.join('\n');
}

function tidy(raw) {
  let line = String(raw).toLowerCase().split('!').join('');
  const end = line.search(/[.?;\n]/);
  if (end >= 0) line = line.slice(0, end);
  line = line.replace(/\s+/g, ' ').trim().replace(/^["'`“‘]+/, '').replace(/["'`”’]+$/, '').trim();
  if (line.length > MAX_LINE) {
    line = line.slice(0, MAX_LINE);
    const space = line.lastIndexOf(' ');
    if (space > 0) line = line.slice(0, space);
    line = line.trim();
  }
  return line;
}

function homeText(npc) {
  if (npc.homeKind === 'letter') {
    return npc.homeLetter ? `under the giant letter ${npc.homeLetter.toUpperCase()}` : 'under one of the giant letters';
  }
  return HOMES.get(npc.homeKind) || 'near one of the landmarks';
}

function chatInstructions(turn) {
  const { npc, world } = turn;
  return [
    `You are ${npc.name}, a villager in a quiet, endless world made of punctuation.`,
    'The only capital letters in this world are giant letters standing on the hills. Villagers are lowercase letters who live near the landmarks: the giant letters, castles, rings of standing stones, lone tall trees, still pools and low stone shelters.',
    `You are the lowercase letter ${npc.glyph}, you are ${npc.temperament} by nature, and you live ${homeText(npc)}.`,
    world.metBefore
      ? 'You have talked with this traveller before and you remember them.'
      : 'You have never met this traveller before.',
    `It is ${world.phase}. The traveller is standing on ${GROUND_WORDS.get(world.ground)}. They have found ${world.lettersFound} of the 26 giant letters.`,
    world.hint
      ? `The nearest thing they have not found yet: ${world.hint}.`
      : 'You know of nothing close by that they have not found yet.',
    'Speak in lowercase only, with no exclamation marks, in one or two short sentences and never more than 200 characters.',
    'Stay in character: plain words, a little strange, like someone who has lived in one small place a long time.',
    'Answer what the traveller just said, using these facts. If they ask the way, where to go, or about letters or landmarks, point them toward the nearest thing they have not found yet, with its direction and how far it is. Never invent other places.',
    'You only know this world. If they talk about anything outside it, be gently puzzled and turn the talk back to the land, the light, the letters or the path.',
    'Never mention keys, controls, screens, games, players or being an AI, and never step outside the world.',
    'Do not repeat what you have already said.',
    'Words in brackets describe what the traveller does rather than what they say.',
    'Reply with your own words only, with no name in front and no quotation marks.',
  ].join('\n');
}

function chatInput(turn) {
  const input = turn.history.map((line) => ({
    role: line.who === 'player' ? 'user' : 'assistant',
    content: line.text,
  }));
  let last = turn.message;
  if (!last) {
    last = turn.history.length === 0
      ? '(the traveller comes up to you and waits)'
      : '(the traveller waits for you to say more)';
  }
  input.push({ role: 'user', content: last });
  return input;
}

function escapePattern(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tidyReply(raw, npc) {
  let text = String(raw).replace(/\s+/g, ' ').toLowerCase();
  text = text.replace(/\*[^*]*\*/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  text = text.replace(/!+(?=\s|$)/g, '.').split('!').join('');
  text = text.replace(/\s+/g, ' ').trim().replace(/^["'`“‘]+/, '').trim();
  const label = new RegExp(`^(${escapePattern(npc.name.toLowerCase())}|${escapePattern(npc.glyph)})\\s*[:—-]\\s*`);
  text = text.replace(label, '').replace(/^["'`“‘]+/, '').trim();
  const sentences = (text.match(/[^.?]+[.?]*/g) || [])
    .map((part) => part.trim())
    .filter((part) => /[a-z0-9]/.test(part));
  let line = sentences.slice(0, 2).join(' ');
  line = line.replace(/["'`”’]+$/, '').replace(/[.\s]+$/, '').trim();
  if (line.length > MAX_REPLY) {
    line = line.slice(0, MAX_REPLY);
    const space = line.lastIndexOf(' ');
    if (space > 0) line = line.slice(0, space);
    line = line.replace(/[\s,;:—-]+$/, '').trim();
  }
  return line;
}

function usageNote(usage, reason) {
  const parts = [];
  if (usage) {
    parts.push(`in=${usage.input_tokens ?? 0}`);
    parts.push(`out=${usage.output_tokens ?? 0}`);
    parts.push(`cache=${usage.input_tokens_details?.cached_tokens ?? 0}`);
  }
  if (reason) parts.push(reason);
  return parts.join(' ');
}

function errorName(error) {
  if (error instanceof OpenAI.RateLimitError) return 'RateLimitError';
  if (error instanceof OpenAI.AuthenticationError) return 'AuthenticationError';
  if (error instanceof OpenAI.APIError) return 'APIError';
  if (error && typeof error.name === 'string') return error.name;
  return 'Error';
}

function rejectsReasoning(error) {
  if (!(error instanceof OpenAI.APIError) || error.status !== 400) return false;
  return String(error.message || '').toLowerCase().includes('reasoning');
}

function callModel(userText, reasoning) {
  return client.responses.create(
    {
      model: MODEL,
      instructions: SYSTEM_PROMPT,
      input: userText,
      max_output_tokens: 120,
      ...(reasoning ? { reasoning: { effort: 'minimal' } } : {}),
    },
    { timeout: CALL_TIMEOUT },
  );
}

async function askModel(facts) {
  const userText = userTextFor(facts);
  const reasoning = MODEL.startsWith('gpt-5');
  let response = null;
  try {
    response = await callModel(userText, reasoning);
  } catch (error) {
    if (!reasoning || !rejectsReasoning(error)) throw error;
    response = await callModel(userText, false);
  }
  const usage = response.usage;
  const line = tidy(response.output_text ?? '');
  if (!line) return { line: null, usage, reason: 'empty' };
  return { line, usage, reason: null };
}

function callChat(turn, reasoning) {
  return client.responses.create(
    {
      model: MODEL,
      instructions: chatInstructions(turn),
      input: chatInput(turn),
      max_output_tokens: 400,
      store: false,
      ...(reasoning ? { reasoning: { effort: 'minimal' } } : {}),
    },
    { timeout: CHAT_TIMEOUT, maxRetries: 0 },
  );
}

async function askChatModel(turn) {
  const reasoning = MODEL.startsWith('gpt-5');
  let response = null;
  try {
    response = await callChat(turn, reasoning);
  } catch (error) {
    if (!reasoning || !rejectsReasoning(error)) throw error;
    response = await callChat(turn, false);
  }
  const usage = response.usage;
  const line = tidyReply(response.output_text ?? '', turn.npc);
  if (!line) return { line: null, usage, reason: 'empty' };
  return { line, usage, reason: null };
}

async function handleSpeak(req, res) {
  const facts = parseSpeak(await readBody(req));
  if (!facts) return { status: sendText(res, 400, 'bad request'), note: 'invalid' };
  if (!allow(clientIp(req))) return { status: sendJson(res, 429, { fallback: true }), note: 'rate limited' };
  if (!client) return { status: sendJson(res, 503, { fallback: true }), note: 'no key' };
  try {
    const result = await askModel(facts);
    if (!result.line) {
      return { status: sendJson(res, 502, { fallback: true }), note: usageNote(result.usage, result.reason) };
    }
    return { status: sendJson(res, 200, { line: result.line }), note: usageNote(result.usage, null) };
  } catch (error) {
    return { status: sendJson(res, 502, { fallback: true }), note: errorName(error) };
  }
}

async function handleChat(req, res) {
  const turn = parseChat(await readBody(req, MAX_CHAT_BODY));
  if (!turn) return { status: sendText(res, 400, 'bad request'), note: 'invalid' };
  if (!allowChat(clientIp(req))) return { status: sendJson(res, 429, { fallback: true }), note: 'rate limited' };
  if (!client) return { status: sendJson(res, 503, { fallback: true }), note: 'no key' };
  try {
    const result = await askChatModel(turn);
    if (!result.line) {
      return { status: sendJson(res, 502, { fallback: true }), note: usageNote(result.usage, result.reason) };
    }
    return { status: sendJson(res, 200, { line: result.line }), note: usageNote(result.usage, null) };
  } catch (error) {
    return { status: sendJson(res, 502, { fallback: true }), note: errorName(error) };
  }
}

async function handle(req, res, pathname) {
  if (pathname === '/api/health') {
    if (req.method !== 'GET') return { status: sendText(res, 405, 'method not allowed'), note: null };
    return { status: sendJson(res, 200, { ok: true, brain: client ? 'openai' : 'local' }), note: null };
  }
  if (pathname === '/api/npc/speak') {
    if (req.method !== 'POST') return { status: sendText(res, 405, 'method not allowed'), note: null };
    return handleSpeak(req, res);
  }
  if (pathname === '/api/npc/chat') {
    if (req.method !== 'POST') return { status: sendText(res, 405, 'method not allowed'), note: null };
    return handleChat(req, res);
  }
  if (req.method !== 'GET') return { status: sendText(res, 404, 'not found'), note: null };
  return { status: await serveStatic(res, pathname), note: null };
}

const server = createServer((req, res) => {
  const started = Date.now();
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://tilde.local').pathname);
  } catch {
    log(req.method, req.url, 400, started, 'bad path');
    sendText(res, 400, 'bad request');
    return;
  }
  handle(req, res, pathname).then(
    (result) => log(req.method, pathname, result.status, started, result.note),
    (error) => {
      const note = errorName(error);
      if (!res.headersSent) sendJson(res, 500, { ok: false });
      else res.end();
      log(req.method, pathname, 500, started, note);
    },
  );
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`tilde listening on ${HOST}:${PORT} dist=${DIST} brain=${client ? MODEL : 'local'}\n`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
});
