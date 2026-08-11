import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { StoryboardDraft } from '@ai-video-creation/scripts/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybackClock } from '../playback-clock.js';
import { Monitor, shouldCorrectMediaTime } from './Monitor.js';

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

function makeVideoReady(shotId: string, currentTime: number) {
  const video = document.querySelector<HTMLVideoElement>(`[data-shot-id="${shotId}"]`);
  expect(video).not.toBeNull();
  Object.defineProperties(video!, {
    readyState: { configurable: true, get: () => 4 },
    seeking: { configurable: true, get: () => false },
  });
  video!.currentTime = currentTime;
}

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

  it('honors a backward timeline seek while the live edit is playing', async () => {
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const clock = new PlaybackClock();
    clock.set(2.5);
    render(
      <Monitor draft={draft()} sources={sources} aspect="9:16" duration={4} stale clock={clock} />,
    );
    makeVideoReady('two', 0.5);

    fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
    await waitFor(() => expect(requestFrame).toHaveBeenCalled());
    expect(document.querySelector('[data-shot-id="two"]')?.classList.contains('is-active')).toBe(
      true,
    );

    clock.set(0.5);

    expect(document.querySelector('[data-shot-id="one"]')?.classList.contains('is-active')).toBe(
      true,
    );
    expect(document.querySelector('[data-shot-id="two"]')?.classList.contains('is-active')).toBe(
      false,
    );
  });

  it('advances across a scene boundary when the live audio playhead stalls', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(performance, 'now').mockReturnValue(1_000);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const clock = new PlaybackClock();
    const musicDraft = draft();
    musicDraft.music = {
      file: 'music.mp3',
      start: 100,
      beatMap: 'beat-map.json',
    };
    render(
      <Monitor
        draft={musicDraft}
        sources={sources}
        musicSource="/music.mp3"
        aspect="9:16"
        duration={4}
        stale
        clock={clock}
      />,
    );
    const audio = document.querySelector('audio');
    expect(audio).not.toBeNull();
    Object.defineProperties(audio!, {
      paused: { configurable: true, get: () => false },
      currentTime: { configurable: true, get: () => 100 },
    });
    makeVideoReady('one', 0);
    const secondVideo = document.querySelector<HTMLVideoElement>('[data-shot-id="two"]');
    expect(secondVideo).not.toBeNull();
    let secondVideoTime = 0;
    let secondVideoSeekCount = 0;
    Object.defineProperties(secondVideo!, {
      readyState: { configurable: true, get: () => 4 },
      seeking: { configurable: true, get: () => false },
      currentTime: {
        configurable: true,
        get: () => secondVideoTime,
        set: (value: number) => {
          secondVideoTime = value;
          secondVideoSeekCount += 1;
        },
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    act(() => frames.shift()?.(3_100));
    act(() => frames.shift()?.(3_300));

    expect(clock.getSnapshot()).toBeCloseTo(2.3, 3);
    expect(document.querySelector('[data-shot-id="two"]')?.classList.contains('is-active')).toBe(
      true,
    );
    expect(secondVideoSeekCount).toBe(1);
  });

  it('does not restart a media seek that is already in progress', () => {
    expect(shouldCorrectMediaTime(1, 2, true, 0.08)).toBe(false);
    expect(shouldCorrectMediaTime(1, 2, false, 0.08)).toBe(true);
  });
});
