import assert from 'node:assert/strict';
import test from 'node:test';
import {
  featuredMomentTime,
  featuredMomentTimingWarning,
  nearestOffsetMs,
  sourceRepetitionWarning,
} from './quality.js';
import type { BeatMap } from './types.js';

test('measures the nearest musical event offset in milliseconds', () => {
  assert.ok(Math.abs(nearestOffsetMs(2, [0.5, 1.95, 2.5]) - 50) < 0.001);
  assert.equal(nearestOffsetMs(2, []), Number.POSITIVE_INFINITY);
});

test('treats an opening peak as an immediate featured musical moment', () => {
  const beatMap = {
    sections: [{ start: 0, end: 2, label: 'peak', energy: 0.8 }],
    majorMoments: [{ time: 8, kind: 'lift', strength: 2 }],
  } as BeatMap;

  assert.equal(featuredMomentTime(beatMap), 0);
});

test('reports the earliest strong featured moment when the excerpt starts quietly', () => {
  const beatMap = {
    sections: [{ start: 0, end: 2, label: 'calm', energy: 0.2 }],
    majorMoments: [
      { time: 3, kind: 'impact', strength: 0.5 },
      { time: 6, kind: 'lift', strength: 2.2 },
      { time: 10, kind: 'peak', strength: 2.7 },
    ],
  } as BeatMap;

  assert.equal(featuredMomentTime(beatMap), 6);
});

test('allows a musical payoff after an intentional setup', () => {
  assert.equal(featuredMomentTimingWarning(9, 'payoff'), null);
  assert.match(featuredMomentTimingWarning(2, 'payoff') ?? '', /before enough anticipation/);
  assert.match(featuredMomentTimingWarning(13, 'payoff') ?? '', /more than twelve seconds/);
});

test('rejects repeated stock clips but allows one continuous source', () => {
  assert.match(sourceRepetitionWarning('stock-montage', 8, 6) ?? '', /repeats source footage/);
  assert.equal(sourceRepetitionWarning('continuous-footage', 8, 1), null);
  assert.equal(sourceRepetitionWarning('stock-montage', 8, 8), null);
});
