import {
  reorderDraftShots,
  rollDraftCut,
  rippleTrimDraftShot,
  slipDraftShot,
} from '@ai-video-creation/scripts/storyboard-edit';
import type {
  StoryboardDraft,
  StoryboardDraftShot,
  TitlePlan,
  TransitionPlan,
} from '@ai-video-creation/scripts/types';

const HISTORY_LIMIT = 50;

export interface EditorState {
  past: StoryboardDraft[];
  present: StoryboardDraft;
  future: StoryboardDraft[];
  gestureBase: StoryboardDraft | null;
  savedFingerprint: string;
  previewFingerprint: string;
  selectedShotId: string;
}

export type EditorAction =
  | { type: 'replace'; draft: StoryboardDraft }
  | { type: 'select'; shotId: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'mark-saved'; fingerprint: string }
  | { type: 'mark-previewed'; fingerprint: string }
  | { type: 'reorder'; from: number; to: number }
  | { type: 'trim'; index: number; edge: 'start' | 'end'; delta: number }
  | { type: 'roll'; index: number; delta: number }
  | { type: 'slip'; index: number; delta: number }
  | { type: 'shot'; shotId: string; patch: Partial<StoryboardDraftShot> }
  | { type: 'transition'; shotId: string; transition: TransitionPlan }
  | { type: 'project'; patch: Partial<StoryboardDraft> }
  | { type: 'source-audio'; enabled: boolean }
  | { type: 'music-start'; start: number }
  | { type: 'title-plan'; plan: TitlePlan }
  | { type: 'gesture-start' }
  | { type: 'gesture-trim'; index: number; edge: 'start' | 'end'; delta: number }
  | { type: 'gesture-roll'; index: number; delta: number }
  | { type: 'gesture-slip'; index: number; delta: number }
  | { type: 'gesture-music-start'; start: number }
  | { type: 'gesture-title-plan'; plan: TitlePlan }
  | { type: 'gesture-commit' }
  | { type: 'gesture-cancel' };

export function draftFingerprint(draft: StoryboardDraft): string {
  return JSON.stringify(draft);
}

export function draftDuration(draft: StoryboardDraft): number {
  return draft.shots.reduce((sum, shot) => sum + shot.duration, 0);
}

function cloneDraft(draft: StoryboardDraft): StoryboardDraft {
  return structuredClone(draft);
}

function clampTitle(draft: StoryboardDraft): StoryboardDraft {
  if (!draft.titlePlan) return draft;
  const duration = draftDuration(draft);
  const minimum = Math.min(0.25, duration);
  const timelineIn = Math.max(0, Math.min(draft.titlePlan.timelineIn, duration - minimum));
  const timelineOut = Math.max(
    timelineIn + minimum,
    Math.min(draft.titlePlan.timelineOut, duration),
  );
  return {
    ...draft,
    titlePlan: { ...draft.titlePlan, timelineIn, timelineOut },
  };
}

function commit(state: EditorState, draft: StoryboardDraft): EditorState {
  if (draftFingerprint(draft) === draftFingerprint(state.present)) return state;
  const previous = state.gestureBase ?? state.present;
  return {
    ...state,
    past: [...state.past.slice(-(HISTORY_LIMIT - 1)), previous],
    present: clampTitle(draft),
    future: [],
    gestureBase: null,
  };
}

function safeCommit(state: EditorState, edit: () => StoryboardDraft): EditorState {
  try {
    return commit(state, edit());
  } catch {
    return state;
  }
}

export function createEditorState(draft: StoryboardDraft): EditorState {
  const fingerprint = draftFingerprint(draft);
  return {
    past: [],
    present: cloneDraft(draft),
    future: [],
    gestureBase: null,
    savedFingerprint: fingerprint,
    previewFingerprint: fingerprint,
    selectedShotId: draft.shots[0]?.id ?? '',
  };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'replace':
      return createEditorState(action.draft);
    case 'select':
      return { ...state, selectedShotId: action.shotId };
    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        ...state,
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future].slice(0, HISTORY_LIMIT),
        gestureBase: null,
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: next,
        future: state.future.slice(1),
        gestureBase: null,
      };
    }
    case 'mark-saved':
      return { ...state, savedFingerprint: action.fingerprint };
    case 'mark-previewed':
      return { ...state, previewFingerprint: action.fingerprint };
    case 'reorder':
      return safeCommit(state, () => reorderDraftShots(state.present, action.from, action.to));
    case 'trim':
      return safeCommit(state, () =>
        rippleTrimDraftShot(state.present, action.index, action.edge, action.delta),
      );
    case 'roll':
      return safeCommit(state, () => rollDraftCut(state.present, action.index, action.delta));
    case 'slip':
      return safeCommit(state, () => slipDraftShot(state.present, action.index, action.delta));
    case 'shot': {
      const draft = cloneDraft(state.present);
      const shot = draft.shots.find((candidate) => candidate.id === action.shotId);
      if (!shot) return state;
      Object.assign(shot, action.patch);
      return commit(state, draft);
    }
    case 'transition': {
      const draft = cloneDraft(state.present);
      const shot = draft.shots.find((candidate) => candidate.id === action.shotId);
      if (!shot || shot.transitionToNext === null) return state;
      shot.transitionToNext = { ...action.transition };
      return commit(state, draft);
    }
    case 'project':
      return commit(state, { ...state.present, ...action.patch });
    case 'source-audio': {
      const draft = cloneDraft(state.present);
      draft.audioPlan = {
        ...(draft.audioPlan ?? {}),
        useSourceAudio: action.enabled,
      };
      if (action.enabled) {
        for (const shot of draft.shots) {
          if (!shot.transitionToNext) continue;
          shot.transitionToNext = {
            type: 'cut',
            duration: 0,
            ...(shot.transitionToNext.reason ? { reason: shot.transitionToNext.reason } : {}),
          };
        }
      }
      return commit(state, draft);
    }
    case 'music-start': {
      if (!state.present.music) return state;
      return commit(state, {
        ...state.present,
        music: { ...state.present.music, start: Math.max(0, action.start) },
      });
    }
    case 'title-plan':
      return commit(state, { ...state.present, titlePlan: { ...action.plan } });
    case 'gesture-start':
      return state.gestureBase ? state : { ...state, gestureBase: cloneDraft(state.present) };
    case 'gesture-trim': {
      const base = state.gestureBase ?? state.present;
      try {
        return {
          ...state,
          present: clampTitle(rippleTrimDraftShot(base, action.index, action.edge, action.delta)),
          gestureBase: state.gestureBase ?? cloneDraft(state.present),
        };
      } catch {
        return state;
      }
    }
    case 'gesture-roll': {
      const base = state.gestureBase ?? state.present;
      try {
        return {
          ...state,
          present: clampTitle(rollDraftCut(base, action.index, action.delta)),
          gestureBase: state.gestureBase ?? cloneDraft(state.present),
        };
      } catch {
        return state;
      }
    }
    case 'gesture-slip': {
      const base = state.gestureBase ?? state.present;
      try {
        return {
          ...state,
          present: slipDraftShot(base, action.index, action.delta),
          gestureBase: state.gestureBase ?? cloneDraft(state.present),
        };
      } catch {
        return state;
      }
    }
    case 'gesture-music-start': {
      if (!state.present.music) return state;
      const base = state.gestureBase ?? state.present;
      if (!base.music) return state;
      return {
        ...state,
        present: {
          ...base,
          music: { ...base.music, start: Math.max(0, action.start) },
        },
        gestureBase: state.gestureBase ?? cloneDraft(state.present),
      };
    }
    case 'gesture-title-plan': {
      const base = state.gestureBase ?? state.present;
      return {
        ...state,
        present: clampTitle({ ...base, titlePlan: { ...action.plan } }),
        gestureBase: state.gestureBase ?? cloneDraft(state.present),
      };
    }
    case 'gesture-commit': {
      const base = state.gestureBase;
      if (!base) return state;
      if (draftFingerprint(base) === draftFingerprint(state.present)) {
        return { ...state, gestureBase: null };
      }
      return {
        ...state,
        past: [...state.past.slice(-(HISTORY_LIMIT - 1)), base],
        future: [],
        gestureBase: null,
      };
    }
    case 'gesture-cancel':
      return state.gestureBase
        ? { ...state, present: state.gestureBase, gestureBase: null }
        : state;
  }
}

export function nullableEditorReducer(
  state: EditorState | null,
  action: EditorAction,
): EditorState | null {
  if (action.type === 'replace') return createEditorState(action.draft);
  return state ? editorReducer(state, action) : null;
}

export function editorIsDirty(state: EditorState): boolean {
  return draftFingerprint(state.present) !== state.savedFingerprint;
}

export function editorPreviewIsStale(state: EditorState): boolean {
  return draftFingerprint(state.present) !== state.previewFingerprint;
}
