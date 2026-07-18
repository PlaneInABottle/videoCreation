import type { Storyboard, StoryboardDraft, StoryboardDraftShot, TransitionPlan } from './types.js';

export const MIN_SHOT_DURATION = 0.5;
export const MAX_TRANSITION_DURATION = 0.75;
export const TRANSITION_TYPES = [
  'cut',
  'dissolve',
  'fade',
  'fadeblack',
  'smoothleft',
  'smoothright',
] as const;

export type TimelineEdge = 'start' | 'end';

export interface CompileDraftOptions {
  sourceDurations?: ReadonlyMap<string, number>;
}

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function transitionKey(fromId: string, toId: string): string {
  return `${fromId}\u0000${toId}`;
}

function cloneTransition(transition: TransitionPlan | null): TransitionPlan | null {
  return transition ? { ...transition } : null;
}

function cloneDraft(draft: StoryboardDraft): StoryboardDraft {
  const { titlePlan, music, audioPlan, ...rest } = draft;
  return {
    ...rest,
    ...(titlePlan ? { titlePlan: { ...titlePlan } } : {}),
    ...(music ? { music: { ...music } } : {}),
    ...(audioPlan ? { audioPlan: { ...audioPlan } } : {}),
    shots: draft.shots.map((shot) => ({
      ...shot,
      transitionToNext: cloneTransition(shot.transitionToNext),
    })),
  };
}

export function storyboardToDraft(storyboard: Storyboard): StoryboardDraft {
  const titlePlan = storyboard.title
    ? (storyboard.titlePlan ?? {
        timelineIn: 0.35,
        timelineOut: Math.min(2.8, storyboard.durationSeconds),
        anchorX: 0.5,
        anchorY: 0.72,
      })
    : storyboard.titlePlan;
  const featuredSourceTime = storyboard.music
    ? (storyboard.music.featuredSourceTime ??
      (storyboard.music.featuredAt === undefined
        ? undefined
        : rounded(storyboard.music.start + storyboard.music.featuredAt)))
    : undefined;
  const music = storyboard.music
    ? {
        ...storyboard.music,
        ...(featuredSourceTime === undefined ? {} : { featuredSourceTime }),
      }
    : undefined;
  const {
    durationSeconds: _durationSeconds,
    shots: _shots,
    titlePlan: _titlePlan,
    music: _music,
    audioPlan: _audioPlan,
    ...storyboardBase
  } = storyboard;
  return {
    ...storyboardBase,
    ...(titlePlan ? { titlePlan: { ...titlePlan } } : {}),
    ...(music ? { music } : {}),
    ...(storyboard.audioPlan ? { audioPlan: { ...storyboard.audioPlan } } : {}),
    shots: storyboard.shots.map((shot) => ({
      id: shot.id,
      source: shot.source,
      ...(shot.pexelsId === undefined ? {} : { pexelsId: shot.pexelsId }),
      query: shot.query,
      sourceIn: shot.sourceIn,
      duration: rounded(shot.timelineOut - shot.timelineIn),
      storyFunction: shot.storyFunction,
      ...(shot.editorialIntent === undefined ? {} : { editorialIntent: shot.editorialIntent }),
      anchorX: shot.anchorX,
      anchorY: shot.anchorY,
      transitionToNext: cloneTransition(shot.transitionToNext),
    })),
  };
}

function validateTransition(
  transition: TransitionPlan | null,
  shot: StoryboardDraftShot,
  next: StoryboardDraftShot | undefined,
  useSourceAudio: boolean,
): void {
  if (!next) {
    if (transition !== null) throw new Error('The final shot transition must be null');
    return;
  }
  if (!transition) throw new Error(`Shot ${shot.id} must define its transition to the next shot`);
  if (!(TRANSITION_TYPES as readonly string[]).includes(transition.type)) {
    throw new Error(`Unsupported transition type: ${transition.type}`);
  }
  finite(transition.duration, `Transition duration for ${shot.id}`);
  if (transition.type === 'cut') {
    if (transition.duration !== 0) throw new Error('Hard cuts must have zero duration');
    return;
  }
  if (useSourceAudio) {
    throw new Error('Native source audio currently supports hard cuts only');
  }
  if (transition.duration < 0.1 || transition.duration > MAX_TRANSITION_DURATION) {
    throw new Error(
      `Transition duration for ${shot.id} must be between 0.1 and ${MAX_TRANSITION_DURATION} seconds`,
    );
  }
  const maximumByShots = Math.min(shot.duration, next.duration) * 0.4;
  if (transition.duration > maximumByShots + 0.0001) {
    throw new Error(`Transition for ${shot.id} is longer than 40% of an adjacent shot`);
  }
}

export function compileStoryboardDraft(
  draft: StoryboardDraft,
  options: CompileDraftOptions = {},
): Storyboard {
  if (draft.shots.length === 0) throw new Error('A storyboard must contain at least one shot');
  const ids = new Set<string>();
  let cursor = 0;
  const shots = draft.shots.map((shot, index) => {
    if (!shot.id.trim()) throw new Error('Shot IDs cannot be empty');
    if (ids.has(shot.id)) throw new Error(`Duplicate shot ID: ${shot.id}`);
    ids.add(shot.id);
    finite(shot.sourceIn, `Source in for ${shot.id}`);
    finite(shot.duration, `Duration for ${shot.id}`);
    finite(shot.anchorX, `Horizontal anchor for ${shot.id}`);
    finite(shot.anchorY, `Vertical anchor for ${shot.id}`);
    if (shot.sourceIn < 0) throw new Error(`Source in for ${shot.id} cannot be negative`);
    if (shot.duration < MIN_SHOT_DURATION) {
      throw new Error(`Shot ${shot.id} must be at least ${MIN_SHOT_DURATION} seconds`);
    }
    if (shot.anchorX < 0 || shot.anchorX > 1 || shot.anchorY < 0 || shot.anchorY > 1) {
      throw new Error(`Crop anchors for ${shot.id} must be between 0 and 1`);
    }
    const next = draft.shots[index + 1];
    validateTransition(shot.transitionToNext, shot, next, draft.audioPlan?.useSourceAudio === true);
    const transitionDuration = shot.transitionToNext?.duration ?? 0;
    const sourceDuration = rounded(shot.duration + transitionDuration);
    const sourceDurationLimit = options.sourceDurations?.get(shot.source);
    if (
      sourceDurationLimit !== undefined &&
      shot.sourceIn + sourceDuration > sourceDurationLimit + 0.001
    ) {
      throw new Error(
        `Shot ${shot.id} exceeds the ${sourceDurationLimit.toFixed(3)}s source duration`,
      );
    }
    const timelineIn = rounded(cursor);
    cursor = rounded(cursor + shot.duration);
    return {
      id: shot.id,
      source: shot.source,
      ...(shot.pexelsId === undefined ? {} : { pexelsId: shot.pexelsId }),
      query: shot.query,
      sourceIn: rounded(shot.sourceIn),
      sourceDuration,
      timelineIn,
      timelineOut: cursor,
      storyFunction: shot.storyFunction,
      ...(shot.editorialIntent === undefined ? {} : { editorialIntent: shot.editorialIntent }),
      anchorX: rounded(shot.anchorX),
      anchorY: rounded(shot.anchorY),
      transitionToNext: cloneTransition(shot.transitionToNext),
    };
  });
  if (draft.music) {
    finite(draft.music.start, 'Music start');
    if (draft.music.start < 0) throw new Error('Music start cannot be negative');
  }
  if (draft.titlePlan) {
    const { timelineIn, timelineOut, anchorX, anchorY } = draft.titlePlan;
    [timelineIn, timelineOut, anchorX, anchorY].forEach((value, index) =>
      finite(
        value,
        ['Title start', 'Title end', 'Title horizontal anchor', 'Title vertical anchor'][index]!,
      ),
    );
    if (timelineIn < 0 || timelineOut <= timelineIn || timelineOut > cursor + 0.0001) {
      throw new Error('Title timing must stay within the storyboard duration');
    }
    if (anchorX < 0 || anchorX > 1 || anchorY < 0 || anchorY > 1) {
      throw new Error('Title anchors must be between 0 and 1');
    }
  }
  const featuredAt = draft.music?.featuredSourceTime;
  const music = draft.music
    ? {
        ...draft.music,
        ...(featuredAt === undefined
          ? {}
          : { featuredAt: rounded(featuredAt - draft.music.start) }),
      }
    : undefined;
  const { titlePlan, music: _draftMusic, audioPlan, ...draftBase } = draft;
  return {
    ...draftBase,
    durationSeconds: rounded(cursor),
    ...(titlePlan ? { titlePlan: { ...titlePlan } } : {}),
    ...(music ? { music } : {}),
    ...(audioPlan ? { audioPlan: { ...audioPlan } } : {}),
    shots,
  };
}

export function reorderDraftShots(
  draft: StoryboardDraft,
  fromIndex: number,
  toIndex: number,
): StoryboardDraft {
  if (
    fromIndex < 0 ||
    fromIndex >= draft.shots.length ||
    toIndex < 0 ||
    toIndex >= draft.shots.length
  ) {
    throw new Error('Shot reorder index is outside the timeline');
  }
  if (fromIndex === toIndex) return cloneDraft(draft);
  const transitionsByPair = new Map<string, TransitionPlan>();
  for (let index = 0; index < draft.shots.length - 1; index += 1) {
    const current = draft.shots[index]!;
    const next = draft.shots[index + 1]!;
    if (current.transitionToNext) {
      transitionsByPair.set(transitionKey(current.id, next.id), { ...current.transitionToNext });
    }
  }
  const result = cloneDraft(draft);
  const [moved] = result.shots.splice(fromIndex, 1);
  if (!moved) throw new Error('Shot to reorder was not found');
  result.shots.splice(toIndex, 0, moved);
  result.shots = result.shots.map((shot, index) => {
    const next = result.shots[index + 1];
    return {
      ...shot,
      transitionToNext: next
        ? (transitionsByPair.get(transitionKey(shot.id, next.id)) ?? {
            type: 'cut',
            duration: 0,
          })
        : null,
    };
  });
  return result;
}

export function rippleTrimDraftShot(
  draft: StoryboardDraft,
  index: number,
  edge: TimelineEdge,
  deltaSeconds: number,
): StoryboardDraft {
  const result = cloneDraft(draft);
  const shot = result.shots[index];
  if (!shot) throw new Error('Shot trim index is outside the timeline');
  finite(deltaSeconds, 'Trim delta');
  if (edge === 'start') {
    shot.sourceIn = rounded(shot.sourceIn + deltaSeconds);
    shot.duration = rounded(shot.duration - deltaSeconds);
  } else {
    shot.duration = rounded(shot.duration + deltaSeconds);
  }
  if (shot.sourceIn < 0) throw new Error('A ripple trim cannot move before the source start');
  if (shot.duration < MIN_SHOT_DURATION) {
    throw new Error(`A ripple trim cannot make a shot shorter than ${MIN_SHOT_DURATION} seconds`);
  }
  return result;
}

export function rollDraftCut(
  draft: StoryboardDraft,
  incomingIndex: number,
  deltaSeconds: number,
): StoryboardDraft {
  const result = cloneDraft(draft);
  const previous = result.shots[incomingIndex - 1];
  const incoming = result.shots[incomingIndex];
  if (!previous || !incoming) throw new Error('A roll edit requires two adjacent shots');
  finite(deltaSeconds, 'Roll delta');
  previous.duration = rounded(previous.duration + deltaSeconds);
  incoming.sourceIn = rounded(incoming.sourceIn + deltaSeconds);
  incoming.duration = rounded(incoming.duration - deltaSeconds);
  if (previous.duration < MIN_SHOT_DURATION || incoming.duration < MIN_SHOT_DURATION) {
    throw new Error(`A roll edit cannot make a shot shorter than ${MIN_SHOT_DURATION} seconds`);
  }
  if (incoming.sourceIn < 0) throw new Error('A roll edit cannot move before the source start');
  return result;
}

export function slipDraftShot(
  draft: StoryboardDraft,
  index: number,
  deltaSeconds: number,
): StoryboardDraft {
  const result = cloneDraft(draft);
  const shot = result.shots[index];
  if (!shot) throw new Error('Shot slip index is outside the timeline');
  finite(deltaSeconds, 'Slip delta');
  shot.sourceIn = rounded(shot.sourceIn + deltaSeconds);
  if (shot.sourceIn < 0) throw new Error('A slip edit cannot move before the source start');
  return result;
}
