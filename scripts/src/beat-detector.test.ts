import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBeatGrid,
  chooseExcerptStart,
  deriveMusicSections,
  detectMajorMoments,
  detectOnsets,
  estimateTempo,
  extractEnvelope,
  selectFeaturedMoment,
} from './beat-detector.js';

test('detects a regular 120 BPM impulse train', () => {
  const sampleRate = 11_025;
  const samples = new Float32Array(sampleRate * 12);
  for (let time = 0.5; time < 12; time += 0.5) {
    const start = Math.round(time * sampleRate);
    for (let index = 0; index < 120; index += 1) samples[start + index] = 0.9;
  }
  const { novelty } = extractEnvelope(samples);
  const tempo = estimateTempo(novelty);
  const onsets = detectOnsets(novelty);
  const beats = buildBeatGrid(novelty, tempo.period, 12);

  assert.ok(tempo.bpm >= 115 && tempo.bpm <= 125, `detected ${tempo.bpm} BPM`);
  assert.ok(onsets.length >= 18);
  assert.ok(beats.length >= 20);
});

test('finds large musical lifts and releases instead of treating every pulse as important', () => {
  const framesPerSecond = 11_025 / 256;
  const frameCount = Math.round(framesPerSecond * 30);
  const energy = Array.from({ length: frameCount }, (_, index) => {
    const time = index / framesPerSecond;
    if (time < 10) return 0.08;
    if (time < 14) return 0.08 + ((time - 10) / 4) * 0.3;
    if (time < 22) return 0.38;
    return 0.1;
  });
  const novelty = energy.map((_, index) =>
    Math.abs(index / framesPerSecond - 14) < 0.03 ? 0.9 : 0.01,
  );

  const moments = detectMajorMoments(energy, novelty);
  const sections = deriveMusicSections(energy);

  assert.ok(
    moments.some((moment) => moment.kind === 'lift' && moment.time >= 10 && moment.time <= 15),
  );
  assert.ok(
    moments.some((moment) => moment.kind === 'release' && moment.time >= 20 && moment.time <= 24),
  );
  assert.ok(sections.some((section) => section.label === 'build'));
  assert.ok(sections.some((section) => section.label === 'peak'));
});

test('selects the earliest strong non-release moment away from intros and outros', () => {
  const featured = selectFeaturedMoment(
    [
      { time: 4, kind: 'impact', strength: 4 },
      { time: 100, kind: 'lift', strength: 2.2 },
      { time: 200, kind: 'peak', strength: 3.5 },
      { time: 390, kind: 'impact', strength: 5 },
    ],
    400,
    20,
  );

  assert.equal(featured?.time, 100);
});

test('keeps a designed opening with an early strong lift', () => {
  const start = chooseExcerptStart(
    { bpm: 94, majorMoments: [{ time: 0.75, kind: 'lift', strength: 2.3 }] },
    300,
    20,
  );

  assert.equal(start, 0);
});

test('backs up from a later structural event by complete bars', () => {
  const start = chooseExcerptStart(
    { bpm: 120, majorMoments: [{ time: 40, kind: 'lift', strength: 2.3 }] },
    180,
    20,
  );

  assert.equal(start, 36);
});
