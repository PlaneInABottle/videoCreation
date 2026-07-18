import { createHash } from 'node:crypto';
import { access, readdir, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import {
  analyzeBeats,
  compileStoryboardDraft,
  probeMedia,
  readJson,
  sha256File,
  storyboardToDraft,
  streamDuration,
  writeJson,
} from '@ai-video-creation/scripts';
import type {
  BeatMap,
  ProbeResult,
  QualityReport,
  Storyboard,
  StoryboardDraft,
} from '@ai-video-creation/scripts';
import type { GradeOption, ProjectDetail, ProjectSummary, SourceInfo } from '../shared/api.js';

interface GradeKnowledge {
  grades: Array<GradeOption & { ffmpegStartingPoint: string }>;
}

export class RevisionConflictError extends Error {}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function safeId(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) throw new Error('Invalid project ID');
  return id;
}

export function resolveInside(root: string, path: string): string {
  const absolute = resolve(root, path);
  const relation = relative(root, absolute);
  if (relation === '..' || relation.startsWith(`..${sep}`) || relation.startsWith('/')) {
    throw new Error('Media path escapes the project root');
  }
  return absolute;
}

function contentHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class ProjectStore {
  readonly root: string;
  readonly projectsRoot: string;
  readonly studioCache: string;
  private readonly projectLocks = new Map<string, Promise<void>>();
  private readonly mediaProbeCache = new Map<
    string,
    { signature: string; result: Promise<ProbeResult> }
  >();

  constructor(root: string) {
    this.root = root;
    this.projectsRoot = resolve(root, 'projects');
    this.studioCache = resolve(root, '.cache', 'studio');
  }

  projectDirectory(id: string): string {
    return resolve(this.projectsRoot, safeId(id));
  }

  storyboardPath(id: string): string {
    return resolve(this.projectDirectory(id), 'storyboard.json');
  }

  async withProjectLock<T>(id: string, task: () => Promise<T>): Promise<T> {
    const key = safeId(id);
    const previous = this.projectLocks.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const tail = previous.catch(() => undefined).then(async () => await gate);
    this.projectLocks.set(key, tail);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.projectLocks.get(key) === tail) this.projectLocks.delete(key);
    }
  }

  async projectIds(): Promise<string[]> {
    const entries = await readdir(this.projectsRoot, { withFileTypes: true });
    const ids: string[] = [];
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        (await exists(resolve(this.projectsRoot, entry.name, 'storyboard.json')))
      ) {
        ids.push(entry.name);
      }
    }
    return ids.sort();
  }

  private async mediaProbe(path: string): Promise<ProbeResult> {
    const details = await stat(path);
    const signature = `${details.size}:${details.mtimeMs}`;
    const cached = this.mediaProbeCache.get(path);
    if (cached?.signature === signature) return await cached.result;

    const result = probeMedia(path);
    this.mediaProbeCache.set(path, { signature, result });
    if (this.mediaProbeCache.size > 256) {
      const oldest = this.mediaProbeCache.keys().next().value as string | undefined;
      if (oldest && oldest !== path) this.mediaProbeCache.delete(oldest);
    }
    try {
      return await result;
    } catch (error) {
      if (this.mediaProbeCache.get(path)?.result === result) this.mediaProbeCache.delete(path);
      throw error;
    }
  }

  async canonical(id: string): Promise<{ storyboard: Storyboard; revision: string }> {
    const path = this.storyboardPath(id);
    if (!(await exists(path))) throw new Error(`Project not found: ${id}`);
    return {
      storyboard: await readJson<Storyboard>(path),
      revision: await sha256File(path),
    };
  }

  private async quality(id: string): Promise<QualityReport | null> {
    const path = resolve(this.projectDirectory(id), 'quality', 'report.json');
    return (await exists(path)) ? await readJson<QualityReport>(path) : null;
  }

  private async beatMap(storyboard: Storyboard): Promise<BeatMap | null> {
    if (!storyboard.music) return null;
    const path = resolveInside(this.root, storyboard.music.beatMap);
    return (await exists(path)) ? await readJson<BeatMap>(path) : null;
  }

  private async summaryFrom(
    id: string,
    storyboard: Storyboard,
    quality: QualityReport | null,
  ): Promise<ProjectSummary> {
    const outputAvailable = await exists(resolveInside(this.root, storyboard.output));
    const posterPath = resolve(this.projectDirectory(id), 'quality', 'contact-sheet.jpg');
    return {
      id,
      name: storyboard.title ?? id.replaceAll('-', ' '),
      ...(storyboard.subtitle ? { subtitle: storyboard.subtitle } : {}),
      durationSeconds: storyboard.durationSeconds,
      aspect: storyboard.aspect,
      ...(storyboard.sourceMode ? { sourceMode: storyboard.sourceMode } : {}),
      shotCount: storyboard.shots.length,
      outputAvailable,
      ...(quality ? { qualityVerdict: quality.verdict } : {}),
      warningCount: quality?.warnings.length ?? 0,
      ...((await exists(posterPath))
        ? {
            posterUrl: `/api/projects/${encodeURIComponent(id)}/quality/contact-sheet`,
          }
        : {}),
    };
  }

  async list(): Promise<ProjectSummary[]> {
    return await Promise.all(
      (await this.projectIds()).map(async (id) => {
        const { storyboard } = await this.canonical(id);
        const quality = await this.quality(id);
        return await this.summaryFrom(id, storyboard, quality);
      }),
    );
  }

  async sourceInfos(id: string, storyboard: Storyboard): Promise<SourceInfo[]> {
    const probes = new Map<string, Promise<SourceInfo>>();
    return await Promise.all(
      storyboard.shots.map(async (shot) => {
        let probe = probes.get(shot.source);
        if (!probe) {
          probe = (async () => {
            const path = resolveInside(this.root, shot.source);
            if (!(await exists(path))) {
              return { shotId: '', source: shot.source, available: false };
            }
            try {
              const result = await this.mediaProbe(path);
              const video = result.streams.find((stream) => stream.codec_type === 'video');
              if (!video) return { shotId: '', source: shot.source, available: false };
              return {
                shotId: '',
                source: shot.source,
                available: true,
                duration: streamDuration(video, result.format.duration),
                ...(video?.width ? { width: video.width } : {}),
                ...(video?.height ? { height: video.height } : {}),
                hasAudio: result.streams.some((stream) => stream.codec_type === 'audio'),
              };
            } catch {
              return { shotId: '', source: shot.source, available: false };
            }
          })();
          probes.set(shot.source, probe);
        }
        const info = await probe;
        return {
          ...info,
          shotId: shot.id,
          ...(info.available
            ? {
                mediaUrl: `/api/projects/${encodeURIComponent(id)}/shots/${encodeURIComponent(shot.id)}/source`,
                thumbnailUrl: `/api/projects/${encodeURIComponent(id)}/shots/${encodeURIComponent(shot.id)}/thumbnail`,
              }
            : {}),
        };
      }),
    );
  }

  async detail(id: string): Promise<ProjectDetail> {
    const { storyboard, revision } = await this.canonical(id);
    const [quality, beatMap, sources, gradeKnowledge] = await Promise.all([
      this.quality(id),
      this.beatMap(storyboard),
      this.sourceInfos(id, storyboard),
      readJson<GradeKnowledge>(resolve(this.root, 'knowledge', 'color-grades.json')),
    ]);
    const summary = await this.summaryFrom(id, storyboard, quality);
    let musicDuration: number | undefined;
    if (storyboard.music) {
      const musicPath = resolveInside(this.root, storyboard.music.file);
      if (await exists(musicPath)) {
        const media = await this.mediaProbe(musicPath);
        const audio = media.streams.find((stream) => stream.codec_type === 'audio');
        if (!audio) throw new Error('Music file has no audio stream');
        musicDuration = streamDuration(audio, media.format.duration);
      }
    }
    return {
      summary,
      revision,
      storyboard,
      draft: storyboardToDraft(storyboard),
      beatMap,
      quality,
      sources,
      grades: gradeKnowledge.grades.map(({ id: gradeId, name, intent }) => ({
        id: gradeId,
        name,
        intent,
      })),
      ...(summary.outputAvailable
        ? { finalMediaUrl: `/api/projects/${encodeURIComponent(id)}/output` }
        : {}),
      ...(storyboard.music && musicDuration !== undefined
        ? {
            musicMediaUrl: `/api/projects/${encodeURIComponent(id)}/music/source`,
            waveformUrl: `/api/projects/${encodeURIComponent(id)}/music/waveform`,
            musicDuration,
          }
        : {}),
    };
  }

  private validateStableAssets(draft: StoryboardDraft, canonical: Storyboard): void {
    if (draft.projectId !== canonical.projectId) throw new Error('Project ID cannot be changed');
    if (draft.output !== canonical.output)
      throw new Error('Output path cannot be changed in Studio');
    if (
      draft.createdAt !== canonical.createdAt ||
      draft.videoTypeId !== canonical.videoTypeId ||
      draft.sourceMode !== canonical.sourceMode ||
      draft.aspect !== canonical.aspect ||
      draft.width !== canonical.width ||
      draft.height !== canonical.height ||
      draft.fps !== canonical.fps
    ) {
      throw new Error('Project format metadata cannot be changed in Studio');
    }
    if (
      draft.voiceoverFile !== canonical.voiceoverFile ||
      draft.captionsFile !== canonical.captionsFile
    ) {
      throw new Error('Dialogue asset paths cannot be changed in Studio');
    }
    if (draft.shots.length !== canonical.shots.length) {
      throw new Error('Studio v1 cannot add or remove source shots');
    }
    const sources = new Map(canonical.shots.map((shot) => [shot.id, shot.source]));
    for (const shot of draft.shots) {
      if (sources.get(shot.id) !== shot.source) {
        throw new Error(`Source path for ${shot.id} cannot be changed in Studio`);
      }
      resolveInside(this.root, shot.source);
    }
    if (
      draft.music?.file !== canonical.music?.file ||
      draft.music?.beatMap !== canonical.music?.beatMap
    ) {
      throw new Error('Music asset paths cannot be changed in Studio');
    }
  }

  private async prepareDraftUnlocked(
    id: string,
    baseRevision: string,
    draft: StoryboardDraft,
  ): Promise<{
    storyboard: Storyboard;
    beatMap: BeatMap | null;
    draftHash: string;
  }> {
    const canonical = await this.canonical(id);
    if (canonical.revision !== baseRevision) {
      throw new RevisionConflictError('The storyboard changed after this draft was opened');
    }
    this.validateStableAssets(draft, canonical.storyboard);
    const sourceInfos = await this.sourceInfos(id, canonical.storyboard);
    if (draft.audioPlan?.useSourceAudio) {
      const silentSource = sourceInfos.find((info) => !info.available || info.hasAudio !== true);
      if (silentSource) {
        throw new Error(`Source media has no audio stream for shot ${silentSource.shotId}`);
      }
    }
    const durations = new Map<string, number>();
    for (const info of sourceInfos) {
      if (!info.available || info.duration === undefined) {
        throw new Error(`Source media is unavailable for shot ${info.shotId}`);
      }
      durations.set(info.source, info.duration);
    }
    const storyboard = compileStoryboardDraft(draft, {
      sourceDurations: durations,
    });
    const gradeKnowledge = await readJson<GradeKnowledge>(
      resolve(this.root, 'knowledge', 'color-grades.json'),
    );
    if (!gradeKnowledge.grades.some((grade) => grade.id === storyboard.gradeId)) {
      throw new Error(`Unknown color grade: ${storyboard.gradeId}`);
    }
    let beatMap = await this.beatMap(canonical.storyboard);
    if (storyboard.music) {
      const musicPath = resolveInside(this.root, storyboard.music.file);
      if (!(await exists(musicPath))) throw new Error('Music media is unavailable');
      const media = await this.mediaProbe(musicPath);
      const audio = media.streams.find((stream) => stream.codec_type === 'audio');
      if (!audio) throw new Error('Music file has no audio stream');
      const duration = streamDuration(audio, media.format.duration);
      if (storyboard.music.start + storyboard.durationSeconds > duration + 0.001) {
        throw new Error('The selected music excerpt extends beyond the source track');
      }
      if (
        storyboard.music.start !== canonical.storyboard.music?.start ||
        storyboard.durationSeconds !== canonical.storyboard.durationSeconds
      ) {
        beatMap = await analyzeBeats(
          musicPath,
          storyboard.music.start,
          storyboard.music.start + storyboard.durationSeconds,
        );
      }
    }
    return { storyboard, beatMap, draftHash: contentHash(storyboard) };
  }

  async prepareDraft(
    id: string,
    baseRevision: string,
    draft: StoryboardDraft,
  ): Promise<{
    storyboard: Storyboard;
    beatMap: BeatMap | null;
    draftHash: string;
  }> {
    return await this.withProjectLock(
      id,
      async () => await this.prepareDraftUnlocked(id, baseRevision, draft),
    );
  }

  async saveDraft(
    id: string,
    baseRevision: string,
    draft: StoryboardDraft,
  ): Promise<ProjectDetail> {
    return await this.withProjectLock(id, async () => {
      const prepared = await this.prepareDraftUnlocked(id, baseRevision, draft);
      if (prepared.storyboard.music && prepared.beatMap) {
        await writeJson(
          resolveInside(this.root, prepared.storyboard.music.beatMap),
          prepared.beatMap,
        );
      }
      await writeJson(this.storyboardPath(id), prepared.storyboard);
      return await this.detail(id);
    });
  }

  async assertRevision(id: string, revision: string): Promise<Storyboard> {
    const canonical = await this.canonical(id);
    if (canonical.revision !== revision) {
      throw new RevisionConflictError(
        'Save the latest storyboard before rendering the final output',
      );
    }
    return canonical.storyboard;
  }

  async sourcePath(id: string, shotId: string): Promise<string> {
    const { storyboard } = await this.canonical(id);
    const shot = storyboard.shots.find((candidate) => candidate.id === shotId);
    if (!shot) throw new Error('Shot not found');
    return resolveInside(this.root, shot.source);
  }

  async outputPath(id: string): Promise<string> {
    const { storyboard } = await this.canonical(id);
    return resolveInside(this.root, storyboard.output);
  }

  qualityAssetPath(id: string, asset: string): string {
    const names: Record<string, string> = {
      'contact-sheet': 'contact-sheet.jpg',
      'detailed-contact-sheet': 'detailed-contact-sheet.jpg',
      'transition-sheet': 'transition-sheet.jpg',
    };
    const name = names[asset];
    if (!name) throw new Error('Unknown quality asset');
    return resolve(this.projectDirectory(id), 'quality', name);
  }

  async musicPath(id: string): Promise<string> {
    const { storyboard } = await this.canonical(id);
    if (!storyboard.music) throw new Error('Project has no music');
    return resolveInside(this.root, storyboard.music.file);
  }

  async shotThumbnailKey(id: string, shotId: string): Promise<string> {
    const { storyboard } = await this.canonical(id);
    const shot = storyboard.shots.find((candidate) => candidate.id === shotId);
    if (!shot) throw new Error('Shot not found');
    const media = resolveInside(this.root, shot.source);
    const details = await stat(media);
    return contentHash({
      media,
      mtime: details.mtimeMs,
      sourceIn: shot.sourceIn,
    });
  }
}
