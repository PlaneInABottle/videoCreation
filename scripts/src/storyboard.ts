import { relative, resolve } from 'node:path';
import { projectRoot, readJson, writeJson } from './config.js';
import type {
  BeatMap,
  DownloadedVideo,
  MusicMoment,
  MusicSection,
  ProjectConfig,
  Storyboard,
  TransitionPlan,
} from './types.js';

interface VideoTypeKnowledge {
  id: string;
  narrativePattern: string[];
}

interface VideoTypesKnowledge {
  types: VideoTypeKnowledge[];
}

export function dimensionsForAspect(aspect: '9:16' | '16:9'): { width: number; height: number } {
  return aspect === '9:16' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
}

export function chooseCutBoundaries(duration: number, count: number, events: number[]): number[] {
  if (count < 1) throw new Error('At least one shot is required');
  const sortedEvents = [...events]
    .filter((event) => event > 0 && event < duration)
    .sort((a, b) => a - b);
  const boundaries = [0];
  for (let index = 1; index < count; index += 1) {
    const desired = (duration * index) / count;
    const previous = boundaries.at(-1) ?? 0;
    const candidate = sortedEvents
      .filter((event) => event - previous >= 1.2 && duration - event >= (count - index) * 1.2)
      .sort((left, right) => Math.abs(left - desired) - Math.abs(right - desired))[0];
    boundaries.push(
      candidate !== undefined && Math.abs(candidate - desired) <= 0.8 ? candidate : desired,
    );
  }
  boundaries.push(duration);
  return boundaries.map((value) => Number(value.toFixed(4)));
}

export function validateAuthoredCutTimes(
  cutTimes: number[],
  duration: number,
  shotCount: number,
): number[] {
  if (cutTimes.length !== shotCount + 1) {
    throw new Error(`Authored cut map requires ${shotCount + 1} times for ${shotCount} shots`);
  }
  if (Math.abs((cutTimes[0] ?? -1) - 0) > 0.001) {
    throw new Error('Authored cut map must start at 0');
  }
  if (Math.abs((cutTimes.at(-1) ?? -1) - duration) > 0.001) {
    throw new Error(`Authored cut map must end at ${duration.toFixed(3)}s`);
  }
  if (cutTimes.some((time, index) => index > 0 && time <= (cutTimes[index - 1] ?? 0))) {
    throw new Error('Authored cut map must be strictly increasing');
  }
  return cutTimes.map((time) => Number(time.toFixed(4)));
}

export function chooseStructuralCutBoundaries(
  duration: number,
  count: number,
  majorMoments: MusicMoment[],
  microEvents: number[],
  requestedPayoffIndex?: number,
  sections: MusicSection[] = [],
): number[] {
  if (count < 1) throw new Error('At least one shot is required');
  const preferredMoments = majorMoments
    .filter((moment) => moment.time >= duration * 0.55 && moment.time <= duration * 0.84)
    .sort((left, right) => {
      const kindWeight = (moment: MusicMoment): number =>
        moment.kind === 'lift' || moment.kind === 'impact' ? 0.5 : 0;
      return right.strength + kindWeight(right) - (left.strength + kindWeight(left));
    });
  const payoffTime = preferredMoments[0]?.time ?? duration * 0.68;
  const payoffIndex = Math.max(
    1,
    Math.min(count - 1, requestedPayoffIndex ?? Math.round(count * 0.65)),
  );
  const boundaries = [0];
  const appendWeighted = (start: number, end: number, weights: number[]): void => {
    const total = weights.reduce((sum, value) => sum + value, 0);
    let cursor = start;
    for (const weight of weights) {
      cursor += ((end - start) * weight) / Math.max(total, 1e-6);
      boundaries.push(cursor);
    }
  };
  const appendSectionAware = (start: number, end: number, shotCount: number): void => {
    const step = 0.05;
    const samples: Array<{ time: number; density: number }> = [];
    const averageEnergy =
      sections.reduce((sum, section) => sum + section.energy, 0) / Math.max(sections.length, 1);
    for (let time = start; time < end; time += step) {
      const section = sections.find((candidate) => time >= candidate.start && time < candidate.end);
      const labelDensity =
        section?.label === 'build'
          ? 1.3
          : section?.label === 'peak'
            ? 0.95
            : section?.label === 'calm'
              ? 0.65
              : section?.label === 'release'
                ? 0.72
                : 0.85;
      const energyFactor = section
        ? Math.max(0.8, Math.min(1.2, section.energy / Math.max(averageEnergy, 1e-6)))
        : 1;
      samples.push({ time: Math.min(time + step, end), density: labelDensity * energyFactor });
    }
    const total = samples.reduce((sum, sample) => sum + sample.density, 0);
    for (let index = 1; index <= shotCount; index += 1) {
      const target = (total * index) / shotCount;
      let cumulative = 0;
      const sample = samples.find((candidate) => {
        cumulative += candidate.density;
        return cumulative >= target;
      });
      boundaries.push(index === shotCount ? end : (sample?.time ?? end));
    }
  };

  if (sections.length > 0 && payoffIndex > 1) {
    const hookEnd = Math.min(1.5, payoffTime * 0.25);
    boundaries.push(hookEnd);
    appendSectionAware(hookEnd, payoffTime, payoffIndex - 1);
    appendSectionAware(payoffTime, duration, count - payoffIndex);
  } else {
    const beforeWeights = Array.from({ length: payoffIndex }, (_, index) => {
      if (index === 0) return 0.55;
      const progress = index / Math.max(payoffIndex - 1, 1);
      if (progress < 0.45) return 1.2;
      if (progress < 0.75) return 0.9;
      return 0.58;
    });
    const afterCount = count - payoffIndex;
    const afterWeights = Array.from({ length: afterCount }, (_, index) => {
      if (index === 0) return 1.8;
      if (index === afterCount - 1) return 1.35;
      return 0.9;
    });
    appendWeighted(0, payoffTime, beforeWeights);
    appendWeighted(payoffTime, duration, afterWeights);
  }

  const sortedEvents = [...microEvents].sort((left, right) => left - right);
  for (let index = 1; index < boundaries.length - 1; index += 1) {
    if (index === payoffIndex) continue;
    const desired = boundaries[index] ?? 0;
    const previous = boundaries[index - 1] ?? 0;
    const next = boundaries[index + 1] ?? duration;
    const nearby = sortedEvents
      .filter((event) => event - previous >= 0.55 && next - event >= 0.55)
      .sort((left, right) => Math.abs(left - desired) - Math.abs(right - desired))[0];
    if (nearby !== undefined && Math.abs(nearby - desired) <= 0.12) boundaries[index] = nearby;
  }
  return boundaries.map((value) => Number(value.toFixed(4)));
}

export function payoffShotIndex(narrativePattern: string[], shotCount: number): number {
  const patternIndex = narrativePattern.findIndex((storyFunction) =>
    /payoff|hero-reveal|arrival|landmark|takeaway|result/.test(storyFunction),
  );
  if (patternIndex < 0 || narrativePattern.length === 0) return Math.round(shotCount * 0.65);
  return Math.min(shotCount - 1, Math.ceil((patternIndex * shotCount) / narrativePattern.length));
}

export function interleaveByQuery<T extends { query: string }>(items: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.query, [...(groups.get(item.query) ?? []), item]);
  const result: T[] = [];
  for (let index = 0; result.length < items.length; index += 1) {
    for (const group of groups.values()) {
      const item = group[index];
      if (item) result.push(item);
    }
  }
  return result;
}

export function resolveSourceIn(
  configuredSourceIn: number | undefined,
  maximumStart: number,
  fallbackFraction: number,
): number {
  if (configuredSourceIn === undefined) {
    return Number((maximumStart * fallbackFraction).toFixed(4));
  }
  if (configuredSourceIn < 0 || configuredSourceIn > maximumStart + 0.001) {
    throw new Error(
      `Reviewed source start ${configuredSourceIn.toFixed(3)}s exceeds the usable range 0-${maximumStart.toFixed(3)}s`,
    );
  }
  return configuredSourceIn;
}

export function transitionFor(
  index: number,
  shotCount: number,
  cutTime?: number,
  transitionAccents: Array<{ time: number; type: string; duration: number }> = [],
): TransitionPlan | null {
  if (index === shotCount - 1) return null;
  if (cutTime !== undefined) {
    const accent = transitionAccents.find(
      (candidate) => Math.abs(candidate.time - cutTime) <= 0.01,
    );
    if (accent) return { type: accent.type, duration: accent.duration };
  }
  return { type: 'cut', duration: 0 };
}

export async function createStoryboard(
  config: ProjectConfig,
  assets: DownloadedVideo[],
  musicFile: string,
  beatMap: BeatMap,
  projectDirectory: string,
): Promise<Storyboard> {
  if (assets.length === 0) throw new Error('Cannot create a storyboard without video assets');
  const knowledge = await readJson<VideoTypesKnowledge>(
    resolve(projectRoot, 'knowledge', 'video-types.json'),
  );
  const type = knowledge.types.find((candidate) => candidate.id === config.type);
  if (!type) throw new Error(`Unknown video type: ${config.type}`);

  const dimensions = dimensionsForAspect(config.aspect);
  const orderedAssets = interleaveByQuery(assets);
  const microEvents = [...beatMap.beats, ...beatMap.onsets];
  const analyzedMoments = beatMap.majorMoments ?? [];
  const featuredAt =
    config.musicHookTime === undefined
      ? undefined
      : Number(Math.max(0, config.musicHookTime - (config.musicStart ?? 0)).toFixed(3));
  const majorMoments =
    config.musicHookRole === 'payoff' && featuredAt !== undefined
      ? [
          ...analyzedMoments,
          {
            time: featuredAt,
            kind: 'lift' as const,
            strength: Math.max(...analyzedMoments.map((moment) => moment.strength), 0) + 1,
          },
        ]
      : analyzedMoments;
  const boundaries = config.cutTimes
    ? validateAuthoredCutTimes(config.cutTimes, config.length, orderedAssets.length)
    : config.editStyle === 'social-arc'
      ? chooseStructuralCutBoundaries(
          config.length,
          orderedAssets.length,
          majorMoments,
          microEvents,
          payoffShotIndex(type.narrativePattern, orderedAssets.length),
          beatMap.sections ?? [],
        )
      : chooseCutBoundaries(config.length, orderedAssets.length, microEvents);
  const shots = orderedAssets.map((asset, index) => {
    const timelineIn = boundaries[index] ?? 0;
    const timelineOut = boundaries[index + 1] ?? config.length;
    const transition = transitionFor(
      index,
      orderedAssets.length,
      timelineOut,
      config.transitionAccents,
    );
    const sourceDuration = timelineOut - timelineIn + (transition?.duration ?? 0);
    if (asset.video.duration + 0.01 < sourceDuration) {
      throw new Error(
        `Pexels video ${asset.video.id} is ${asset.video.duration}s but shot requires ${sourceDuration.toFixed(2)}s`,
      );
    }
    const maximumStart = Math.max(0, asset.video.duration - sourceDuration - 0.05);
    const queryConfig = config.queries.find((candidate) => candidate.query === asset.query);
    const sourceIn = resolveSourceIn(
      queryConfig?.sourceIn,
      maximumStart,
      ((index * 37 + 17) % 100) / 100,
    );
    return {
      id: `shot-${String(index + 1).padStart(2, '0')}`,
      source: relative(projectRoot, asset.path),
      pexelsId: asset.video.id,
      query: asset.query,
      sourceIn: Number(sourceIn.toFixed(3)),
      sourceDuration: Number(sourceDuration.toFixed(3)),
      timelineIn,
      timelineOut,
      storyFunction:
        queryConfig?.storyFunction ??
        type.narrativePattern[
          Math.min(
            type.narrativePattern.length - 1,
            Math.floor((index * type.narrativePattern.length) / orderedAssets.length),
          )
        ] ??
        'supporting-detail',
      anchorX: queryConfig?.anchorX ?? 0.5,
      anchorY: queryConfig?.anchorY ?? 0.5,
      transitionToNext: transition,
    };
  });

  const storyboard: Storyboard = {
    schemaVersion: 1,
    projectId: config.id,
    createdAt: new Date().toISOString(),
    videoTypeId: config.type,
    sourceMode: config.sourceMode ?? 'stock-montage',
    aspect: config.aspect,
    width: dimensions.width,
    height: dimensions.height,
    fps: 30,
    durationSeconds: config.length,
    gradeId: config.gradeId,
    ...(config.title ? { title: config.title } : {}),
    ...(config.subtitle ? { subtitle: config.subtitle } : {}),
    music: {
      file: relative(projectRoot, musicFile),
      start: config.musicStart ?? 0,
      beatMap: relative(projectRoot, resolve(projectDirectory, 'beat-map.json')),
      ...(featuredAt !== undefined
        ? {
            featuredAt,
            featuredRole: config.musicHookRole ?? ('opening' as const),
          }
        : {}),
      ...(config.musicVolumeStart !== undefined ? { volumeStart: config.musicVolumeStart } : {}),
      ...(config.musicVolumeFullAt !== undefined ? { volumeFullAt: config.musicVolumeFullAt } : {}),
    },
    ...(config.voiceoverFile
      ? { voiceoverFile: relative(projectRoot, resolve(projectDirectory, config.voiceoverFile)) }
      : {}),
    shots,
    output:
      config.output ?? relative(projectRoot, resolve(projectRoot, 'output', `${config.id}.mp4`)),
  };
  await writeJson(resolve(projectDirectory, 'storyboard.json'), storyboard);
  return storyboard;
}
