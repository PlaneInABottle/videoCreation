// @vitest-environment node
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { AddressInfo } from 'node:net';
import type { Storyboard } from '@ai-video-creation/scripts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStudioApp } from './app.js';

const execute = promisify(execFile);
let root = '';
let baseUrl = '';
let closeServer: (() => Promise<void>) | undefined;

async function json(path: string, init?: RequestInit): Promise<{ response: Response; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { response, body: await response.json() };
}

beforeAll(async () => {
  root = await mkdtemp(resolve(tmpdir(), 'video-studio-api-'));
  await Promise.all([
    mkdir(resolve(root, 'projects', 'demo'), { recursive: true }),
    mkdir(resolve(root, 'knowledge'), { recursive: true }),
    mkdir(resolve(root, 'output'), { recursive: true }),
    mkdir(resolve(root, 'music'), { recursive: true }),
  ]);
  const source = resolve(root, 'projects', 'demo', 'source.mp4');
  const music = resolve(root, 'music', 'track.m4a');
  await execute('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=320x180:d=4',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=4',
    '-c:v',
    'libx264',
    '-c:a',
    'aac',
    '-shortest',
    source,
  ]);
  await execute('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=220:duration=8',
    '-c:a',
    'aac',
    music,
  ]);
  const storyboard: Storyboard = {
    schemaVersion: 1,
    projectId: 'demo',
    createdAt: '2026-07-18T00:00:00.000Z',
    videoTypeId: 'test',
    sourceMode: 'continuous-footage',
    aspect: '16:9',
    width: 1920,
    height: 1080,
    fps: 30,
    durationSeconds: 2,
    gradeId: 'neutral',
    title: 'Demo',
    music: {
      file: 'music/track.m4a',
      start: 0,
      beatMap: 'projects/demo/beat-map.json',
    },
    shots: [
      {
        id: 'one',
        source: 'projects/demo/source.mp4',
        query: 'fixture',
        sourceIn: 0,
        sourceDuration: 1,
        timelineIn: 0,
        timelineOut: 1,
        storyFunction: 'hook',
        anchorX: 0.5,
        anchorY: 0.5,
        transitionToNext: { type: 'cut', duration: 0 },
      },
      {
        id: 'two',
        source: 'projects/demo/source.mp4',
        query: 'fixture',
        sourceIn: 2,
        sourceDuration: 1,
        timelineIn: 1,
        timelineOut: 2,
        storyFunction: 'payoff',
        anchorX: 0.5,
        anchorY: 0.5,
        transitionToNext: null,
      },
    ],
    output: 'output/demo.mp4',
  };
  await Promise.all([
    writeFile(
      resolve(root, 'projects', 'demo', 'storyboard.json'),
      `${JSON.stringify(storyboard, null, 2)}\n`,
    ),
    writeFile(
      resolve(root, 'projects', 'demo', 'beat-map.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          source: 'music/track.m4a',
          sourceHash: 'fixture',
          excerpt: { start: 0, end: 2 },
          analyzer: { name: 'fixture', version: 1, sampleRate: 11025 },
          bpm: 120,
          confidence: 1,
          beats: [0, 0.5, 1, 1.5],
          onsets: [],
          energy: [],
          majorMoments: [{ time: 1, kind: 'lift', strength: 1 }],
          sections: [{ start: 0, end: 2, label: 'build', energy: 1 }],
          fallback: false,
        },
        null,
        2,
      )}\n`,
    ),
    writeFile(
      resolve(root, 'knowledge', 'color-grades.json'),
      `${JSON.stringify({
        grades: [
          {
            id: 'neutral',
            name: 'Neutral',
            intent: 'Fixture grade',
            ffmpegStartingPoint: 'null',
          },
        ],
      })}\n`,
    ),
    writeFile(
      resolve(root, 'output', 'demo.mp4'),
      await import('node:fs/promises').then((fs) => fs.readFile(source)),
    ),
  ]);

  const app = createStudioApp({
    root,
    render: async (_storyboard, options) => {
      if (!options.output) throw new Error('Test preview output is missing');
      await mkdir(resolve(options.output, '..'), { recursive: true });
      options.onProgress({ phase: 'compose' });
      await writeFile(options.output, 'preview');
      options.onProgress({ phase: 'complete' });
      return options.output;
    },
    evaluate: async () => ({}),
  });
  const server = createServer(app);
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = async () =>
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}, 30_000);

afterAll(async () => {
  await closeServer?.();
  await rm(root, { recursive: true, force: true });
});

describe('Studio API', () => {
  it('lists and loads storyboard projects with scoped media URLs', async () => {
    const projects = await json('/api/projects');
    expect(projects.response.status).toBe(200);
    expect(projects.body).toHaveLength(1);
    expect(projects.body[0]).toMatchObject({
      id: 'demo',
      outputAvailable: true,
      shotCount: 2,
    });

    const detail = await json('/api/projects/demo');
    expect(detail.response.status).toBe(200);
    expect(detail.body.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(detail.body.sources[0].mediaUrl).toContain('/shots/one/source');
    expect(detail.body.musicMediaUrl).toContain('/music/source');
  });

  it('supports media range requests', async () => {
    const response = await fetch(`${baseUrl}/api/projects/demo/output`, {
      headers: { Range: 'bytes=0-15' },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toMatch(/^bytes 0-15\//);

    const music = await fetch(`${baseUrl}/api/projects/demo/music/source`, {
      headers: { Range: 'bytes=0-15' },
    });
    expect(music.status).toBe(206);
    expect(music.headers.get('content-range')).toMatch(/^bytes 0-15\//);
  });

  it('serves generated timeline visuals from the hidden Studio cache', async () => {
    const thumbnail = await fetch(`${baseUrl}/api/projects/demo/shots/one/thumbnail`);
    const waveform = await fetch(`${baseUrl}/api/projects/demo/music/waveform`);

    expect(thumbnail.status).toBe(200);
    expect(thumbnail.headers.get('content-type')).toContain('image/jpeg');
    expect((await thumbnail.arrayBuffer()).byteLength).toBeGreaterThan(100);
    expect(waveform.status).toBe(200);
    expect(waveform.headers.get('content-type')).toContain('image/png');
    expect((await waveform.arrayBuffer()).byteLength).toBeGreaterThan(100);
  });

  it('saves a validated draft and rejects stale or unsafe changes', async () => {
    const loaded = await json('/api/projects/demo');
    loaded.body.draft.title = 'Changed safely';
    const saved = await json('/api/projects/demo/storyboard', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseRevision: loaded.body.revision,
        draft: loaded.body.draft,
      }),
    });
    expect(saved.response.status).toBe(200);
    expect(saved.body.storyboard.title).toBe('Changed safely');

    const stale = await json('/api/projects/demo/storyboard', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseRevision: loaded.body.revision,
        draft: loaded.body.draft,
      }),
    });
    expect(stale.response.status).toBe(409);

    const current = await json('/api/projects/demo');
    current.body.draft.shots[0].source = '../../etc/passwd';
    const unsafe = await json('/api/projects/demo/storyboard', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseRevision: current.body.revision,
        draft: current.body.draft,
      }),
    });
    expect(unsafe.response.status).toBe(400);
  });

  it('queues an unsaved proxy without mutating the canonical storyboard', async () => {
    const loaded = await json('/api/projects/demo');
    loaded.body.draft.subtitle = 'Unsaved preview';
    const queued = await json('/api/projects/demo/previews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseRevision: loaded.body.revision,
        draft: loaded.body.draft,
      }),
    });
    expect(queued.response.status).toBe(202);
    let job = queued.body;
    for (let attempt = 0; attempt < 20 && job.state !== 'succeeded'; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
      job = (await json(`/api/jobs/${job.id}`)).body;
    }
    expect(job.state).toBe('succeeded');
    expect(job.result.mediaUrl).toBe(`/api/jobs/${job.id}/media`);
    const canonical = await json('/api/projects/demo');
    expect(canonical.body.storyboard.subtitle).not.toBe('Unsaved preview');
  });

  it('rejects non-local mutation origins', async () => {
    const loaded = await json('/api/projects/demo');
    const response = await fetch(`${baseUrl}/api/projects/demo/previews`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://attacker.example',
      },
      body: JSON.stringify({
        baseRevision: loaded.body.revision,
        draft: loaded.body.draft,
      }),
    });
    expect(response.status).toBe(403);
  });

  it('rejects final renders from a stale saved revision', async () => {
    const response = await fetch(`${baseUrl}/api/projects/demo/renders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision: '0'.repeat(64) }),
    });

    expect(response.status).toBe(409);
  });

  it('serializes concurrent saves so only one writer can use a revision', async () => {
    const loaded = await json('/api/projects/demo');
    const firstDraft = structuredClone(loaded.body.draft);
    const secondDraft = structuredClone(loaded.body.draft);
    firstDraft.title = 'Concurrent first';
    secondDraft.title = 'Concurrent second';

    const responses = await Promise.all(
      [firstDraft, secondDraft].map(
        async (draft) =>
          await fetch(`${baseUrl}/api/projects/demo/storyboard`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ baseRevision: loaded.body.revision, draft }),
          }),
      ),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  });
});
