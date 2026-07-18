import { randomUUID } from 'node:crypto';
import type { JobKind, RenderJob, RenderJobResult } from '../shared/api.js';
import type { RenderProgress } from '@ai-video-creation/scripts';

type JobTask = (report: (progress: RenderProgress) => void) => Promise<RenderJobResult>;

interface QueuedTask {
  job: RenderJob;
  task: JobTask;
}

function now(): string {
  return new Date().toISOString();
}

export class RenderJobQueue {
  private readonly jobs = new Map<string, RenderJob>();
  private readonly queue: QueuedTask[] = [];
  private active = false;

  constructor(private readonly maxRetainedJobs = 100) {}

  private pruneCompleted(): void {
    if (this.jobs.size <= this.maxRetainedJobs) return;
    for (const [id, job] of this.jobs) {
      if (this.jobs.size <= this.maxRetainedJobs) break;
      if (job.state === 'succeeded' || job.state === 'failed' || job.state === 'superseded') {
        this.jobs.delete(id);
      }
    }
  }

  enqueue(projectId: string, kind: JobKind, task: JobTask): RenderJob {
    if (kind === 'preview') {
      for (const queued of this.queue) {
        if (queued.job.projectId === projectId && queued.job.kind === 'preview') {
          queued.job.state = 'superseded';
          queued.job.updatedAt = now();
        }
      }
      for (let index = this.queue.length - 1; index >= 0; index -= 1) {
        if (this.queue[index]?.job.state === 'superseded') this.queue.splice(index, 1);
      }
    }
    const timestamp = now();
    const job: RenderJob = {
      id: randomUUID(),
      projectId,
      kind,
      state: 'queued',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.jobs.set(job.id, job);
    this.pruneCompleted();
    this.queue.push({ job, task });
    void this.pump();
    return { ...job };
  }

  get(id: string): RenderJob | undefined {
    const job = this.jobs.get(id);
    return job ? structuredClone(job) : undefined;
  }

  private async pump(): Promise<void> {
    if (this.active) return;
    this.active = true;
    try {
      while (this.queue.length > 0) {
        const queued = this.queue.shift();
        if (!queued || queued.job.state === 'superseded') continue;
        queued.job.state = 'running';
        queued.job.updatedAt = now();
        this.pruneCompleted();
        try {
          const result = await queued.task((progress) => {
            queued.job.progress = { ...progress };
            queued.job.updatedAt = now();
          });
          queued.job.state = 'succeeded';
          queued.job.result = result;
        } catch (error) {
          queued.job.state = 'failed';
          queued.job.error = error instanceof Error ? error.message : String(error);
        }
        queued.job.updatedAt = now();
      }
    } finally {
      this.active = false;
    }
  }
}
