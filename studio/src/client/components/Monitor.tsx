import { Pause, Play, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AspectRatio, StoryboardDraft } from '@ai-video-creation/scripts/types';
import type { SourceInfo } from '../../shared/api.js';
import { formatTime } from '../format.js';
import type { PlaybackClock } from '../playback-clock.js';

type MonitorMode = 'live' | 'rendered';

const LIVE_VIDEO_DRIFT_TOLERANCE = 0.08;
const LIVE_MUSIC_SEEK_TOLERANCE = 0.05;

interface MonitorProps {
  source?: string;
  musicSource?: string;
  draft: StoryboardDraft;
  sources: SourceInfo[];
  aspect: AspectRatio;
  duration: number;
  stale: boolean;
  clock: PlaybackClock;
  jobLabel?: string;
}

function shotAt(draft: StoryboardDraft, time: number) {
  let cursor = 0;
  for (const shot of draft.shots) {
    const end = cursor + shot.duration;
    if (time < end || shot === draft.shots.at(-1)) {
      return { shot, localTime: Math.max(0, Math.min(shot.duration, time - cursor)) };
    }
    cursor = end;
  }
  return null;
}

function musicVolumeAt(draft: StoryboardDraft, time: number): number {
  const mixedLevel = draft.audioPlan?.useSourceAudio ? (draft.audioPlan.musicVolume ?? 0.35) : 1;
  const start = draft.music?.volumeStart;
  const fullAt = draft.music?.volumeFullAt;
  if (start === undefined || fullAt === undefined || fullAt <= 0) return mixedLevel;
  const envelope = Math.max(0, Math.min(1, start + (1 - start) * Math.min(1, time / fullAt)));
  return Math.max(0, Math.min(1, mixedLevel * envelope));
}

function LiveTitleOverlay({ clock, draft }: { clock: PlaybackClock; draft: StoryboardDraft }) {
  const currentTime = useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
  const plan = draft.titlePlan;
  if (!draft.title || !plan || currentTime < plan.timelineIn || currentTime > plan.timelineOut) {
    return null;
  }
  return (
    <div
      className="live-title-overlay"
      style={{
        left: `${plan.anchorX * 100}%`,
        top: `${plan.anchorY * 100}%`,
        transform: `translateX(-${plan.anchorX * 100}%)`,
      }}
    >
      <strong>{draft.title.toUpperCase()}</strong>
      {draft.subtitle ? <span>{draft.subtitle}</span> : null}
    </div>
  );
}

function TransportPosition({ clock, duration }: { clock: PlaybackClock; duration: number }) {
  const currentTime = Math.min(
    duration,
    useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot),
  );
  return (
    <>
      <span className="timecode">{formatTime(currentTime)}</span>
      <div className="transport-progress" aria-hidden="true">
        <span
          style={{ width: `${Math.min(100, (currentTime / Math.max(duration, 0.001)) * 100)}%` }}
        />
      </div>
    </>
  );
}

export function Monitor({
  source,
  musicSource,
  draft,
  sources,
  aspect,
  duration,
  stale,
  clock,
  jobLabel,
}: MonitorProps) {
  const renderedVideoRef = useRef<HTMLVideoElement>(null);
  const liveVideosRef = useRef(new Map<string, HTMLVideoElement>());
  const musicRef = useRef<HTMLAudioElement>(null);
  const currentTimeRef = useRef(clock.getSnapshot());
  const livePlaybackAnchorRef = useRef({ timeline: currentTimeRef.current, wall: 0 });
  const playingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<MonitorMode>(stale || !source ? 'live' : 'rendered');
  const initialActiveShotId = shotAt(draft, clock.getSnapshot())?.shot.id;

  playingRef.current = playing;

  function pauseAllMedia() {
    renderedVideoRef.current?.pause();
    for (const video of liveVideosRef.current.values()) video.pause();
    musicRef.current?.pause();
  }

  const syncLiveMedia = useCallback(
    (time: number, shouldPlay: boolean) => {
      const located = shotAt(draft, time);
      for (const [shotId, video] of liveVideosRef.current) {
        const active = shotId === located?.shot.id;
        video.classList.toggle('is-active', active);
        if (!active) video.pause();
      }
      if (located) {
        const video = liveVideosRef.current.get(located.shot.id);
        if (video && video.readyState >= 1) {
          const target = located.shot.sourceIn + located.localTime;
          if (Math.abs(video.currentTime - target) > LIVE_VIDEO_DRIFT_TOLERANCE) {
            video.currentTime = target;
          }
          video.muted = draft.audioPlan?.useSourceAudio !== true;
          video.volume = Math.max(0, Math.min(1, draft.audioPlan?.sourceVolume ?? 1));
          if (shouldPlay && video.paused) void video.play().catch(() => undefined);
        }
      }
      const music = musicRef.current;
      if (music && draft.music) {
        const target = draft.music.start + time;
        if (
          music.readyState >= 1 &&
          Math.abs(music.currentTime - target) > LIVE_MUSIC_SEEK_TOLERANCE
        ) {
          music.currentTime = target;
        }
        music.volume = musicVolumeAt(draft, time);
        if (shouldPlay && music.paused) void music.play().catch(() => undefined);
      }
    },
    [draft],
  );

  useEffect(() => {
    if (stale) setMode('live');
    else if (source) setMode('rendered');
  }, [source, stale]);

  useEffect(() => {
    pauseAllMedia();
    setPlaying(false);
  }, [mode, source]);

  useEffect(() => {
    const synchronize = () => {
      const currentTime = Math.min(clock.getSnapshot(), duration);
      const externalSeek = Math.abs(currentTime - currentTimeRef.current) > 0.01;
      currentTimeRef.current = currentTime;
      if (playingRef.current && !externalSeek) return;
      if (playingRef.current && externalSeek) {
        livePlaybackAnchorRef.current = { timeline: currentTime, wall: performance.now() };
      }
      if (mode === 'rendered') {
        const video = renderedVideoRef.current;
        if (video && Math.abs(video.currentTime - currentTime) > 0.18) {
          video.currentTime = Math.min(currentTime, video.duration || duration);
        }
      } else {
        syncLiveMedia(currentTime, playingRef.current);
      }
    };
    synchronize();
    return clock.subscribe(synchronize);
  }, [clock, duration, mode, syncLiveMedia]);

  useEffect(() => {
    if (!playing) return;
    const timelineStart = currentTimeRef.current >= duration - 0.01 ? 0 : currentTimeRef.current;
    if (timelineStart !== currentTimeRef.current) {
      currentTimeRef.current = timelineStart;
      clock.set(timelineStart);
    }
    livePlaybackAnchorRef.current = { timeline: timelineStart, wall: performance.now() };
    let animationFrame = 0;
    const update = (now: number) => {
      const renderedTime = renderedVideoRef.current?.currentTime;
      const music = musicRef.current;
      const liveMusicTime =
        mode === 'live' && draft.music && music && !music.paused
          ? Math.max(0, music.currentTime - draft.music.start)
          : undefined;
      const liveAnchor = livePlaybackAnchorRef.current;
      const next =
        mode === 'rendered' && renderedTime !== undefined
          ? renderedTime
          : liveMusicTime !== undefined
            ? liveMusicTime
            : liveAnchor.timeline + (now - liveAnchor.wall) / 1000;
      if (next >= duration) {
        clock.set(duration);
        pauseAllMedia();
        setPlaying(false);
        return;
      }
      currentTimeRef.current = next;
      if (mode === 'live') syncLiveMedia(next, true);
      clock.set(next);
      animationFrame = requestAnimationFrame(update);
    };
    animationFrame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animationFrame);
  }, [clock, duration, mode, playing, syncLiveMedia]);

  async function togglePlayback() {
    if (playing) {
      pauseAllMedia();
      setPlaying(false);
      return;
    }
    if (mode === 'rendered') {
      const video = renderedVideoRef.current;
      if (!video) return;
      const currentTime = clock.getSnapshot();
      if (currentTime >= duration - 0.01) {
        video.currentTime = 0;
        currentTimeRef.current = 0;
        clock.set(0);
      }
      try {
        await video.play();
      } catch {
        return;
      }
      setPlaying(true);
      return;
    }
    const currentTime = clock.getSnapshot();
    const start = currentTime >= duration - 0.01 ? 0 : currentTime;
    currentTimeRef.current = start;
    if (start !== currentTime) clock.set(start);
    syncLiveMedia(start, true);
    setPlaying(true);
  }

  function changeMode(next: MonitorMode) {
    if (next === mode || (next === 'rendered' && !source)) return;
    pauseAllMedia();
    setPlaying(false);
    setMode(next);
  }

  return (
    <section className="monitor-panel" aria-label="Program monitor">
      <div className={`program-stage is-${aspect.replace(':', '-')}`}>
        <div className="monitor-mode-switch" aria-label="Preview mode">
          <button
            aria-pressed={mode === 'live'}
            className={mode === 'live' ? 'is-active' : ''}
            onClick={() => changeMode('live')}
          >
            Live edit
          </button>
          <button
            aria-pressed={mode === 'rendered'}
            className={mode === 'rendered' ? 'is-active' : ''}
            disabled={!source}
            onClick={() => changeMode('rendered')}
          >
            Rendered
          </button>
        </div>

        {mode === 'rendered' && source ? (
          <video ref={renderedVideoRef} src={source} playsInline preload="metadata" />
        ) : (
          <div className="live-video-stack">
            {draft.shots.map((shot) => {
              const media = sources.find((candidate) => candidate.shotId === shot.id);
              return media?.mediaUrl ? (
                <video
                  key={shot.id}
                  data-shot-id={shot.id}
                  ref={(element) => {
                    if (element) liveVideosRef.current.set(shot.id, element);
                    else liveVideosRef.current.delete(shot.id);
                  }}
                  className={initialActiveShotId === shot.id ? 'is-active' : ''}
                  src={media.mediaUrl}
                  muted={draft.audioPlan?.useSourceAudio !== true}
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={() => syncLiveMedia(currentTimeRef.current, playing)}
                />
              ) : null;
            })}
            {draft.music && musicSource ? (
              <audio ref={musicRef} src={musicSource} preload="metadata" />
            ) : null}
            {sources.every((candidate) => !candidate.mediaUrl) ? (
              <div className="monitor-empty">
                <Play aria-hidden="true" />
                <p>No source scene is available at this time.</p>
              </div>
            ) : null}
          </div>
        )}

        {mode === 'live' ? <LiveTitleOverlay clock={clock} draft={draft} /> : null}

        <div className="safe-frame" aria-hidden="true" />
        {jobLabel ? (
          <div className="monitor-status is-working">
            <RefreshCw className="spin" aria-hidden="true" /> {jobLabel}
          </div>
        ) : mode === 'live' ? (
          <div className="monitor-status is-live">Live cuts · render for exact effects</div>
        ) : stale ? (
          <div className="monitor-status">Rendered preview out of date</div>
        ) : null}
      </div>
      <div className="transport-bar">
        <button
          className="icon-button transport-play"
          onClick={() => void togglePlayback()}
          disabled={mode === 'rendered' ? !source : sources.length === 0}
          aria-label={playing ? 'Pause preview' : 'Play preview'}
        >
          {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
        </button>
        <TransportPosition clock={clock} duration={duration} />
        <span className="timecode is-muted">{formatTime(duration)}</span>
      </div>
    </section>
  );
}
