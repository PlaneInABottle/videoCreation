import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseCutBoundaries,
  chooseStructuralCutBoundaries,
  dimensionsForAspect,
  interleaveByQuery,
  payoffShotIndex,
  resolveSourceIn,
  transitionFor,
  validateAuthoredCutTimes,
} from './storyboard.js';

test('chooses nearby musical events without breaking minimum shot duration', () => {
  const boundaries = chooseCutBoundaries(12, 4, [2.9, 6.1, 8.95]);
  assert.deepEqual(boundaries, [0, 2.9, 6.1, 8.95, 12]);
  assert.ok(boundaries.every((value, index) => index === 0 || value > boundaries[index - 1]!));
});

test('builds varied pacing around one major musical payoff', () => {
  const boundaries = chooseStructuralCutBoundaries(
    20,
    10,
    [{ time: 13, kind: 'lift', strength: 2.1 }],
    [1, 2, 3, 5, 8, 10, 12, 13, 15, 18],
  );
  const durations = boundaries.slice(1).map((value, index) => value - boundaries[index]!);

  assert.equal(boundaries.length, 11);
  assert.ok(boundaries.includes(13));
  assert.ok(durations[0]! < durations[2]!);
  assert.ok(Math.max(...durations) - Math.min(...durations) > 1);
  assert.ok(boundaries.every((value, index) => index === 0 || value > boundaries[index - 1]!));
});

test('places the payoff on the first matching narrative function', () => {
  assert.equal(
    payoffShotIndex(
      [
        'motion-hook',
        'route-context',
        'machine-detail',
        'acceleration',
        'landmark-or-encounter',
        'arrival',
      ],
      8,
    ),
    6,
  );
});

test('uses denser cuts through builds and holds the peak', () => {
  const boundaries = chooseStructuralCutBoundaries(
    12,
    4,
    [{ time: 8, kind: 'lift', strength: 2 }],
    [],
    3,
    [
      { start: 0, end: 4, label: 'calm', energy: 0.1 },
      { start: 4, end: 8, label: 'build', energy: 0.2 },
      { start: 8, end: 12, label: 'peak', energy: 0.2 },
    ],
  );
  const durations = boundaries.slice(1).map((boundary, index) => boundary - boundaries[index]!);

  assert.equal(boundaries[3], 8);
  assert.ok(durations[1]! > durations[2]!);
  assert.equal(durations[3], 4);
});

test('returns project delivery dimensions', () => {
  assert.deepEqual(dimensionsForAspect('9:16'), { width: 1080, height: 1920 });
  assert.deepEqual(dimensionsForAspect('16:9'), { width: 1920, height: 1080 });
});

test('interleaves grouped source queries for visual variety', () => {
  const ordered = interleaveByQuery([
    { query: 'talk', id: 1 },
    { query: 'talk', id: 2 },
    { query: 'city', id: 3 },
    { query: 'city', id: 4 },
  ]);
  assert.deepEqual(
    ordered.map((item) => item.id),
    [1, 3, 2, 4],
  );
});

test('preserves a reviewed source start and rejects unusable ranges', () => {
  assert.equal(resolveSourceIn(4.25, 10, 0.17), 4.25);
  assert.equal(resolveSourceIn(undefined, 10, 0.17), 1.7);
  assert.throws(() => resolveSourceIn(10.5, 10, 0.17), /exceeds the usable range/);
});

test('accepts a complete authored major-wave cut map', () => {
  assert.deepEqual(validateAuthoredCutTimes([0, 1.5, 4, 8, 10], 10, 4), [0, 1.5, 4, 8, 10]);
  assert.throws(() => validateAuthoredCutTimes([0, 4, 3, 10], 10, 3), /strictly increasing/);
  assert.throws(() => validateAuthoredCutTimes([0, 4, 9], 10, 2), /must end at 10\.000s/);
});

test('uses hard cuts unless an editor explicitly authors a compatible transition', () => {
  assert.deepEqual(transitionFor(0, 3, 4), { type: 'cut', duration: 0 });
  assert.deepEqual(transitionFor(1, 3, 8, [{ time: 8, type: 'dissolve', duration: 0.2 }]), {
    type: 'dissolve',
    duration: 0.2,
  });
  assert.equal(transitionFor(2, 3, 10), null);
});
