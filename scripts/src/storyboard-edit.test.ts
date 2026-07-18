import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileStoryboardDraft,
  reorderDraftShots,
  rollDraftCut,
  rippleTrimDraftShot,
  slipDraftShot,
  storyboardToDraft,
} from './storyboard-edit.js';
import type { Storyboard } from './types.js';

function storyboard(): Storyboard {
  return {
    schemaVersion: 1,
    projectId: 'editor-test',
    createdAt: '2026-07-18T00:00:00.000Z',
    videoTypeId: 'test',
    sourceMode: 'stock-montage',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 6,
    gradeId: 'neutral-clean',
    title: 'Test',
    music: {
      file: 'music/test.mp3',
      start: 10,
      beatMap: 'projects/test/beat-map.json',
      featuredAt: 2,
      featuredRole: 'opening',
    },
    shots: [
      {
        id: 'a',
        source: 'a.mp4',
        query: 'a',
        sourceIn: 1,
        sourceDuration: 2,
        timelineIn: 0,
        timelineOut: 2,
        storyFunction: 'hook',
        anchorX: 0.5,
        anchorY: 0.5,
        transitionToNext: { type: 'cut', duration: 0, reason: 'Open cleanly' },
      },
      {
        id: 'b',
        source: 'b.mp4',
        query: 'b',
        sourceIn: 2,
        sourceDuration: 2,
        timelineIn: 2,
        timelineOut: 4,
        storyFunction: 'build',
        anchorX: 0.5,
        anchorY: 0.5,
        transitionToNext: { type: 'cut', duration: 0 },
      },
      {
        id: 'c',
        source: 'c.mp4',
        query: 'c',
        sourceIn: 3,
        sourceDuration: 2,
        timelineIn: 4,
        timelineOut: 6,
        storyFunction: 'payoff',
        anchorX: 0.5,
        anchorY: 0.5,
        transitionToNext: null,
      },
    ],
    output: 'output/test.mp4',
  };
}

test('round-trips a storyboard through the editable draft contract', () => {
  const original = storyboard();
  const draft = storyboardToDraft(original);
  assert.equal(draft.music?.featuredSourceTime, 12);
  assert.deepEqual(draft.titlePlan, {
    timelineIn: 0.35,
    timelineOut: 2.8,
    anchorX: 0.5,
    anchorY: 0.72,
  });
  const compiled = compileStoryboardDraft(draft);
  assert.equal(compiled.durationSeconds, 6);
  assert.deepEqual(
    compiled.shots.map((shot) => [shot.timelineIn, shot.timelineOut, shot.sourceDuration]),
    [
      [0, 2, 2],
      [2, 4, 2],
      [4, 6, 2],
    ],
  );
  assert.equal(compiled.music?.featuredAt, 2);
});

test('reorders shots while resetting newly-created cut relationships', () => {
  const draft = storyboardToDraft(storyboard());
  const reordered = reorderDraftShots(draft, 2, 1);
  assert.deepEqual(
    reordered.shots.map((shot) => shot.id),
    ['a', 'c', 'b'],
  );
  assert.deepEqual(reordered.shots[0]?.transitionToNext, { type: 'cut', duration: 0 });
  assert.deepEqual(reordered.shots[1]?.transitionToNext, { type: 'cut', duration: 0 });
  assert.equal(reordered.shots[2]?.transitionToNext, null);
});

test('ripple trims and slip edits without introducing timeline gaps', () => {
  const draft = storyboardToDraft(storyboard());
  const trimmed = rippleTrimDraftShot(draft, 0, 'end', 0.75);
  const slipped = slipDraftShot(trimmed, 1, 1.25);
  const compiled = compileStoryboardDraft(slipped);
  assert.equal(compiled.durationSeconds, 6.75);
  assert.equal(compiled.shots[0]?.timelineOut, 2.75);
  assert.equal(compiled.shots[1]?.timelineIn, 2.75);
  assert.equal(compiled.shots[1]?.sourceIn, 3.25);
});

test('rolls an internal cut without changing the sequence duration', () => {
  const draft = storyboardToDraft(storyboard());
  const rolled = rollDraftCut(draft, 1, 0.5);
  const compiled = compileStoryboardDraft(rolled);

  assert.equal(rolled.shots[0]?.duration, 2.5);
  assert.equal(rolled.shots[1]?.sourceIn, 2.5);
  assert.equal(rolled.shots[1]?.duration, 1.5);
  assert.equal(compiled.durationSeconds, 6);
  assert.equal(compiled.shots[0]?.timelineOut, compiled.shots[1]?.timelineIn);
});

test('validates source handles, titles, transitions, and native audio limits', () => {
  const draft = storyboardToDraft(storyboard());
  draft.shots[0]!.transitionToNext = { type: 'dissolve', duration: 0.2 };
  assert.doesNotThrow(() =>
    compileStoryboardDraft(draft, {
      sourceDurations: new Map([
        ['a.mp4', 4],
        ['b.mp4', 5],
        ['c.mp4', 6],
      ]),
    }),
  );
  draft.audioPlan = { useSourceAudio: true };
  assert.throws(() => compileStoryboardDraft(draft), /hard cuts only/);
  draft.audioPlan = { useSourceAudio: false };
  draft.titlePlan = { timelineIn: 5, timelineOut: 7, anchorX: 0.5, anchorY: 0.72 };
  assert.throws(() => compileStoryboardDraft(draft), /Title timing/);
});
