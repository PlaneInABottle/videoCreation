import {
  ArrowLeft,
  Check,
  Clapperboard,
  RotateCcw,
  RotateCw,
  Save,
  Sparkles,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { BeatMap } from '@ai-video-creation/scripts/types';
import type { ProjectDetail, ProjectSummary, RenderJob } from '../shared/api.js';
import { studioApi } from './api.js';
import { Inspector } from './components/Inspector.js';
import { Monitor } from './components/Monitor.js';
import { ProjectGallery } from './components/ProjectGallery.js';
import { Timeline } from './components/Timeline.js';
import {
  draftDuration,
  draftFingerprint,
  editorIsDirty,
  editorPreviewIsStale,
  nullableEditorReducer,
} from './editor-state.js';
import { PlaybackClock } from './playback-clock.js';
import type { TimelineSnapMode } from './timeline-math.js';
import {
  beatMapAnalysisSignature,
  draftMusicAnalysisSignature,
  projectBeatMapToDraft,
} from './music-map.js';

type MusicAnalysisState = 'current' | 'refreshing' | 'error';

function projectFromPath(): string | null {
  const match = window.location.pathname.match(/^\/projects\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function jobDescription(job: RenderJob | null): string | undefined {
  if (!job || job.state === 'failed' || job.state === 'succeeded') return undefined;
  if (job.state === 'queued') return `${job.kind === 'preview' ? 'Preview' : 'Final'} queued`;
  const phase = job.progress?.phase;
  if (phase === 'segments' && job.progress?.completed && job.progress.total) {
    return `Rendering scenes ${job.progress.completed}/${job.progress.total}`;
  }
  if (phase === 'compose') return 'Composing timeline';
  if (phase === 'audio') return 'Mixing audio';
  if (phase === 'verify') return 'Verifying render';
  return job.kind === 'preview' ? 'Rendering preview' : 'Rendering final';
}

async function waitForJob(id: string, onUpdate: (job: RenderJob) => void): Promise<RenderJob> {
  for (let attempt = 0; attempt < 3600; attempt += 1) {
    const job = await studioApi.job(id);
    onUpdate(job);
    if (job.state === 'succeeded') return job;
    if (job.state === 'failed' || job.state === 'superseded') {
      throw new Error(job.error ?? `Render job ${job.state}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Render job timed out');
}

export default function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<string | null>(() => projectFromPath());
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeJob, setActiveJob] = useState<RenderJob | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | undefined>();
  const [draftBeatMap, setDraftBeatMap] = useState<BeatMap | null>(null);
  const [musicAnalysisState, setMusicAnalysisState] = useState<MusicAnalysisState>('current');
  const [snapMode, setSnapMode] = useState<TimelineSnapMode>('major');
  const [editor, dispatch] = useReducer(nullableEditorReducer, null);
  const [playbackClock] = useState(() => new PlaybackClock());
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProjects(await studioApi.listProjects());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (projectId) return;
    void loadProjects();
  }, [loadProjects, projectId]);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    setLoading(true);
    setError(null);
    setDetail(null);
    void studioApi
      .project(projectId)
      .then((loaded) => {
        if (!active) return;
        setDetail(loaded);
        dispatch({ type: 'replace', draft: loaded.draft });
        setMediaUrl(
          loaded.finalMediaUrl ? `${loaded.finalMediaUrl}?v=${loaded.revision}` : undefined,
        );
        setDraftBeatMap(loaded.beatMap);
        playbackClock.set(0);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [playbackClock, projectId]);

  const dirty = editor ? editorIsDirty(editor) : false;
  const stale = editor ? editorPreviewIsStale(editor) : false;
  const duration = editor ? draftDuration(editor.present) : 0;
  const desiredMusicAnalysis = editor ? draftMusicAnalysisSignature(editor.present) : null;
  const currentMusicAnalysis = editor
    ? beatMapAnalysisSignature(editor.present, draftBeatMap)
    : null;
  const displayedBeatMap = useMemo(
    () => (editor ? projectBeatMapToDraft(editor.present, draftBeatMap) : null),
    [draftBeatMap, editor],
  );
  const rendering = Boolean(
    activeJob && (activeJob.state === 'queued' || activeJob.state === 'running'),
  );
  const working = saving || rendering;

  useEffect(() => {
    playbackClock.set(Math.min(playbackClock.getSnapshot(), duration));
  }, [duration, playbackClock]);

  useEffect(() => {
    if (!projectId || !detail || !desiredMusicAnalysis) {
      setMusicAnalysisState('current');
      return;
    }
    if (desiredMusicAnalysis === currentMusicAnalysis) {
      setMusicAnalysisState('current');
      return;
    }

    let active = true;
    setMusicAnalysisState('refreshing');
    const timer = window.setTimeout(() => {
      const currentEditor = editorRef.current;
      if (
        !currentEditor ||
        draftMusicAnalysisSignature(currentEditor.present) !== desiredMusicAnalysis
      ) {
        return;
      }
      const submittedDraft = structuredClone(currentEditor.present);
      void studioApi
        .analyzeMusic(projectId, {
          baseRevision: detail.revision,
          draft: submittedDraft,
        })
        .then((result) => {
          if (
            !active ||
            !editorRef.current ||
            draftMusicAnalysisSignature(editorRef.current.present) !== desiredMusicAnalysis
          ) {
            return;
          }
          setDraftBeatMap(result.beatMap);
          setMusicAnalysisState('current');
        })
        .catch(() => {
          if (active) setMusicAnalysisState('error');
        });
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [currentMusicAnalysis, desiredMusicAnalysis, detail, projectId]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  useEffect(() => {
    const handleHistory = () => {
      const nextProjectId = projectFromPath();
      if (
        dirty &&
        nextProjectId !== projectId &&
        !window.confirm('Discard the unsaved storyboard draft?')
      ) {
        const currentPath = projectId ? `/projects/${encodeURIComponent(projectId)}` : '/';
        window.history.pushState({}, '', currentPath);
        return;
      }
      setProjectId(nextProjectId);
    };
    window.addEventListener('popstate', handleHistory);
    return () => window.removeEventListener('popstate', handleHistory);
  }, [dirty, projectId]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, []);

  function openProject(id: string) {
    window.history.pushState({}, '', `/projects/${encodeURIComponent(id)}`);
    setProjectId(id);
  }

  function closeProject() {
    if (dirty && !window.confirm('Discard the unsaved storyboard draft?')) return;
    window.history.pushState({}, '', '/');
    setProjectId(null);
    setDetail(null);
    setError(null);
    void loadProjects();
  }

  async function renderPreview() {
    if (!detail || !editor) return;
    const submittedDraft = structuredClone(editor.present);
    const submittedFingerprint = draftFingerprint(submittedDraft);
    setError(null);
    setNotice(null);
    try {
      const queued = await studioApi.preview(detail.summary.id, {
        baseRevision: detail.revision,
        draft: submittedDraft,
      });
      setActiveJob(queued);
      const completed = await waitForJob(queued.id, setActiveJob);
      if (!completed.result) throw new Error('Preview completed without media');
      setMediaUrl(`${completed.result.mediaUrl}?v=${encodeURIComponent(completed.updatedAt)}`);
      const stillCurrent =
        editorRef.current !== null &&
        draftFingerprint(editorRef.current.present) === submittedFingerprint;
      if (stillCurrent && completed.result.beatMap) setDraftBeatMap(completed.result.beatMap);
      dispatch({ type: 'mark-previewed', fingerprint: submittedFingerprint });
      setNotice(
        stillCurrent
          ? 'Accurate FFmpeg proxy ready'
          : 'Proxy ready for an earlier draft; live edit remains current',
      );
    } catch (renderError) {
      setError(renderError instanceof Error ? renderError.message : String(renderError));
    }
  }

  async function saveDraft() {
    if (!detail || !editor || saving) return;
    const submittedDraft = structuredClone(editor.present);
    const submittedFingerprint = draftFingerprint(submittedDraft);
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const saved = await studioApi.save(detail.summary.id, {
        baseRevision: detail.revision,
        draft: submittedDraft,
      });
      setDetail(saved);
      const stillCurrent =
        editorRef.current !== null &&
        draftFingerprint(editorRef.current.present) === submittedFingerprint;
      if (stillCurrent) setDraftBeatMap(saved.beatMap);
      dispatch({ type: 'mark-saved', fingerprint: submittedFingerprint });
      setNotice(
        stillCurrent
          ? 'Storyboard saved; final output unchanged'
          : 'Submitted draft saved; newer edits remain unsaved',
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function renderFinal() {
    if (!detail || !editor || dirty) return;
    const submittedFingerprint = draftFingerprint(editor.present);
    setError(null);
    setNotice(null);
    try {
      const queued = await studioApi.renderFinal(detail.summary.id, {
        revision: detail.revision,
      });
      setActiveJob(queued);
      const completed = await waitForJob(queued.id, setActiveJob);
      if (!completed.result) throw new Error('Final render completed without media');
      const refreshed = await studioApi.project(detail.summary.id);
      setDetail(refreshed);
      setMediaUrl(`${completed.result.mediaUrl}?v=${encodeURIComponent(completed.updatedAt)}`);
      const stillCurrent =
        editorRef.current !== null &&
        draftFingerprint(editorRef.current.present) === submittedFingerprint;
      if (stillCurrent) setDraftBeatMap(refreshed.beatMap);
      dispatch({ type: 'mark-previewed', fingerprint: submittedFingerprint });
      setNotice(
        stillCurrent
          ? 'Final output rendered, verified, and evaluated'
          : 'Final output rendered; newer edits remain in live preview',
      );
    } catch (renderError) {
      setError(renderError instanceof Error ? renderError.message : String(renderError));
    }
  }

  if (!projectId) {
    return (
      <ProjectGallery projects={projects} loading={loading} error={error} onOpen={openProject} />
    );
  }

  if (loading || !detail || !editor) {
    return (
      <main id="main-content" className="editor-loading">
        <Clapperboard aria-hidden="true" />
        <p>{error ?? 'Loading storyboard and media metadata…'}</p>
        {error ? (
          <button className="secondary-button" onClick={closeProject}>
            Back to projects
          </button>
        ) : null}
      </main>
    );
  }

  const jobLabel = jobDescription(activeJob);
  const selectedShot = editor.present.shots.find((shot) => shot.id === editor.selectedShotId);
  const timelineTitle = selectedShot?.storyFunction ?? 'No scene selected';

  return (
    <main id="main-content" className="studio-shell">
      <header className="studio-topbar">
        <div className="topbar-left">
          <button className="icon-button" onClick={closeProject} aria-label="Back to projects">
            <ArrowLeft />
          </button>
          <div className="brand-mark" aria-hidden="true">
            <Clapperboard />
          </div>
          <div className="project-identity">
            <span>{detail.summary.name}</span>
            <small>
              {timelineTitle} · {duration.toFixed(2)}s · {detail.summary.aspect}
            </small>
          </div>
        </div>
        <div className="topbar-actions">
          <span className={`save-state ${dirty ? 'is-dirty' : ''}`}>
            {dirty ? <span /> : <Check />}
            {dirty ? 'Unsaved draft' : 'Saved'}
          </span>
          <button
            className="icon-button"
            disabled={editor.past.length === 0 || working}
            onClick={() => dispatch({ type: 'undo' })}
            aria-label="Undo"
          >
            <RotateCcw />
          </button>
          <button
            className="icon-button"
            disabled={editor.future.length === 0 || working}
            onClick={() => dispatch({ type: 'redo' })}
            aria-label="Redo"
          >
            <RotateCw />
          </button>
          <span className="toolbar-divider" />
          <button
            className="secondary-button"
            disabled={working}
            onClick={() => void renderPreview()}
          >
            <Sparkles /> Update preview
          </button>
          <button
            className="secondary-button"
            disabled={!dirty || working}
            onClick={() => void saveDraft()}
            aria-busy={saving}
          >
            <Save aria-hidden="true" /> {saving ? 'Saving…' : 'Save storyboard'}
          </button>
          <button
            className="primary-button"
            disabled={dirty || working}
            onClick={() => void renderFinal()}
            title={dirty ? 'Save the storyboard before rendering the final output' : undefined}
          >
            <Upload /> Render final
          </button>
        </div>
      </header>

      <div className="studio-workspace">
        <Monitor
          {...(mediaUrl ? { source: mediaUrl } : {})}
          {...(detail.musicMediaUrl ? { musicSource: detail.musicMediaUrl } : {})}
          draft={editor.present}
          sources={detail.sources}
          aspect={editor.present.aspect}
          duration={duration}
          stale={stale}
          clock={playbackClock}
          {...(saving ? { jobLabel: 'Saving storyboard…' } : jobLabel ? { jobLabel } : {})}
        />
        <Inspector
          detail={detail}
          draft={editor.present}
          beatMap={displayedBeatMap}
          selectedShotId={editor.selectedShotId}
          dispatch={dispatch}
        />
      </div>

      <Timeline
        draft={editor.present}
        beatMap={displayedBeatMap}
        musicAnalysisState={musicAnalysisState}
        sources={detail.sources}
        {...(detail.waveformUrl ? { waveformUrl: detail.waveformUrl } : {})}
        {...(detail.musicDuration === undefined ? {} : { musicDuration: detail.musicDuration })}
        selectedShotId={editor.selectedShotId}
        clock={playbackClock}
        snapMode={snapMode}
        dispatch={dispatch}
        onSnapMode={setSnapMode}
      />

      <div className="live-region" aria-live="polite" aria-atomic="true">
        {error ? (
          <div className="toast is-error">
            {error}
            <button onClick={() => setError(null)} aria-label="Dismiss error">
              ×
            </button>
          </div>
        ) : null}
        {notice ? (
          <div className="toast is-success">
            {notice}
            <button onClick={() => setNotice(null)} aria-label="Dismiss notification">
              ×
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
