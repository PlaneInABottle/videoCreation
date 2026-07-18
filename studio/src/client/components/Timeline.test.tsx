import { fireEvent, render, screen } from '@testing-library/react';
import type { StoryboardDraft } from '@ai-video-creation/scripts/types';
import { describe, expect, it, vi } from 'vitest';
import { PlaybackClock } from '../playback-clock.js';
import { snapTimelineValue } from '../timeline-math.js';
import { Timeline } from './Timeline.js';

function draft(): StoryboardDraft {
  return {
    schemaVersion: 1,
    projectId: 'timeline-test',
    createdAt: '2026-07-18T00:00:00.000Z',
    videoTypeId: 'test',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    gradeId: 'neutral',
    shots: [
      {
        id: 'one',
        source: 'one.mp4',
        query: 'one',
        sourceIn: 0,
        duration: 2,
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

describe('Timeline', () => {
  it('dispatches keyboard trims and toggles the authored snap control', () => {
    const dispatch = vi.fn();
    const onMagnet = vi.fn();
    const clock = new PlaybackClock();
    render(
      <Timeline
        draft={draft()}
        beatMap={null}
        sources={[]}
        selectedShotId="one"
        snapMode="major"
        dispatch={dispatch}
        clock={clock}
        onSnapMode={onMagnet}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText('Trim end of one'), {
      key: 'ArrowRight',
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'trim',
      index: 0,
      edge: 'end',
      delta: 0.1,
    });
    fireEvent.keyDown(screen.getByLabelText('Timeline playhead'), {
      key: 'ArrowRight',
    });
    expect(clock.getSnapshot()).toBe(0.1);
    fireEvent.click(screen.getByRole('button', { name: 'Beat snap' }));
    expect(onMagnet).toHaveBeenCalledWith('beat');
  });

  it('streams trim previews during a pointer gesture and commits once on release', () => {
    const dispatch = vi.fn();
    const clock = new PlaybackClock();
    Object.defineProperties(HTMLElement.prototype, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    render(
      <Timeline
        draft={draft()}
        beatMap={null}
        sources={[]}
        selectedShotId="one"
        snapMode="off"
        dispatch={dispatch}
        clock={clock}
        onSnapMode={vi.fn()}
      />,
    );

    const handle = screen.getByLabelText('Trim end of one');
    fireEvent(handle, new MouseEvent('pointerdown', { bubbles: true, clientX: 100 }));
    fireEvent(handle, new MouseEvent('pointermove', { bubbles: true, clientX: 136 }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'gesture-start' });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'gesture-trim',
      index: 0,
      edge: 'end',
      delta: 0.5,
    });
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'gesture-commit' });

    fireEvent(handle, new MouseEvent('pointerup', { bubbles: true, clientX: 136 }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'gesture-commit' });
    delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
    delete (HTMLElement.prototype as Partial<HTMLElement>).hasPointerCapture;
    delete (HTMLElement.prototype as Partial<HTMLElement>).releasePointerCapture;
  });

  it('rolls an internal cut while preserving the total sequence duration', () => {
    const dispatch = vi.fn();
    render(
      <Timeline
        draft={draft()}
        beatMap={null}
        sources={[]}
        selectedShotId="two"
        snapMode="off"
        dispatch={dispatch}
        clock={new PlaybackClock()}
        onSnapMode={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText('Roll cut before two'), {
      key: 'ArrowRight',
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'roll',
      index: 1,
      delta: 0.1,
    });
  });

  it('snaps within the visible threshold and leaves distant edits alone', () => {
    expect(snapTimelineValue(4.12, 10, [0, 4, 10], true)).toBe(4);
    expect(snapTimelineValue(4.2, 10, [0, 4, 10], true)).toBe(4.2);
    expect(snapTimelineValue(10.5, 10, [0, 4, 10], false)).toBe(10);
  });
});
