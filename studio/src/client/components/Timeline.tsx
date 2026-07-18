import { Activity, GripVertical, Magnet, Minus, Music2, Plus, Type, Video } from 'lucide-react';
import { MIN_SHOT_DURATION } from '@ai-video-creation/scripts/storyboard-edit';
import type { BeatMap, StoryboardDraft, TitlePlan } from '@ai-video-creation/scripts/types';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type {
  CSSProperties,
  Dispatch,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react';
import type { SourceInfo } from '../../shared/api.js';
import type { EditorAction } from '../editor-state.js';
import { draftDuration } from '../editor-state.js';
import { humanize, shortTime } from '../format.js';
import type { PlaybackClock } from '../playback-clock.js';
import { snapTimelineValue } from '../timeline-math.js';
import type { TimelineSnapMode } from '../timeline-math.js';

const DEFAULT_PIXELS_PER_SECOND = 72;
const KEYBOARD_NUDGE = 0.1;
const LABEL_WIDTH = 96;

interface TimelineProps {
  draft: StoryboardDraft;
  beatMap: BeatMap | null;
  sources: SourceInfo[];
  waveformUrl?: string;
  musicDuration?: number;
  selectedShotId: string;
  clock: PlaybackClock;
  snapMode: TimelineSnapMode;
  dispatch: Dispatch<EditorAction>;
  onSnapMode: (mode: TimelineSnapMode) => void;
}

interface PointerGesture {
  onStart: () => void;
  onMove: (deltaSeconds: number) => void;
  onCommit: (deltaSeconds: number) => void;
  onCancel: () => void;
}

function pointerGesture(
  event: ReactPointerEvent<HTMLElement>,
  pixelsPerSecond: number,
  gesture: PointerGesture,
) {
  event.preventDefault();
  event.stopPropagation();
  const element = event.currentTarget;
  const startX = event.clientX;
  let latestDelta = 0;
  element.setPointerCapture(event.pointerId);
  gesture.onStart();
  const move = (pointerEvent: PointerEvent) => {
    latestDelta = (pointerEvent.clientX - startX) / pixelsPerSecond;
    gesture.onMove(latestDelta);
  };
  const finish = (pointerEvent: PointerEvent) => {
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    latestDelta = (pointerEvent.clientX - startX) / pixelsPerSecond;
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', finish);
    element.removeEventListener('pointercancel', cancel);
    gesture.onMove(latestDelta);
    gesture.onCommit(latestDelta);
  };
  const cancel = () => {
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', finish);
    element.removeEventListener('pointercancel', cancel);
    gesture.onCancel();
  };
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', finish, { once: true });
  element.addEventListener('pointercancel', cancel, { once: true });
}

function timelineStarts(draft: StoryboardDraft): number[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const shot of draft.shots) {
    starts.push(cursor);
    cursor += shot.duration;
  }
  return starts;
}

function PlaybackPlayhead({
  clock,
  duration,
  pixelsPerSecond,
  scrollRef,
}: {
  clock: PlaybackClock;
  duration: number;
  pixelsPerSecond: number;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const currentTime = Math.min(
    duration,
    useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot),
  );
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const playheadX = LABEL_WIDTH + currentTime * pixelsPerSecond;
    const leftEdge = scroll.scrollLeft + LABEL_WIDTH;
    const rightEdge = scroll.scrollLeft + scroll.clientWidth - 36;
    if (playheadX > rightEdge) scroll.scrollLeft = playheadX - scroll.clientWidth + 64;
    else if (playheadX < leftEdge) scroll.scrollLeft = Math.max(0, playheadX - LABEL_WIDTH);
  }, [currentTime, pixelsPerSecond, scrollRef]);
  return (
    <span
      className="playhead"
      style={{ left: LABEL_WIDTH + currentTime * pixelsPerSecond }}
      aria-hidden="true"
    >
      <span />
    </span>
  );
}

function TimelineSeekSurface({
  clock,
  duration,
  pixelsPerSecond,
}: {
  clock: PlaybackClock;
  duration: number;
  pixelsPerSecond: number;
}) {
  const currentTime = Math.min(
    duration,
    useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot),
  );
  return (
    <div
      className="time-ruler-seek"
      role="slider"
      tabIndex={0}
      aria-label="Timeline playhead"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={currentTime}
      aria-valuetext={shortTime(currentTime)}
      onKeyDown={(event) => {
        if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          clock.set(event.key === 'Home' ? 0 : duration);
          return;
        }
        if (
          event.key !== 'ArrowLeft' &&
          event.key !== 'ArrowRight' &&
          event.key !== 'PageUp' &&
          event.key !== 'PageDown'
        ) {
          return;
        }
        event.preventDefault();
        const nudge =
          event.key === 'PageUp' || event.key === 'PageDown'
            ? 1
            : event.shiftKey
              ? 0.5
              : KEYBOARD_NUDGE;
        const forward = event.key === 'ArrowRight' || event.key === 'PageDown';
        clock.set(Math.max(0, Math.min(duration, currentTime + (forward ? nudge : -nudge))));
      }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        clock.set(Math.max(0, Math.min(duration, (event.clientX - rect.left) / pixelsPerSecond)));
      }}
    />
  );
}

export function Timeline({
  draft,
  beatMap,
  sources,
  waveformUrl,
  musicDuration,
  selectedShotId,
  clock,
  snapMode,
  dispatch,
  onSnapMode,
}: TimelineProps) {
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PIXELS_PER_SECOND);
  const [sceneDrag, setSceneDrag] = useState<{
    from: number;
    to: number;
    x: number;
    y: number;
  } | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const duration = draftDuration(draft);
  const width = Math.max(880, duration * pixelsPerSecond + LABEL_WIDTH);
  const starts = timelineStarts(draft);
  const ticks = Array.from({ length: Math.ceil(duration) + 1 }, (_, index) => index);
  const structuralSnapCandidates = [
    0,
    duration,
    ...starts,
    ...(beatMap?.majorMoments?.map((moment) => moment.time) ?? []),
  ].filter((time) => time >= 0 && time <= duration);
  const snapCandidates =
    snapMode === 'beat'
      ? [
          ...structuralSnapCandidates,
          ...(beatMap?.beats.filter((time) => time >= 0 && time <= duration) ?? []),
        ]
      : structuralSnapCandidates;
  const energyMaximum = Math.max(0.001, ...(beatMap?.energy.map((sample) => sample.value) ?? []));
  const energyPoints = (beatMap?.energy ?? [])
    .filter((sample) => sample.time >= 0 && sample.time <= duration)
    .map(
      (sample) =>
        `${(sample.time * pixelsPerSecond).toFixed(1)},${(30 - (sample.value / energyMaximum) * 26).toFixed(1)}`,
    )
    .join(' ');

  function snapTimelineTime(time: number): number {
    return snapTimelineValue(
      time,
      duration,
      [...snapCandidates, clock.getSnapshot()],
      snapMode !== 'off',
      pixelsPerSecond,
    );
  }

  function snappedTrimDelta(index: number, delta: number): number {
    const currentEnd = starts[index]! + draft.shots[index]!.duration;
    const requestedBoundary = currentEnd + delta;
    const snappedBoundary = snapTimelineTime(requestedBoundary);
    return snappedBoundary - currentEnd;
  }

  function boundedTrimDelta(index: number, delta: number, shouldSnap = true): number {
    const shot = draft.shots[index]!;
    const source = sources.find((candidate) => candidate.shotId === shot.id);
    const snapped = shouldSnap ? snappedTrimDelta(index, delta) : delta;
    const minimum = MIN_SHOT_DURATION - shot.duration;
    const transition = shot.transitionToNext?.duration ?? 0;
    const maximum =
      source?.duration === undefined
        ? Number.POSITIVE_INFINITY
        : source.duration - shot.sourceIn - shot.duration - transition;
    return Math.max(minimum, Math.min(maximum, snapped));
  }

  function boundedRollDelta(index: number, delta: number, shouldSnap = true): number {
    const incoming = draft.shots[index]!;
    const previous = draft.shots[index - 1];
    if (!previous) return 0;
    const previousSource = sources.find((candidate) => candidate.shotId === previous.id);
    const currentBoundary = starts[index]!;
    const snapped = shouldSnap
      ? snapTimelineTime(currentBoundary + delta) - currentBoundary
      : delta;
    const minimum = Math.max(MIN_SHOT_DURATION - previous.duration, -incoming.sourceIn);
    const previousTransition = previous.transitionToNext?.duration ?? 0;
    const maximumByPreviousSource =
      previousSource?.duration === undefined
        ? Number.POSITIVE_INFINITY
        : previousSource.duration - previous.sourceIn - previous.duration - previousTransition;
    const maximum = Math.min(incoming.duration - MIN_SHOT_DURATION, maximumByPreviousSource);
    return Math.max(minimum, Math.min(maximum, snapped));
  }

  function boundedSlipDelta(index: number, delta: number): number {
    const shot = draft.shots[index]!;
    const source = sources.find((candidate) => candidate.shotId === shot.id);
    const transition = shot.transitionToNext?.duration ?? 0;
    const maximum =
      source?.duration === undefined
        ? Number.POSITIVE_INFINITY
        : source.duration - shot.sourceIn - shot.duration - transition;
    return Math.max(-shot.sourceIn, Math.min(maximum, delta));
  }

  function liveEditorGesture(onMove: (delta: number) => void): PointerGesture {
    return {
      onStart: () => dispatch({ type: 'gesture-start' }),
      onMove,
      onCommit: () => dispatch({ type: 'gesture-commit' }),
      onCancel: () => dispatch({ type: 'gesture-cancel' }),
    };
  }

  function snapRangeMove(plan: TitlePlan, delta: number): TitlePlan {
    const length = plan.timelineOut - plan.timelineIn;
    const requestedStart = Math.max(0, Math.min(duration - length, plan.timelineIn + delta));
    if (snapMode === 'off') {
      return {
        ...plan,
        timelineIn: requestedStart,
        timelineOut: requestedStart + length,
      };
    }
    const requestedEnd = requestedStart + length;
    const snappedStart = snapTimelineTime(requestedStart);
    const snappedEnd = snapTimelineTime(requestedEnd);
    const startAdjustment = snappedStart - requestedStart;
    const endAdjustment = snappedEnd - requestedEnd;
    const adjustment =
      Math.abs(startAdjustment) <= Math.abs(endAdjustment) ? startAdjustment : endAdjustment;
    const start = Math.max(0, Math.min(duration - length, requestedStart + adjustment));
    return { ...plan, timelineIn: start, timelineOut: start + length };
  }

  function beginSceneDrag(event: ReactPointerEvent<HTMLElement>, from: number) {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    let to = from;
    handle.setPointerCapture(pointerId);
    dispatch({ type: 'select', shotId: draft.shots[from]!.id });
    setSceneDrag({ from, to, x: event.clientX, y: event.clientY });
    const move = (pointerEvent: PointerEvent) => {
      const target = document
        .elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)
        ?.closest<HTMLElement>('[data-shot-index]');
      const candidate = Number(target?.dataset.shotIndex);
      if (Number.isInteger(candidate)) to = candidate;
      setSceneDrag({ from, to, x: pointerEvent.clientX, y: pointerEvent.clientY });
    };
    const cleanup = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', cancel);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      setSceneDrag(null);
    };
    const finish = () => {
      cleanup();
      if (to !== from) dispatch({ type: 'reorder', from, to });
    };
    const cancel = () => cleanup();
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish, { once: true });
    handle.addEventListener('pointercancel', cancel, { once: true });
  }

  function clipKeyboard(event: KeyboardEvent<HTMLElement>, index: number, shotId: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      dispatch({ type: 'select', shotId });
    }
    if (event.altKey && event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      dispatch({ type: 'reorder', from: index, to: index - 1 });
    }
    if (event.altKey && event.key === 'ArrowRight' && index < draft.shots.length - 1) {
      event.preventDefault();
      dispatch({ type: 'reorder', from: index, to: index + 1 });
    }
  }

  function titleKeyboard(event: KeyboardEvent<HTMLElement>, plan: TitlePlan) {
    const delta = event.shiftKey ? 0.5 : KEYBOARD_NUDGE;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -delta : delta;
      const length = plan.timelineOut - plan.timelineIn;
      const start = Math.max(0, Math.min(duration - length, plan.timelineIn + direction));
      dispatch({
        type: 'title-plan',
        plan: { ...plan, timelineIn: start, timelineOut: start + length },
      });
    }
  }

  return (
    <section className="timeline-panel" aria-label="Edit timeline">
      <div className="timeline-toolbar">
        <div>
          <span className="timeline-title">Timeline</span>
          <span className="timeline-help">
            Grip to move · end edge resizes · shared edge rolls · Alt-drag slips
          </span>
        </div>
        <div className="timeline-tools">
          <div className="snap-mode" aria-label="Timeline snap mode">
            <Magnet aria-hidden="true" />
            <button
              aria-pressed={snapMode === 'off'}
              className={snapMode === 'off' ? 'is-active' : ''}
              onClick={() => onSnapMode('off')}
            >
              Off
            </button>
            <button
              aria-pressed={snapMode === 'major'}
              className={snapMode === 'major' ? 'is-active' : ''}
              onClick={() => onSnapMode('major')}
              title="Snap to scene edges, playhead, and major musical moments"
            >
              Major
            </button>
            <button
              aria-pressed={snapMode === 'beat'}
              className={snapMode === 'beat' ? 'is-active' : ''}
              onClick={() => onSnapMode('beat')}
              title="Also snap manual boundaries to every detected beat"
            >
              Beat snap
            </button>
          </div>
          <div className="timeline-zoom" aria-label="Timeline zoom">
            <button
              onClick={() => setPixelsPerSecond((value) => Math.max(48, value - 16))}
              disabled={pixelsPerSecond <= 48}
              aria-label="Zoom timeline out"
            >
              <Minus aria-hidden="true" />
            </button>
            <span>{pixelsPerSecond}px/s</span>
            <button
              onClick={() => setPixelsPerSecond((value) => Math.min(136, value + 16))}
              disabled={pixelsPerSecond >= 136}
              aria-label="Zoom timeline in"
            >
              <Plus aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <div className="timeline-scroll" ref={timelineScrollRef}>
        <div
          className="timeline-canvas"
          style={
            {
              width,
              '--timeline-second': `${pixelsPerSecond}px`,
            } as CSSProperties
          }
        >
          <div className="time-ruler">
            {ticks.map((tick) => (
              <span key={tick} style={{ left: tick * pixelsPerSecond }}>
                {tick % 5 === 0 ? `${tick}s` : ''}
              </span>
            ))}
            <TimelineSeekSurface
              clock={clock}
              duration={duration}
              pixelsPerSecond={pixelsPerSecond}
            />
          </div>

          <div className="track-row analysis-track">
            <div className="track-label track-label-detailed">
              <Activity aria-hidden="true" />
              <span>
                Energy <small>{beatMap?.sections?.length ?? 0} sections</small>
              </span>
            </div>
            <div className="track-content analysis-content" aria-label="Music energy and sections">
              {beatMap?.sections?.map((section, index) => (
                <div
                  key={`${section.start}-${section.label}-${index}`}
                  className={`music-section is-${section.label}`}
                  style={{
                    left: section.start * pixelsPerSecond,
                    width: Math.max(
                      1,
                      (Math.min(section.end, duration) - section.start) * pixelsPerSecond,
                    ),
                  }}
                  title={`${section.label} section ${shortTime(section.start)}–${shortTime(section.end)}`}
                >
                  {section.end - section.start > 1.3 ? section.label : ''}
                </div>
              ))}
              {energyPoints ? (
                <svg
                  className="energy-curve"
                  width={duration * pixelsPerSecond}
                  height="30"
                  viewBox={`0 0 ${duration * pixelsPerSecond} 30`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <polyline points={energyPoints} />
                </svg>
              ) : null}
              {beatMap?.majorMoments?.map((moment) => (
                <span
                  key={`${moment.time}-${moment.kind}`}
                  className={`major-marker is-${moment.kind}`}
                  style={{ left: moment.time * pixelsPerSecond }}
                  title={`${moment.kind} at ${shortTime(moment.time)}`}
                >
                  <span>{moment.kind}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="track-row beat-track">
            <div className="track-label track-label-detailed">
              <Music2 aria-hidden="true" />
              <span>
                Rhythm{' '}
                <small>
                  {beatMap
                    ? `${Math.round(beatMap.bpm)} BPM · ${Math.round(beatMap.confidence * 100)}%`
                    : 'No map'}
                </small>
              </span>
            </div>
            <div
              className="track-content beat-content"
              aria-label={`${beatMap?.beats.length ?? 0} beats and ${beatMap?.onsets.length ?? 0} onsets`}
            >
              {beatMap?.beats.map((time, index) => (
                <span
                  key={`beat-${time}-${index}`}
                  className={`beat-marker ${index % 4 === 0 ? 'is-downbeat' : ''}`}
                  style={{ left: time * pixelsPerSecond }}
                  title={`${index % 4 === 0 ? `4-beat group ${Math.floor(index / 4) + 1}, ` : ''}beat ${index + 1} at ${shortTime(time)}`}
                >
                  {index % 4 === 0 ? <small>{Math.floor(index / 4) + 1}</small> : null}
                </span>
              ))}
              {beatMap?.onsets.map((time, index) => (
                <span
                  key={`onset-${time}-${index}`}
                  className="onset-marker"
                  style={{ left: time * pixelsPerSecond }}
                  title={`Onset at ${shortTime(time)}`}
                />
              ))}
              <span className="rhythm-legend" aria-hidden="true">
                <i className="legend-downbeat" /> 4-beat group <i className="legend-beat" /> beat{' '}
                <i className="legend-onset" /> transient
              </span>
            </div>
          </div>

          <div className="track-row video-track">
            <div className="track-label">
              <Video aria-hidden="true" />
              <span>Scenes</span>
            </div>
            <div className="track-content scene-track-content">
              {draft.shots.map((shot, index) => {
                const source = sources.find((candidate) => candidate.shotId === shot.id);
                return (
                  <div
                    key={shot.id}
                    data-shot-index={index}
                    className={`scene-clip ${selectedShotId === shot.id ? 'is-selected' : ''} ${sceneDrag?.from === index ? 'is-dragging' : ''} ${sceneDrag?.to === index && sceneDrag.from !== index ? 'is-drop-target' : ''}`}
                    style={{ width: shot.duration * pixelsPerSecond }}
                    role="group"
                    aria-label={`${shot.id}, ${shot.storyFunction}, ${shortTime(shot.duration)}`}
                    onPointerDown={(event) => {
                      if (!event.altKey) return;
                      pointerGesture(
                        event,
                        pixelsPerSecond,
                        liveEditorGesture((delta) =>
                          dispatch({
                            type: 'gesture-slip',
                            index,
                            delta: boundedSlipDelta(index, delta),
                          }),
                        ),
                      );
                    }}
                  >
                    {source?.thumbnailUrl ? (
                      <img
                        src={source.thumbnailUrl}
                        alt=""
                        width={480}
                        height={270}
                        draggable={false}
                      />
                    ) : (
                      <span className="clip-fallback" aria-hidden="true" />
                    )}
                    <button
                      className="scene-select-surface"
                      aria-label={`Select ${shot.id}, ${humanize(shot.storyFunction)}`}
                      onClick={() => dispatch({ type: 'select', shotId: shot.id })}
                    />
                    <button
                      className="scene-drag-handle"
                      aria-label={`Move ${shot.id}. Drag, or use Alt plus arrow keys.`}
                      onClick={(event) => {
                        event.stopPropagation();
                        dispatch({ type: 'select', shotId: shot.id });
                      }}
                      onKeyDown={(event) => clipKeyboard(event, index, shot.id)}
                      onPointerDown={(event) => beginSceneDrag(event, index)}
                    >
                      <GripVertical aria-hidden="true" />
                    </button>
                    {index > 0 ? (
                      <span
                        className="trim-handle is-start"
                        role="slider"
                        tabIndex={0}
                        aria-label={`Roll cut before ${shot.id}`}
                        aria-orientation="horizontal"
                        aria-valuemin={starts[index]! + boundedRollDelta(index, -duration, false)}
                        aria-valuemax={starts[index]! + boundedRollDelta(index, duration, false)}
                        aria-valuenow={starts[index]}
                        aria-valuetext={`Cut at ${shortTime(starts[index]!)}; incoming source ${shortTime(shot.sourceIn)}`}
                        onPointerDown={(event) =>
                          pointerGesture(
                            event,
                            pixelsPerSecond,
                            liveEditorGesture((delta) =>
                              dispatch({
                                type: 'gesture-roll',
                                index,
                                delta: boundedRollDelta(index, delta),
                              }),
                            ),
                          )
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Home' || event.key === 'End') {
                            event.preventDefault();
                            const requested = event.key === 'Home' ? -duration : duration;
                            dispatch({
                              type: 'roll',
                              index,
                              delta: boundedRollDelta(index, requested, false),
                            });
                            return;
                          }
                          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                            event.preventDefault();
                            dispatch({
                              type: 'roll',
                              index,
                              delta: boundedRollDelta(
                                index,
                                event.key === 'ArrowRight' ? KEYBOARD_NUDGE : -KEYBOARD_NUDGE,
                                false,
                              ),
                            });
                          }
                        }}
                      />
                    ) : null}
                    <span className="clip-copy">
                      <strong>{shot.storyFunction}</strong>
                      <small>
                        {shortTime(shot.duration)} · src {shortTime(shot.sourceIn)}
                      </small>
                    </span>
                    <span
                      className="trim-handle is-end"
                      role="slider"
                      tabIndex={0}
                      aria-label={`Trim end of ${shot.id}`}
                      aria-orientation="horizontal"
                      aria-valuemin={MIN_SHOT_DURATION}
                      aria-valuemax={
                        source?.duration === undefined
                          ? undefined
                          : Math.max(
                              MIN_SHOT_DURATION,
                              source.duration -
                                shot.sourceIn -
                                (shot.transitionToNext?.duration ?? 0),
                            )
                      }
                      aria-valuenow={shot.duration}
                      aria-valuetext={`Scene duration ${shortTime(shot.duration)}`}
                      onPointerDown={(event) =>
                        pointerGesture(
                          event,
                          pixelsPerSecond,
                          liveEditorGesture((delta) =>
                            dispatch({
                              type: 'gesture-trim',
                              index,
                              edge: 'end',
                              delta: boundedTrimDelta(index, delta),
                            }),
                          ),
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                          event.preventDefault();
                          dispatch({
                            type: 'trim',
                            index,
                            edge: 'end',
                            delta: boundedTrimDelta(
                              index,
                              event.key === 'ArrowRight' ? KEYBOARD_NUDGE : -KEYBOARD_NUDGE,
                              false,
                            ),
                          });
                        }
                      }}
                    />
                    {shot.transitionToNext ? (
                      <button
                        className={`transition-chip ${shot.transitionToNext.type === 'cut' ? 'is-cut' : ''}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          dispatch({ type: 'select', shotId: shot.id });
                        }}
                        title={`${shot.transitionToNext.type} ${shortTime(shot.transitionToNext.duration)}`}
                        aria-label={`${humanize(shot.transitionToNext.type)} after ${shot.id}, ${shortTime(shot.transitionToNext.duration)}`}
                      >
                        {shot.transitionToNext.type === 'cut' ? '|' : '◇'}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="track-row title-track">
            <div className="track-label">
              <Type aria-hidden="true" />
              <span>Titles</span>
            </div>
            <div className="track-content">
              {draft.title && draft.titlePlan ? (
                <div
                  className="title-clip"
                  style={{
                    left: draft.titlePlan.timelineIn * pixelsPerSecond,
                    width:
                      (draft.titlePlan.timelineOut - draft.titlePlan.timelineIn) * pixelsPerSecond,
                  }}
                  role="group"
                  aria-label="Opening title timing"
                >
                  <span
                    className="overlay-handle is-start"
                    role="slider"
                    tabIndex={0}
                    aria-label="Resize title start"
                    aria-orientation="horizontal"
                    aria-valuemin={0}
                    aria-valuemax={draft.titlePlan.timelineOut - 0.25}
                    aria-valuenow={draft.titlePlan.timelineIn}
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                      event.preventDefault();
                      event.stopPropagation();
                      const plan = draft.titlePlan!;
                      const requested = Math.max(
                        0,
                        Math.min(
                          plan.timelineOut - 0.25,
                          plan.timelineIn +
                            (event.key === 'ArrowRight' ? KEYBOARD_NUDGE : -KEYBOARD_NUDGE),
                        ),
                      );
                      dispatch({
                        type: 'title-plan',
                        plan: { ...plan, timelineIn: requested },
                      });
                    }}
                    onPointerDown={(event) => {
                      const plan = draft.titlePlan!;
                      pointerGesture(
                        event,
                        pixelsPerSecond,
                        liveEditorGesture((delta) => {
                          const requested = Math.max(
                            0,
                            Math.min(plan.timelineOut - 0.25, plan.timelineIn + delta),
                          );
                          const snapped = Math.min(
                            plan.timelineOut - 0.25,
                            snapTimelineTime(requested),
                          );
                          dispatch({
                            type: 'gesture-title-plan',
                            plan: { ...plan, timelineIn: snapped },
                          });
                        }),
                      );
                    }}
                  />
                  <button
                    type="button"
                    className="title-clip-copy"
                    aria-label={`Move opening title, ${shortTime(draft.titlePlan.timelineIn)} to ${shortTime(draft.titlePlan.timelineOut)}`}
                    onKeyDown={(event) => titleKeyboard(event, draft.titlePlan!)}
                    onPointerDown={(event) => {
                      const plan = draft.titlePlan!;
                      pointerGesture(
                        event,
                        pixelsPerSecond,
                        liveEditorGesture((delta) =>
                          dispatch({
                            type: 'gesture-title-plan',
                            plan: snapRangeMove(plan, delta),
                          }),
                        ),
                      );
                    }}
                  >
                    <strong>{draft.title}</strong>
                    <small>
                      {shortTime(draft.titlePlan.timelineIn)}–
                      {shortTime(draft.titlePlan.timelineOut)}
                    </small>
                  </button>
                  <span
                    className="overlay-handle is-end"
                    role="slider"
                    tabIndex={0}
                    aria-label="Resize title end"
                    aria-orientation="horizontal"
                    aria-valuemin={draft.titlePlan.timelineIn + 0.25}
                    aria-valuemax={duration}
                    aria-valuenow={draft.titlePlan.timelineOut}
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                      event.preventDefault();
                      event.stopPropagation();
                      const plan = draft.titlePlan!;
                      const requested = Math.min(
                        duration,
                        Math.max(
                          plan.timelineIn + 0.25,
                          plan.timelineOut +
                            (event.key === 'ArrowRight' ? KEYBOARD_NUDGE : -KEYBOARD_NUDGE),
                        ),
                      );
                      dispatch({
                        type: 'title-plan',
                        plan: { ...plan, timelineOut: requested },
                      });
                    }}
                    onPointerDown={(event) => {
                      const plan = draft.titlePlan!;
                      pointerGesture(
                        event,
                        pixelsPerSecond,
                        liveEditorGesture((delta) => {
                          const requested = Math.min(
                            duration,
                            Math.max(plan.timelineIn + 0.25, plan.timelineOut + delta),
                          );
                          const snapped = Math.max(
                            plan.timelineIn + 0.25,
                            snapTimelineTime(requested),
                          );
                          dispatch({
                            type: 'gesture-title-plan',
                            plan: { ...plan, timelineOut: snapped },
                          });
                        }),
                      );
                    }}
                  />
                </div>
              ) : (
                <span className="empty-track-copy">No title overlay</span>
              )}
            </div>
          </div>

          <div className="track-row music-track">
            <div className="track-label">
              <Music2 aria-hidden="true" />
              <span>Music</span>
            </div>
            <div className="track-content music-window">
              {draft.music ? (
                <div
                  className="music-clip"
                  role="slider"
                  tabIndex={0}
                  aria-label="Music excerpt start"
                  aria-valuemin={0}
                  aria-valuemax={Math.max(0, (musicDuration ?? duration) - duration)}
                  aria-valuenow={draft.music.start}
                  onPointerDown={(event) => {
                    const initialStart = draft.music!.start;
                    pointerGesture(
                      event,
                      pixelsPerSecond,
                      liveEditorGesture((delta) => {
                        const maximum = Math.max(0, (musicDuration ?? duration) - duration);
                        dispatch({
                          type: 'gesture-music-start',
                          start: Math.max(0, Math.min(maximum, initialStart + delta)),
                        });
                      }),
                    );
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                      event.preventDefault();
                      const nudge = event.shiftKey ? 0.5 : KEYBOARD_NUDGE;
                      const maximum = Math.max(0, (musicDuration ?? duration) - duration);
                      dispatch({
                        type: 'music-start',
                        start: Math.max(
                          0,
                          Math.min(
                            maximum,
                            draft.music!.start + (event.key === 'ArrowRight' ? nudge : -nudge),
                          ),
                        ),
                      });
                    }
                  }}
                >
                  {waveformUrl && musicDuration ? (
                    <img
                      src={waveformUrl}
                      alt=""
                      draggable={false}
                      style={{
                        left: -draft.music.start * pixelsPerSecond,
                        width: musicDuration * pixelsPerSecond,
                      }}
                    />
                  ) : null}
                  <span className="music-copy">Excerpt from {shortTime(draft.music.start)}</span>
                </div>
              ) : (
                <span className="empty-track-copy">No music track</span>
              )}
            </div>
          </div>

          <PlaybackPlayhead
            clock={clock}
            duration={duration}
            pixelsPerSecond={pixelsPerSecond}
            scrollRef={timelineScrollRef}
          />
          {sceneDrag ? (
            <div
              className="scene-drag-preview"
              style={{ left: sceneDrag.x + 14, top: sceneDrag.y + 14 }}
              aria-hidden="true"
            >
              <GripVertical />
              <span>
                {draft.shots[sceneDrag.from]?.storyFunction} → position {sceneDrag.to + 1}
              </span>
            </div>
          ) : null}
          <span className="sr-only" aria-live="polite">
            {sceneDrag
              ? `Moving ${draft.shots[sceneDrag.from]?.id} to position ${sceneDrag.to + 1}`
              : ''}
          </span>
        </div>
      </div>
    </section>
  );
}
