import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { evaluateStoryboard, projectRoot, renderStoryboard } from '@ai-video-creation/scripts';
import type { RenderProgress, Storyboard, StoryboardDraft } from '@ai-video-creation/scripts';
import { ensureMusicWaveform, ensureShotThumbnail } from './media-cache.js';
import { RenderJobQueue } from './jobs.js';
import { ProjectStore, RevisionConflictError } from './project-store.js';
import {
  finalRenderRequestSchema,
  previewRequestSchema,
  saveDraftRequestSchema,
} from './schema.js';

type RenderFunction = (
  storyboard: Storyboard,
  options: {
    profile: 'proxy' | 'final';
    output?: string;
    onProgress: (progress: RenderProgress) => void;
  },
) => Promise<string>;

export interface StudioServices {
  root?: string;
  store?: ProjectStore;
  jobs?: RenderJobQueue;
  render?: RenderFunction;
  evaluate?: (storyboardPath: string) => Promise<unknown>;
}

function localHostname(value: string): boolean {
  return value === '127.0.0.1' || value === 'localhost' || value === '::1' || value === '[::1]';
}

function requireLocalMutation(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  if (!localHostname(req.hostname)) {
    res.status(403).json({ error: 'Studio mutations are restricted to localhost' });
    return;
  }
  const origin = req.get('origin');
  if (origin) {
    try {
      if (!localHostname(new URL(origin).hostname)) {
        res.status(403).json({ error: 'Cross-origin Studio mutations are not allowed' });
        return;
      }
    } catch {
      res.status(403).json({ error: 'Invalid request origin' });
      return;
    }
  }
  next();
}

function sendMedia(res: Response, path: string): void {
  res.sendFile(
    path,
    {
      acceptRanges: true,
      cacheControl: true,
      dotfiles: 'allow',
      maxAge: 0,
    },
    (error: Error & { statusCode?: number }) => {
      if (error && !res.headersSent) {
        res.status(error.statusCode ?? 404).json({ error: 'Media not found' });
      }
    },
  );
}

async function prunePreviewFiles(directory: string, keep: string, limit = 12): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.mp4'))
      .map(async (entry) => {
        const path = resolve(directory, entry.name);
        return { path, modifiedAt: (await stat(path)).mtimeMs };
      }),
  );
  files.sort((left, right) => {
    if (left.path === keep) return -1;
    if (right.path === keep) return 1;
    return right.modifiedAt - left.modifiedAt;
  });
  await Promise.all(files.slice(limit).map(async (file) => await rm(file.path, { force: true })));
}

export function createStudioApp(services: StudioServices = {}): express.Express {
  const root = services.root ?? projectRoot;
  const store = services.store ?? new ProjectStore(root);
  const jobs = services.jobs ?? new RenderJobQueue();
  const previewPaths = new Map<string, string>();
  const render = services.render ?? renderStoryboard;
  const evaluate = services.evaluate ?? evaluateStoryboard;
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(requireLocalMutation);

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/projects', async (_req, res, next) => {
    try {
      res.json(await store.list());
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/projects/:id', async (req, res, next) => {
    try {
      res.json(await store.detail(req.params.id!));
    } catch (error) {
      next(error);
    }
  });
  app.put('/api/projects/:id/storyboard', async (req, res, next) => {
    try {
      const body = saveDraftRequestSchema.parse(req.body) as {
        baseRevision: string;
        draft: StoryboardDraft;
      };
      res.json(await store.saveDraft(req.params.id!, body.baseRevision, body.draft));
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/projects/:id/previews', async (req, res, next) => {
    try {
      const id = req.params.id!;
      const body = previewRequestSchema.parse(req.body) as {
        baseRevision: string;
        draft: StoryboardDraft;
      };
      const prepared = await store.prepareDraft(id, body.baseRevision, body.draft);
      const output = resolve(store.studioCache, 'previews', id, `${prepared.draftHash}.mp4`);
      const previewDirectory = dirname(output);
      await mkdir(previewDirectory, { recursive: true });
      const job = jobs.enqueue(id, 'preview', async (report) => {
        await render(prepared.storyboard, {
          profile: 'proxy',
          output,
          onProgress: report,
        });
        await prunePreviewFiles(previewDirectory, output);
        return {
          mediaUrl: `/api/jobs/__JOB_ID__/media`,
          ...(prepared.beatMap ? { beatMap: prepared.beatMap } : {}),
        };
      });
      previewPaths.set(job.id, output);
      if (previewPaths.size > 100) {
        for (const [previewJobId] of previewPaths) {
          const retained = jobs.get(previewJobId);
          if (!retained || retained.state === 'succeeded' || retained.state === 'failed') {
            previewPaths.delete(previewJobId);
            break;
          }
        }
      }
      res.status(202).json(job);
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/projects/:id/renders', async (req, res, next) => {
    try {
      const id = req.params.id!;
      const body = finalRenderRequestSchema.parse(req.body);
      await store.assertRevision(id, body.revision);
      const job = jobs.enqueue(id, 'final', async (report) => {
        return await store.withProjectLock(id, async () => {
          const currentStoryboard = await store.assertRevision(id, body.revision);
          await render(currentStoryboard, { profile: 'final', onProgress: report });
          await evaluate(`projects/${id}/storyboard.json`);
          return {
            mediaUrl: `/api/projects/${encodeURIComponent(id)}/output`,
            revision: body.revision,
          };
        });
      });
      res.status(202).json(job);
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id!);
    if (!job) {
      res.status(404).json({ error: 'Render job not found' });
      return;
    }
    if (job.result?.mediaUrl.includes('__JOB_ID__')) {
      job.result.mediaUrl = job.result.mediaUrl.replace('__JOB_ID__', job.id);
    }
    res.json(job);
  });
  app.get('/api/jobs/:id/media', (req, res) => {
    const job = jobs.get(req.params.id!);
    if (!job || job.kind !== 'preview' || job.state !== 'succeeded') {
      res.status(404).json({ error: 'Preview media is not available' });
      return;
    }
    const path = previewPaths.get(job.id);
    if (!path) {
      res.status(404).json({ error: 'Preview media is not available' });
      return;
    }
    sendMedia(res, path);
  });
  app.get('/api/projects/:id/output', async (req, res, next) => {
    try {
      sendMedia(res, await store.outputPath(req.params.id!));
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/projects/:id/shots/:shotId/source', async (req, res, next) => {
    try {
      sendMedia(res, await store.sourcePath(req.params.id!, req.params.shotId!));
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/projects/:id/shots/:shotId/thumbnail', async (req, res, next) => {
    try {
      sendMedia(res, await ensureShotThumbnail(store, req.params.id!, req.params.shotId!));
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/projects/:id/music/waveform', async (req, res, next) => {
    try {
      sendMedia(res, await ensureMusicWaveform(store, req.params.id!));
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/projects/:id/music/source', async (req, res, next) => {
    try {
      sendMedia(res, await store.musicPath(req.params.id!));
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/projects/:id/quality/:asset', (req, res, next) => {
    try {
      sendMedia(res, store.qualityAssetPath(req.params.id!, req.params.asset!));
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof RevisionConflictError) {
      res.status(409).json({ error: error.message });
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({
        error: 'Request validation failed',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }
    const message = error instanceof Error ? error.message : 'Unexpected Studio error';
    const status = /not found/i.test(message) ? 404 : 400;
    res.status(status).json({ error: message });
  });

  return app;
}
