import { render, screen, waitFor } from '@testing-library/react';
import type { StoryboardDraft } from '@ai-video-creation/scripts/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybackClock } from '../playback-clock.js';
import { Monitor } from './Monitor.js';

function draft(firstDuration = 2): StoryboardDraft {
  return {
    schemaVersion: 1,
    projectId: 'monitor-test',
    createdAt: '2026-07-18T00:00:00.000Z',
    videoTypeId: 'test',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    gradeId: 'neutral',
    title: 'City / after dark',
    subtitle: 'A night in motion',
    titlePlan: {
      timelineIn: 0.5,
      timelineOut: 2.5,
      anchorX: 0.5,
      anchorY: 0.72,
    },
    shots: [
      {
        id: 'one',
        source: 'one.mp4',
        query: 'one',
        sourceIn: 0,
        duration: firstDuration,
        storyFunction: 'hook',
        anchorX: 0.5,
        anchorY: 0.5,
        transitionToNext: { type: 'cut', duration: 0 },
      },
      {
        id: 'two',
        source: 'two.mp4',
        query: 'two',
        sourceIn: 0,
        duration: 2,
        storyFunction: 'payoff',
        anchorX: 0.5,
        anchorY: 0.5,
        transitionToNext: null,
      },
    ],
    output: 'output/test.mp4',
  };
}

const sources = [
  { shotId: 'one', source: 'one.mp4', available: true, mediaUrl: '/one.mp4' },
  { shotId: 'two', source: 'two.mp4', available: true, mediaUrl: '/two.mp4' },
];

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('Monitor', () => {
  it('uses live edit mode for a stale draft and follows changed cut boundaries', () => {
    const clock = new PlaybackClock();
    clock.set(1.5);
    const view = render(
      <Monitor
        source="/rendered.mp4"
        draft={draft()}
        sources={sources}
        aspect="9:16"
        duration={4}
        stale
        clock={clock}
      />,
    );

    expect(screen.getByRole('button', { name: 'Live edit' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByText('CITY / AFTER DARK').textContent).toBe('CITY / AFTER DARK');
    expect(document.querySelector('[data-shot-id="one"]')?.classList.contains('is-active')).toBe(
      true,
    );

    view.rerender(
      <Monitor
        source="/rendered.mp4"
        draft={draft(1)}
        sources={sources}
        aspect="9:16"
        duration={3}
        stale
        clock={clock}
      />,
    );

    expect(document.querySelector('[data-shot-id="two"]')?.classList.contains('is-active')).toBe(
      true,
    );
  });

  it('returns to the exact rendered proxy when it becomes current', async () => {
    const clock = new PlaybackClock();
    const view = render(
      <Monitor
        source="/rendered.mp4"
        draft={draft()}
        sources={sources}
        aspect="9:16"
        duration={4}
        stale
        clock={clock}
      />,
    );

    view.rerender(
      <Monitor
        source="/rendered.mp4"
        draft={draft()}
        sources={sources}
        aspect="9:16"
        duration={4}
        stale={false}
        clock={clock}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Rendered' }).getAttribute('aria-pressed')).toBe(
        'true',
      ),
    );
  });
});
