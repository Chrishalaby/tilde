/// <reference types="node" />
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request, type IncomingMessage } from 'node:http';
import { createServer } from 'node:net';
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

function postSpeak(body: string): Promise<Response> {
  return fetch(`${base}/api/npc/speak`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      void 0;
    }
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error('server did not start');
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
  if (child) {
    const ended = new Promise((done) => child?.once('exit', done));
    child.kill('SIGTERM');
    await Promise.race([ended, new Promise((done) => setTimeout(done, 3000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
    child = null;
  }
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
