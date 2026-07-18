import { describe, expect, it, vi } from 'vitest';
import { PlaybackClock } from './playback-clock.js';

describe('PlaybackClock', () => {
  it('publishes finite timeline changes without React-owned frame state', () => {
    const clock = new PlaybackClock();
    const listener = vi.fn();
    const unsubscribe = clock.subscribe(listener);

    clock.set(1.25);
    clock.set(Number.NaN);
    clock.set(1.25001);
    expect(clock.getSnapshot()).toBe(1.25);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    clock.set(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
