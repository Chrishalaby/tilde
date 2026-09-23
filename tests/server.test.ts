/// <reference types="node" />
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, request, type IncomingMessage, type Server } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const INDEX_BODY = '<!doctype html><title>tilde test index</title>';
const DESIGN_BODY = '<!doctype html><title>tilde test design</title>';

let child: ChildProcessWithoutNullStreams | null = null;
let dist = '';
let base = '';
let port = 0;

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.on('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const found = address && typeof address === 'object' ? address.port : 0;
      probe.close(() => done(found));
    });
  });
}

function rawGet(path: string): Promise<{ status: number; body: string }> {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res: IncomingMessage) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => done({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

function speakBody(): string {
  return JSON.stringify({
    npc: { name: 'Tova', glyph: 't', temperament: 'quiet', homeLetter: 'a' },
    world: {
      phase: 'noon',
      ground: 'grass',
      hint: 'a tall one to the north-east, a long walk, water in the way',
      lettersFound: 2,
      recent: ['it is quiet, that is the whole of it'],
    },
  });
}

function postSpeak(body: string, at = base): Promise<Response> {
  return fetch(`${at}/api/npc/speak`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

type Json = Record<string, unknown>;

function chatPayload(): Json {
  return {
    npc: { name: 'Goshes', glyph: 'g', temperament: 'curious', homeKind: 'castle', homeLetter: '' },
    world: {
      phase: 'noon',
      ground: 'grass',
      hint: 'a tall one to the north-east, a short walk',
      lettersFound: 3,
      metBefore: true,
    },
    history: [
      { who: 'npc', text: 'good, another pair of feet on the path' },
      { who: 'player', text: 'hello there' },
      { who: 'npc', text: 'hello to you too, i am goshes' },
    ],
    message: 'where is the nearest letter',
  };
}

function changed(edit: (body: Json) => void): string {
  const body = chatPayload();
  edit(body);
  return JSON.stringify(body);
}

function part(body: Json, key: 'npc' | 'world'): Json {
  return body[key] as Json;
}

function postChat(body: string, at = base): Promise<Response> {
  return fetch(`${at}/api/npc/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

async function waitForServer(at = base): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const res = await fetch(`${at}/api/health`);
      if (res.ok) return;
    } catch {
      void 0;
    }
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error('server did not start');
}

async function stop(proc: ChildProcessWithoutNullStreams | null): Promise<void> {
  if (!proc) return;
  const ended = new Promise((done) => proc.once('exit', done));
  proc.kill('SIGTERM');
  await Promise.race([ended, new Promise((done) => setTimeout(done, 3000))]);
  if (proc.exitCode === null) proc.kill('SIGKILL');
}

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'tilde-dist-'));
  await writeFile(join(dist, 'index.html'), INDEX_BODY);
  await writeFile(join(dist, 'design.html'), DESIGN_BODY);
  await mkdir(join(dist, 'assets'), { recursive: true });
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const env: Record<string, string | undefined> = { ...process.env, PORT: String(port), TILDE_DIST: dist };
  delete env.OPENAI_API_KEY;
  child = spawn('node', [resolve(ROOT, 'server/index.mjs')], { cwd: ROOT, env });
  child.stdout.resume();
  child.stderr.resume();
  await waitForServer();
}, 30000);

afterAll(async () => {
  await stop(child);
  child = null;
  if (dist) await rm(dist, { recursive: true, force: true });
});

describe('tilde server', () => {
  it('serves the built index with no-cache', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toBe(INDEX_BODY);
  });

  it('serves the design page with and without the extension', async () => {
    const clean = await fetch(`${base}/design`);
    expect(clean.status).toBe(200);
    expect(await clean.text()).toBe(DESIGN_BODY);
    const full = await fetch(`${base}/design.html`);
    expect(full.status).toBe(200);
    expect(await full.text()).toBe(DESIGN_BODY);
  });

  it('404s a missing asset', async () => {
    const res = await fetch(`${base}/assets/x.js`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/plain');
  });

  it('cannot be walked out of dist', async () => {
    const plain = await rawGet('/../package.json');
    expect(plain.status).toBe(404);
    expect(plain.body).not.toContain('"name"');
    const encoded = await rawGet('/%2e%2e/package.json');
    expect(encoded.status).toBe(404);
    expect(encoded.body).not.toContain('"name"');
  });

  it('reports the local brain when no key is configured', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, brain: 'local' });
  });

  it('asks the client to fall back when there is no key', async () => {
    const res = await postSpeak(speakBody());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ fallback: true });
  });

  it('rejects a body that is not the agreed shape', async () => {
    const res = await postSpeak(JSON.stringify({ npc: { name: 'Tova' }, world: { phase: 3 } }));
    expect(res.status).toBe(400);
  });

  it('rate limits a single visitor', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await postSpeak(speakBody());
      codes.push(res.status);
      await res.arrayBuffer();
    }
    expect(codes[11 - 1]).toBe(429);
    expect(codes.filter((code) => code === 503).length).toBeGreaterThan(0);
  });
});

describe('villager chat without a key', () => {
  it('asks the client to fall back when there is no key', async () => {
    const res = await postChat(JSON.stringify(chatPayload()));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ fallback: true });
  });

  it('accepts twelve lines of history at the longest and an empty message', async () => {
    const res = await postChat(changed((body) => {
      body.history = Array.from({ length: 12 }, (_, i) => ({ who: i % 2 === 0 ? 'npc' : 'player', text: 'a'.repeat(240) }));
      body.message = '';
    }));
    expect(res.status).toBe(503);
    await res.arrayBuffer();
  });

  it('only answers a post', async () => {
    const res = await fetch(`${base}/api/npc/chat`);
    expect(res.status).toBe(405);
  });

  it('rejects every body that is not the agreed shape', async () => {
    const bad: Array<[string, string]> = [
      ['not json', '{"npc":'],
      ['an array', '[]'],
      ['no npc', changed((b) => { delete b.npc; })],
      ['a name with digits', changed((b) => { part(b, 'npc').name = 'G0shes'; })],
      ['a long name', changed((b) => { part(b, 'npc').name = 'G'.repeat(25); })],
      ['two glyphs', changed((b) => { part(b, 'npc').glyph = 'gg'; })],
      ['an unknown temperament', changed((b) => { part(b, 'npc').temperament = 'angry'; })],
      ['a shouted home', changed((b) => { part(b, 'npc').homeKind = 'CASTLE'; })],
      ['a numeric home', changed((b) => { part(b, 'npc').homeKind = 4; })],
      ['a long home letter', changed((b) => { part(b, 'npc').homeLetter = 'kk'; })],
      ['an unknown phase', changed((b) => { part(b, 'world').phase = 'midnight'; })],
      ['an unknown ground', changed((b) => { part(b, 'world').ground = 'lava'; })],
      ['a long hint', changed((b) => { part(b, 'world').hint = 'h'.repeat(201); })],
      ['too many letters', changed((b) => { part(b, 'world').lettersFound = 27; })],
      ['a fraction of a letter', changed((b) => { part(b, 'world').lettersFound = 2.5; })],
      ['letters as text', changed((b) => { part(b, 'world').lettersFound = '3'; })],
      ['met as text', changed((b) => { part(b, 'world').metBefore = 'yes'; })],
      ['no met', changed((b) => { delete part(b, 'world').metBefore; })],
      ['history as text', changed((b) => { b.history = 'hello'; })],
      ['thirteen lines of history', changed((b) => { b.history = Array.from({ length: 13 }, () => ({ who: 'npc', text: 'hm' })); })],
      ['a narrator', changed((b) => { b.history = [{ who: 'narrator', text: 'hm' }]; })],
      ['a long line', changed((b) => { b.history = [{ who: 'player', text: 'a'.repeat(241) }]; })],
      ['an empty line', changed((b) => { b.history = [{ who: 'player', text: '   ' }]; })],
      ['a line that is not an object', changed((b) => { b.history = ['hello']; })],
      ['no message', changed((b) => { delete b.message; })],
      ['a long message', changed((b) => { b.message = 'm'.repeat(241); })],
      ['a numeric message', changed((b) => { b.message = 7; })],
      ['a body over eight kilobytes', changed((b) => { b.pad = 'x'.repeat(9000); })],
      ['wide characters over eight kilobytes', changed((b) => {
        b.history = Array.from({ length: 12 }, () => ({ who: 'player', text: '字'.repeat(240) }));
      })],
    ];
    for (const [what, body] of bad) {
      const res = await postChat(body);
      expect({ what, status: res.status }).toEqual({ what, status: 400 });
      await res.arrayBuffer();
    }
  });

  it('rate limits a single visitor at about twenty a minute', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 25; i++) {
      const res = await postChat(JSON.stringify(chatPayload()));
      codes.push(res.status);
      await res.arrayBuffer();
    }
    expect(codes[0]).toBe(503);
    expect(codes[codes.length - 1]).toBe(429);
    const served = codes.filter((code) => code === 503).length;
    expect(served).toBeGreaterThanOrEqual(15);
    expect(served).toBeLessThanOrEqual(20);
    const speak = await postSpeak(speakBody());
    expect(speak.status).not.toBe(400);
    await speak.arrayBuffer();
  });
});

describe('villager chat with a model', () => {
  let model: Server | null = null;
  let keyed: ChildProcessWithoutNullStreams | null = null;
  let keyedBase = '';
  let reply = '';
  const seen: Array<{ path: string; body: Json }> = [];

  beforeAll(async () => {
    model = createHttpServer((req, res) => {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        raw += chunk;
      });
      req.on('end', () => {
        seen.push({ path: req.url ?? '', body: JSON.parse(raw) as Json });
        const text = JSON.stringify({
          id: 'resp_test',
          object: 'response',
          created_at: 0,
          status: 'completed',
          model: 'gpt-5-mini',
          output: [{
            type: 'message',
            id: 'msg_test',
            status: 'completed',
            role: 'assistant',
            content: [{ type: 'output_text', text: reply, annotations: [] }],
          }],
          usage: {
            input_tokens: 40,
            output_tokens: 12,
            total_tokens: 52,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        });
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
        res.end(text);
      });
    });
    const server = model;
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
    const modelPort = (server.address() as AddressInfo).port;
    const keyedPort = await freePort();
    keyedBase = `http://127.0.0.1:${keyedPort}`;
    const env: Record<string, string | undefined> = {
      ...process.env,
      PORT: String(keyedPort),
      TILDE_DIST: dist,
      OPENAI_API_KEY: 'test-key',
      OPENAI_BASE_URL: `http://127.0.0.1:${modelPort}/v1`,
    };
    delete env.OPENAI_MODEL;
    keyed = spawn('node', [resolve(ROOT, 'server/index.mjs')], { cwd: ROOT, env });
    keyed.stdout.resume();
    keyed.stderr.resume();
    await waitForServer(keyedBase);
  }, 30000);

  afterAll(async () => {
    await stop(keyed);
    keyed = null;
    const server = model;
    if (server) await new Promise((done) => server.close(done));
    model = null;
  });

  it('reports the model voice', async () => {
    const res = await fetch(`${keyedBase}/api/health`);
    expect(await res.json()).toEqual({ ok: true, brain: 'openai' });
  });

  it('answers in at most two short lowercase sentences, in character', async () => {
    reply = 'Goshes: Hello! The letter K stands to the North-East, a short walk. Go past the pool. Mind the water.';
    seen.length = 0;
    const res = await postChat(JSON.stringify(chatPayload()), keyedBase);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ line: 'hello. the letter k stands to the north-east, a short walk' });
    expect(seen.length).toBe(1);
    expect(seen[0].path).toBe('/v1/responses');
    const sent = seen[0].body;
    expect(sent.model).toBe('gpt-5-mini');
    expect(sent.store).toBe(false);
    expect(sent.reasoning).toEqual({ effort: 'minimal' });
    const instructions = String(sent.instructions);
    for (const fact of ['Goshes', 'lowercase letter g', 'curious', 'by the castle', 'noon', 'grass', '3 of the 26',
      'a tall one to the north-east, a short walk', 'talked with this traveller before', 'no exclamation marks',
      'two short sentences', '200 characters', 'being an AI']) {
      expect(instructions).toContain(fact);
    }
    expect(instructions).not.toContain('where is the nearest letter');
    expect(sent.input).toEqual([
      { role: 'assistant', content: 'good, another pair of feet on the path' },
      { role: 'user', content: 'hello there' },
      { role: 'assistant', content: 'hello to you too, i am goshes' },
      { role: 'user', content: 'where is the nearest letter' },
    ]);
  });

  it('asks the villager to go on when the traveller says nothing', async () => {
    reply = '*smiles* The wind comes off the hill here; it always has!';
    seen.length = 0;
    const res = await postChat(changed((b) => {
      b.message = '';
      part(b, 'world').metBefore = false;
    }), keyedBase);
    expect(await res.json()).toEqual({ line: 'the wind comes off the hill here; it always has' });
    const input = seen[0].body.input as Array<{ role: string; content: string }>;
    expect(input[input.length - 1].role).toBe('user');
    expect(input[input.length - 1].content).toContain('waits');
    expect(String(seen[0].body.instructions)).toContain('never met this traveller');
  });

  it('keeps a long answer under two hundred characters', async () => {
    reply = 'there is a long road '.repeat(20);
    const res = await postChat(JSON.stringify(chatPayload()), keyedBase);
    const body = (await res.json()) as { line: string };
    expect(body.line.length).toBeLessThanOrEqual(200);
    expect(body.line.startsWith('there is a long road')).toBe(true);
  });

  it('falls back when the model says nothing usable', async () => {
    reply = '*nods slowly* (says nothing)';
    const res = await postChat(JSON.stringify(chatPayload()), keyedBase);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ fallback: true });
  });

  it('still voices a passing line', async () => {
    reply = 'Hello! Nice day. Stay a while.';
    const res = await postSpeak(speakBody(), keyedBase);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ line: 'hello nice day' });
  });
});
