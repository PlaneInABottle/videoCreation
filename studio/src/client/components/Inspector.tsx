import {
  AlertTriangle,
  AudioLines,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Film,
  SlidersHorizontal,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import { TRANSITION_TYPES } from '@ai-video-creation/scripts/storyboard-edit';
import type { BeatMap, StoryboardDraft } from '@ai-video-creation/scripts/types';
import type { ProjectDetail } from '../../shared/api.js';
import type { EditorAction } from '../editor-state.js';
import { draftDuration } from '../editor-state.js';
import { humanize, shortTime } from '../format.js';

type InspectorTab = 'shot' | 'project' | 'review';
const INSPECTOR_TABS: InspectorTab[] = ['shot', 'project', 'review'];

interface InspectorProps {
  detail: ProjectDetail;
  draft: StoryboardDraft;
  beatMap: BeatMap | null;
  selectedShotId: string;
  dispatch: Dispatch<EditorAction>;
}

function numberValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="field-label">{children}</span>;
}

export function Inspector({ detail, draft, beatMap, selectedShotId, dispatch }: InspectorProps) {
  const [tab, setTab] = useState<InspectorTab>('shot');
  const tabRefs = useRef(new Map<InspectorTab, HTMLButtonElement>());
  const shotIndex = draft.shots.findIndex((candidate) => candidate.id === selectedShotId);
  const shot = draft.shots[shotIndex] ?? draft.shots[0];
  const source = detail.sources.find((candidate) => candidate.shotId === shot?.id);
  const sourceAudioUnavailable = detail.sources.some(
    (candidate) => !candidate.available || candidate.hasAudio !== true,
  );
  const duration = draftDuration(draft);
  const featuredAt =
    draft.music?.featuredSourceTime === undefined || !draft.music
      ? draft.music?.featuredAt
      : draft.music.featuredSourceTime - draft.music.start;
  const featuredOutside = featuredAt !== undefined && (featuredAt < 0 || featuredAt > duration);
  const nearestMoment = useMemo(() => {
    if (!shot || !beatMap?.majorMoments?.length) return null;
    const timelineIn = draft.shots
      .slice(0, shotIndex)
      .reduce((sum, item) => sum + item.duration, 0);
    return beatMap.majorMoments.reduce((nearest, moment) =>
      Math.abs(moment.time - timelineIn) < Math.abs(nearest.time - timelineIn) ? moment : nearest,
    );
  }, [beatMap?.majorMoments, draft.shots, shot, shotIndex]);

  return (
    <aside className="inspector-panel" aria-label="Edit inspector">
      <div className="inspector-tabs" role="tablist" aria-label="Inspector sections">
        {INSPECTOR_TABS.map((candidate, index) => (
          <button
            key={candidate}
            id={`inspector-tab-${candidate}`}
            ref={(element) => {
              if (element) tabRefs.current.set(candidate, element);
              else tabRefs.current.delete(candidate);
            }}
            role="tab"
            aria-selected={tab === candidate}
            aria-controls={`inspector-panel-${candidate}`}
            tabIndex={tab === candidate ? 0 : -1}
            className={tab === candidate ? 'is-active' : ''}
            onClick={() => setTab(candidate)}
            onKeyDown={(event) => {
              if (
                event.key !== 'ArrowLeft' &&
                event.key !== 'ArrowRight' &&
                event.key !== 'Home' &&
                event.key !== 'End'
              ) {
                return;
              }
              event.preventDefault();
              const nextIndex =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? INSPECTOR_TABS.length - 1
                    : (index + (event.key === 'ArrowRight' ? 1 : -1) + INSPECTOR_TABS.length) %
                      INSPECTOR_TABS.length;
              const next = INSPECTOR_TABS[nextIndex]!;
              setTab(next);
              tabRefs.current.get(next)?.focus();
            }}
          >
            {humanize(candidate)}
          </button>
        ))}
      </div>

      <div
        id={`inspector-panel-${tab}`}
        className="inspector-scroll"
        role="tabpanel"
        aria-labelledby={`inspector-tab-${tab}`}
        tabIndex={0}
      >
        {tab === 'shot' && shot ? (
          <>
            <section className="inspector-section shot-heading">
              <div>
                <p className="eyebrow">
                  Scene {shotIndex + 1} of {draft.shots.length}
                </p>
                <h2>{humanize(shot.storyFunction)}</h2>
                <p className="source-name">{shot.source.split('/').at(-1)}</p>
              </div>
              <div className="reorder-buttons">
                <button
                  className="icon-button"
                  disabled={shotIndex <= 0}
                  onClick={() =>
                    dispatch({
                      type: 'reorder',
                      from: shotIndex,
                      to: shotIndex - 1,
                    })
                  }
                  aria-label="Move scene left"
                >
                  <ChevronLeft aria-hidden="true" />
                </button>
                <button
                  className="icon-button"
                  disabled={shotIndex >= draft.shots.length - 1}
                  onClick={() =>
                    dispatch({
                      type: 'reorder',
                      from: shotIndex,
                      to: shotIndex + 1,
                    })
                  }
                  aria-label="Move scene right"
                >
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
            </section>

            <section className="inspector-section source-monitor-section">
              <div className={`source-monitor ${draft.aspect === '9:16' ? 'is-vertical' : ''}`}>
                {source?.mediaUrl ? (
                  <video
                    key={`${source.mediaUrl}-${shot.sourceIn}`}
                    src={`${source.mediaUrl}#t=${shot.sourceIn.toFixed(2)}`}
                    controls
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <div className="source-unavailable">
                    <Film aria-hidden="true" />
                    <span>Source unavailable</span>
                  </div>
                )}
                <span
                  className="crop-target"
                  style={{
                    left: `${shot.anchorX * 100}%`,
                    top: `${shot.anchorY * 100}%`,
                  }}
                />
              </div>
              <div className="effect-chips" aria-label="Applied effects">
                <span>
                  Reframe {Math.round(shot.anchorX * 100)}/{Math.round(shot.anchorY * 100)}
                </span>
                <span>{humanize(draft.gradeId)}</span>
                <span>{humanize(shot.transitionToNext?.type ?? 'end')}</span>
              </div>
            </section>

            <section className="inspector-section form-stack">
              <h3>Source and timing</h3>
              <div className="field-grid two-columns">
                <label>
                  <FieldLabel>Source in</FieldLabel>
                  <div className="input-with-unit">
                    <input
                      name={`source-in-${shot.id}`}
                      type="number"
                      min={0}
                      max={source?.duration}
                      step={0.05}
                      value={shot.sourceIn}
                      onChange={(event) => {
                        const next = numberValue(event.target.value, shot.sourceIn);
                        dispatch({
                          type: 'slip',
                          index: shotIndex,
                          delta: next - shot.sourceIn,
                        });
                      }}
                    />
                    <span>s</span>
                  </div>
                </label>
                <label>
                  <FieldLabel>Duration</FieldLabel>
                  <div className="input-with-unit">
                    <input
                      name={`duration-${shot.id}`}
                      type="number"
                      min={0.5}
                      step={0.05}
                      value={shot.duration}
                      onChange={(event) => {
                        const next = numberValue(event.target.value, shot.duration);
                        dispatch({
                          type: 'trim',
                          index: shotIndex,
                          edge: 'end',
                          delta: next - shot.duration,
                        });
                      }}
                    />
                    <span>s</span>
                  </div>
                </label>
              </div>
              <label>
                <span className="range-label">
                  <FieldLabel>Horizontal crop anchor</FieldLabel>
                  <output>{Math.round(shot.anchorX * 100)}%</output>
                </span>
                <input
                  name={`crop-anchor-x-${shot.id}`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={shot.anchorX}
                  onChange={(event) =>
                    dispatch({
                      type: 'shot',
                      shotId: shot.id,
                      patch: { anchorX: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label>
                <span className="range-label">
                  <FieldLabel>Vertical crop anchor</FieldLabel>
                  <output>{Math.round(shot.anchorY * 100)}%</output>
                </span>
                <input
                  name={`crop-anchor-y-${shot.id}`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={shot.anchorY}
                  onChange={(event) =>
                    dispatch({
                      type: 'shot',
                      shotId: shot.id,
                      patch: { anchorY: Number(event.target.value) },
                    })
                  }
                />
              </label>
            </section>

            <section className="inspector-section form-stack">
              <h3>Editorial reason</h3>
              <label>
                <FieldLabel>Scene intent</FieldLabel>
                <textarea
                  name={`editorial-intent-${shot.id}`}
                  rows={3}
                  value={shot.editorialIntent ?? ''}
                  placeholder={`What this ${humanize(shot.storyFunction).toLowerCase()} contributes to the arc…`}
                  onChange={(event) =>
                    dispatch({
                      type: 'shot',
                      shotId: shot.id,
                      patch: { editorialIntent: event.target.value },
                    })
                  }
                />
              </label>
              <div className="context-card">
                <span>Factual music context</span>
                {nearestMoment ? (
                  <p>
                    Nearest major event: <strong>{nearestMoment.kind}</strong> at{' '}
                    {shortTime(nearestMoment.time)}. This is context, not proof that the cut is
                    creatively correct.
                  </p>
                ) : (
                  <p>No major musical event is mapped near this scene.</p>
                )}
              </div>
            </section>

            {shot.transitionToNext ? (
              <section className="inspector-section form-stack">
                <h3>Transition to next scene</h3>
                <label>
                  <FieldLabel>Type</FieldLabel>
                  <select
                    name={`transition-type-${shot.id}`}
                    value={shot.transitionToNext.type}
                    disabled={draft.audioPlan?.useSourceAudio === true}
                    onChange={(event) => {
                      const type = event.target.value;
                      dispatch({
                        type: 'transition',
                        shotId: shot.id,
                        transition: {
                          ...shot.transitionToNext!,
                          type,
                          duration:
                            type === 'cut' ? 0 : Math.max(0.2, shot.transitionToNext!.duration),
                        },
                      });
                    }}
                  >
                    {TRANSITION_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {humanize(type)}
                      </option>
                    ))}
                  </select>
                </label>
                {draft.audioPlan?.useSourceAudio ? (
                  <p className="inline-note">
                    <AudioLines aria-hidden="true" /> Native source audio keeps this boundary on a
                    hard cut.
                  </p>
                ) : shot.transitionToNext.type !== 'cut' ? (
                  <label>
                    <span className="range-label">
                      <FieldLabel>Duration</FieldLabel>
                      <output>{shortTime(shot.transitionToNext.duration)}</output>
                    </span>
                    <input
                      name={`transition-duration-${shot.id}`}
                      type="range"
                      min={0.1}
                      max={Math.min(
                        0.75,
                        shot.duration * 0.4,
                        (draft.shots[shotIndex + 1]?.duration ?? shot.duration) * 0.4,
                      )}
                      step={0.05}
                      value={shot.transitionToNext.duration}
                      onChange={(event) =>
                        dispatch({
                          type: 'transition',
                          shotId: shot.id,
                          transition: {
                            ...shot.transitionToNext!,
                            duration: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ) : null}
                <label>
                  <FieldLabel>Why this cut or transition?</FieldLabel>
                  <textarea
                    name={`transition-reason-${shot.id}`}
                    rows={2}
                    value={shot.transitionToNext.reason ?? ''}
                    placeholder="Optional authored reason…"
                    onChange={(event) =>
                      dispatch({
                        type: 'transition',
                        shotId: shot.id,
                        transition: {
                          ...shot.transitionToNext!,
                          reason: event.target.value,
                        },
                      })
                    }
                  />
                </label>
              </section>
            ) : null}
          </>
        ) : null}

        {tab === 'project' ? (
          <>
            <section className="inspector-section form-stack">
              <div className="section-heading-icon">
                <SlidersHorizontal aria-hidden="true" />
                <div>
                  <p className="eyebrow">Project settings</p>
                  <h2>Look and sound</h2>
                </div>
              </div>
              <label>
                <FieldLabel>Title</FieldLabel>
                <input
                  name="project-title"
                  type="text"
                  autoComplete="off"
                  value={draft.title ?? ''}
                  onChange={(event) =>
                    dispatch({
                      type: 'project',
                      patch: { title: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                <FieldLabel>Subtitle</FieldLabel>
                <input
                  name="project-subtitle"
                  type="text"
                  autoComplete="off"
                  value={draft.subtitle ?? ''}
                  onChange={(event) =>
                    dispatch({
                      type: 'project',
                      patch: { subtitle: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                <FieldLabel>Color grade</FieldLabel>
                <select
                  name="project-grade"
                  value={draft.gradeId}
                  onChange={(event) =>
                    dispatch({
                      type: 'project',
                      patch: { gradeId: event.target.value },
                    })
                  }
                >
                  {detail.grades.map((grade) => (
                    <option key={grade.id} value={grade.id}>
                      {grade.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="field-help">
                {detail.grades.find((grade) => grade.id === draft.gradeId)?.intent}
              </p>
            </section>

            {draft.titlePlan ? (
              <section className="inspector-section form-stack">
                <h3>Title overlay</h3>
                <div className="field-grid two-columns">
                  <label>
                    <FieldLabel>Start</FieldLabel>
                    <div className="input-with-unit">
                      <input
                        name="title-start"
                        type="number"
                        min={0}
                        max={duration}
                        step={0.05}
                        value={draft.titlePlan.timelineIn}
                        onChange={(event) =>
                          dispatch({
                            type: 'title-plan',
                            plan: {
                              ...draft.titlePlan!,
                              timelineIn: numberValue(
                                event.target.value,
                                draft.titlePlan!.timelineIn,
                              ),
                            },
                          })
                        }
                      />
                      <span>s</span>
                    </div>
                  </label>
                  <label>
                    <FieldLabel>End</FieldLabel>
                    <div className="input-with-unit">
                      <input
                        name="title-end"
                        type="number"
                        min={0}
                        max={duration}
                        step={0.05}
                        value={draft.titlePlan.timelineOut}
                        onChange={(event) =>
                          dispatch({
                            type: 'title-plan',
                            plan: {
                              ...draft.titlePlan!,
                              timelineOut: numberValue(
                                event.target.value,
                                draft.titlePlan!.timelineOut,
                              ),
                            },
                          })
                        }
                      />
                      <span>s</span>
                    </div>
                  </label>
                </div>
              </section>
            ) : null}

            {draft.music ? (
              <section className="inspector-section form-stack">
                <h3>Music excerpt</h3>
                <label>
                  <FieldLabel>Song source start</FieldLabel>
                  <div className="input-with-unit">
                    <input
                      name="music-start"
                      type="number"
                      min={0}
                      max={Math.max(0, (detail.musicDuration ?? duration) - duration)}
                      step={0.05}
                      value={draft.music.start}
                      onChange={(event) =>
                        dispatch({
                          type: 'music-start',
                          start: numberValue(event.target.value, draft.music!.start),
                        })
                      }
                    />
                    <span>s</span>
                  </div>
                </label>
                {featuredAt !== undefined ? (
                  <div className={`context-card ${featuredOutside ? 'is-warning' : ''}`}>
                    <span>Known featured phrase</span>
                    <p>
                      {featuredOutside
                        ? 'The authored featured phrase is outside this excerpt.'
                        : `Arrives at ${shortTime(featuredAt)} in the edit.`}
                    </p>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="inspector-section form-stack">
              <h3>Audio plan</h3>
              <label className="toggle-row">
                <span>
                  <FieldLabel>Native source audio</FieldLabel>
                  <small>Keep location or engine sound attached to scenes</small>
                </span>
                <input
                  name="source-audio-enabled"
                  type="checkbox"
                  checked={draft.audioPlan?.useSourceAudio === true}
                  disabled={sourceAudioUnavailable}
                  onChange={(event) =>
                    dispatch({
                      type: 'source-audio',
                      enabled: event.target.checked,
                    })
                  }
                />
              </label>
              {sourceAudioUnavailable ? (
                <p className="inline-note">
                  <AudioLines aria-hidden="true" /> Every scene must have an audio stream before
                  native audio can be enabled.
                </p>
              ) : null}
              {draft.audioPlan?.useSourceAudio ? (
                <>
                  <label>
                    <span className="range-label">
                      <FieldLabel>Source level</FieldLabel>
                      <output>{Math.round((draft.audioPlan.sourceVolume ?? 1) * 100)}%</output>
                    </span>
                    <input
                      name="source-volume"
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={draft.audioPlan.sourceVolume ?? 1}
                      onChange={(event) =>
                        dispatch({
                          type: 'project',
                          patch: {
                            audioPlan: {
                              ...draft.audioPlan,
                              sourceVolume: Number(event.target.value),
                            },
                          },
                        })
                      }
                    />
                  </label>
                  {draft.music ? (
                    <label>
                      <span className="range-label">
                        <FieldLabel>Music level</FieldLabel>
                        <output>{Math.round((draft.audioPlan.musicVolume ?? 0.35) * 100)}%</output>
                      </span>
                      <input
                        name="music-volume"
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={draft.audioPlan.musicVolume ?? 0.35}
                        onChange={(event) =>
                          dispatch({
                            type: 'project',
                            patch: {
                              audioPlan: {
                                ...draft.audioPlan,
                                musicVolume: Number(event.target.value),
                              },
                            },
                          })
                        }
                      />
                    </label>
                  ) : null}
                </>
              ) : null}
            </section>
          </>
        ) : null}

        {tab === 'review' ? (
          <>
            <section className="inspector-section review-summary">
              <div className="section-heading-icon">
                {detail.quality?.verdict === 'technical-pass' ? (
                  <CheckCircle2 className="success-icon" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="warning-icon" aria-hidden="true" />
                )}
                <div>
                  <p className="eyebrow">Latest final render</p>
                  <h2>
                    {detail.quality?.verdict === 'technical-pass'
                      ? 'Technical pass'
                      : 'Editorial review'}
                  </h2>
                </div>
              </div>
              <p>
                Machine checks confirm delivery properties only. Human editorial review remains
                required.
              </p>
            </section>
            <section className="inspector-section metric-grid">
              <div>
                <span>Shots</span>
                <strong>{detail.quality?.edit.shotCount ?? draft.shots.length}</strong>
              </div>
              <div>
                <span>Avg hold</span>
                <strong>
                  {shortTime(
                    detail.quality?.edit.averageShotSeconds ?? duration / draft.shots.length,
                  )}
                </strong>
              </div>
              <div>
                <span>Loudness</span>
                <strong>{detail.quality?.audio.integratedLufs ?? '—'} LUFS</strong>
              </div>
              <div>
                <span>Transitions</span>
                <strong>{detail.quality?.edit.stylizedTransitionCount ?? 0}</strong>
              </div>
            </section>
            <section className="inspector-section">
              <h3>Warnings</h3>
              {detail.quality?.warnings.length ? (
                <ul className="warning-list">
                  {detail.quality.warnings.map((warning) => (
                    <li key={warning}>
                      <AlertTriangle aria-hidden="true" />
                      {warning}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="quiet-line">No machine-detected delivery warnings.</p>
              )}
            </section>
            <section className="inspector-section review-sheets">
              <h3>Review sheets</h3>
              <img
                src={`/api/projects/${encodeURIComponent(detail.summary.id)}/quality/detailed-contact-sheet`}
                alt="Detailed contact sheet for the latest final render"
                loading="lazy"
              />
              <img
                src={`/api/projects/${encodeURIComponent(detail.summary.id)}/quality/transition-sheet`}
                alt="Frames surrounding the latest cut boundaries"
                loading="lazy"
              />
            </section>
          </>
        ) : null}
      </div>
    </aside>
  );
}
