import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSegments, chooseSampleTimes, parseFrameRate, streamDuration } from './analyzer.js';

test('parses rational frame rates', () => {
  assert.equal(parseFrameRate('30000/1001').toFixed(3), '29.970');
  assert.equal(parseFrameRate('30/1'), 30);
});

test('uses stream duration instead of a longer container duration', () => {
  assert.equal(
    streamDuration({ index: 0, codec_type: 'video', duration: '7.533333' }, '18.000000'),
    7.533333,
  );
});

test('adds sparse interval and scene samples without exceeding the cap', () => {
  const samples = chooseSampleTimes(
    120,
    Array.from({ length: 80 }, (_, index) => index + 1),
  );
  assert.ok(samples.length <= 36);
  assert.equal(samples[0], 0.5);
  assert.ok(samples.every((time, index) => index === 0 || time > samples[index - 1]!));
});

test('builds useful mixed-content segment candidates', () => {
  assert.deepEqual(buildSegments(20, [1, 5, 5.5, 12, 19]), [
    { start: 0, end: 5, labels: [], classificationStatus: 'pending-ai-review' },
    { start: 5, end: 12, labels: [], classificationStatus: 'pending-ai-review' },
    { start: 12, end: 20, labels: [], classificationStatus: 'pending-ai-review' },
  ]);
});
