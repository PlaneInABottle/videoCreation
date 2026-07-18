// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { RenderJobQueue } from './jobs.js';

async function waitForTerminal(queue: RenderJobQueue, id: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = queue.get(id)?.state;
    if (state === 'succeeded' || state === 'failed' || state === undefined) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`Job ${id} did not finish`);
}

describe('RenderJobQueue', () => {
  it('retains a bounded set of terminal job records', async () => {
    const queue = new RenderJobQueue(2);
    const jobs = Array.from({ length: 4 }, (_, index) =>
      queue.enqueue(`project-${index}`, 'final', async () => ({
        mediaUrl: `/output/${index}`,
      })),
    );

    await waitForTerminal(queue, jobs.at(-1)!.id);

    expect(queue.get(jobs[0]!.id)).toBeUndefined();
    expect(queue.get(jobs[1]!.id)).toBeUndefined();
    expect(queue.get(jobs[2]!.id)?.state).toBe('succeeded');
    expect(queue.get(jobs[3]!.id)?.state).toBe('succeeded');
  });

  it('supersedes an obsolete queued preview for the same project', async () => {
    let releaseFinal: (() => void) | undefined;
    const queue = new RenderJobQueue();
    const blocker = queue.enqueue(
      'another-project',
      'final',
      async () =>
        await new Promise<{ mediaUrl: string }>((resolve) => {
          releaseFinal = () => resolve({ mediaUrl: '/final' });
        }),
    );
    const obsolete = queue.enqueue('demo', 'preview', async () => ({ mediaUrl: '/old' }));
    const current = queue.enqueue('demo', 'preview', async () => ({ mediaUrl: '/new' }));

    expect(queue.get(obsolete.id)?.state).toBe('superseded');
    releaseFinal?.();
    await waitForTerminal(queue, blocker.id);
    await waitForTerminal(queue, current.id);
    expect(queue.get(current.id)?.state).toBe('succeeded');
  });
});
