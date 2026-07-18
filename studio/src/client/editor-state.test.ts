import { describe, expect, it } from 'vitest';
import type { StoryboardDraft } from '@ai-video-creation/scripts/types';
import {
  createEditorState,
  draftFingerprint,
  draftDuration,
  editorIsDirty,
  editorPreviewIsStale,
  editorReducer,
  nullableEditorReducer,
} from './editor-state.js';

function draft(): StoryboardDraft {
  return {
    schemaVersion: 1,
    projectId: 'test',
    createdAt: '2026-07-18T00:00:00.000Z',
    videoTypeId: 'test',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    gradeId: 'neutral',
    title: 'Test',
    titlePlan: {
      timelineIn: 0.5,
      timelineOut: 2.5,
      anchorX: 0.5,
      anchorY: 0.72,
    },
    music: { file: 'music.mp3', start: 4, beatMap: 'beat.json' },
    shots: [
      {
        id: 'a',
        source: 'a.mp4',
        query: 'a',
        sourceIn: 0,
        duration: 2,
        storyFunction: 'hook',
        anchorX: 0.5,
        anchorY: 0.5,
        transitionToNext: { type: 'cut', duration: 0 },
      },
      {
        id: 'b',
        source: 'b.mp4',
        query: 'b',
        sourceIn: 1,
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

describe('editor state', () => {
  it('initializes only when a project draft is loaded', () => {
    expect(nullableEditorReducer(null, { type: 'select', shotId: 'a' })).toBeNull();
    expect(
      nullableEditorReducer(null, { type: 'replace', draft: draft() })?.present.projectId,
    ).toBe('test');
  });

  it('tracks dirty and stale states independently', () => {
    let state = createEditorState(draft());
    state = editorReducer(state, { type: 'music-start', start: 5 });
    const submittedFingerprint = draftFingerprint(state.present);
    expect(editorIsDirty(state)).toBe(true);
    expect(editorPreviewIsStale(state)).toBe(true);
    state = editorReducer(state, {
      type: 'mark-previewed',
      fingerprint: submittedFingerprint,
    });
    expect(editorPreviewIsStale(state)).toBe(false);
    expect(editorIsDirty(state)).toBe(true);
    state = editorReducer(state, {
      type: 'mark-saved',
      fingerprint: submittedFingerprint,
    });
    expect(editorIsDirty(state)).toBe(false);
  });

  it('does not mark newer edits current when an older request finishes', () => {
    let state = createEditorState(draft());
    state = editorReducer(state, { type: 'music-start', start: 5 });
    const submittedFingerprint = draftFingerprint(state.present);
    state = editorReducer(state, { type: 'music-start', start: 6 });

    state = editorReducer(state, {
      type: 'mark-previewed',
      fingerprint: submittedFingerprint,
    });
    state = editorReducer(state, {
      type: 'mark-saved',
      fingerprint: submittedFingerprint,
    });

    expect(editorPreviewIsStale(state)).toBe(true);
    expect(editorIsDirty(state)).toBe(true);
  });

  it('supports undo and redo across timeline edits', () => {
    let state = createEditorState(draft());
    state = editorReducer(state, {
      type: 'trim',
      index: 0,
      edge: 'end',
      delta: 1,
    });
    expect(draftDuration(state.present)).toBe(5);
    state = editorReducer(state, { type: 'undo' });
    expect(draftDuration(state.present)).toBe(4);
    state = editorReducer(state, { type: 'redo' });
    expect(draftDuration(state.present)).toBe(5);
  });

  it('preserves gapless ordering and clamps title timing after trims', () => {
    let state = createEditorState(draft());
    state = editorReducer(state, { type: 'reorder', from: 1, to: 0 });
    expect(state.present.shots.map((shot) => shot.id)).toEqual(['b', 'a']);
    state = editorReducer(state, {
      type: 'trim',
      index: 1,
      edge: 'end',
      delta: -1.5,
    });
    expect(draftDuration(state.present)).toBe(2.5);
    expect(state.present.titlePlan?.timelineOut).toBe(2.5);
  });

  it('rolls a cut by resizing adjacent shots without changing total duration', () => {
    const state = editorReducer(createEditorState(draft()), {
      type: 'roll',
      index: 1,
      delta: 0.5,
    });

    expect(state.present.shots[0]!.duration).toBe(2.5);
    expect(state.present.shots[1]!.sourceIn).toBe(1.5);
    expect(state.present.shots[1]!.duration).toBe(1.5);
    expect(draftDuration(state.present)).toBe(4);
  });

  it('ignores out-of-bounds gestures without crashing the editor', () => {
    const state = createEditorState(draft());
    const invalidTrim = editorReducer(state, {
      type: 'trim',
      index: 0,
      edge: 'start',
      delta: 3,
    });
    const invalidSlip = editorReducer(state, {
      type: 'slip',
      index: 0,
      delta: -1,
    });
    const invalidReorder = editorReducer(state, {
      type: 'reorder',
      from: 0,
      to: 99,
    });

    expect(invalidTrim).toBe(state);
    expect(invalidSlip).toBe(state);
    expect(invalidReorder).toBe(state);
  });

  it('makes enabling native source audio a single hard-cut edit', () => {
    const editable = draft();
    editable.shots[0]!.transitionToNext = {
      type: 'dissolve',
      duration: 0.25,
      reason: 'Earlier authored transition',
    };
    const state = editorReducer(createEditorState(editable), {
      type: 'source-audio',
      enabled: true,
    });

    expect(state.present.audioPlan?.useSourceAudio).toBe(true);
    expect(state.present.shots[0]!.transitionToNext).toEqual({
      type: 'cut',
      duration: 0,
      reason: 'Earlier authored transition',
    });
    expect(state.past).toHaveLength(1);
  });

  it('previews a continuous gesture and commits it as one undo step', () => {
    let state = createEditorState(draft());
    state = editorReducer(state, { type: 'gesture-start' });
    state = editorReducer(state, {
      type: 'gesture-trim',
      index: 0,
      edge: 'end',
      delta: 0.2,
    });
    state = editorReducer(state, {
      type: 'gesture-trim',
      index: 0,
      edge: 'end',
      delta: 0.6,
    });

    expect(state.present.shots[0]!.duration).toBe(2.6);
    expect(state.past).toHaveLength(0);
    state = editorReducer(state, { type: 'gesture-commit' });
    expect(state.past).toHaveLength(1);
    state = editorReducer(state, { type: 'undo' });
    expect(state.present.shots[0]!.duration).toBe(2);
  });

  it('restores the original draft when a gesture is cancelled', () => {
    let state = createEditorState(draft());
    state = editorReducer(state, { type: 'gesture-start' });
    state = editorReducer(state, {
      type: 'gesture-title-plan',
      plan: { ...state.present.titlePlan!, timelineOut: 3.5 },
    });
    state = editorReducer(state, { type: 'gesture-cancel' });

    expect(state.present.titlePlan?.timelineOut).toBe(2.5);
    expect(state.past).toHaveLength(0);
  });
});
