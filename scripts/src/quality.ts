import { mkdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { probeMedia, streamDuration } from './analyzer.js';
import { projectRoot, readJson, writeJson } from './config.js';
import { run } from './process.js';
import type { BeatMap, Storyboard } from './types.js';
import type { SourceMode } from './types.js';

export interface QualityReport {
  schemaVersion: 1;
  generatedAt: string;
  projectId: string;
  output: string;
  media: {
    duration: number;
    width: number;
    height: number;
    fps: string;
    hasAudio: boolean;
    sizeBytes: number;
    color: {
      range: string;
      space: string;
      transfer: string;
      primaries: string;
    };
  };
  edit: {
    sourceMode: SourceMode;
    shotCount: number;
    uniqueSources: number;
    repeatedSourceShots: number;
    sourceDiversity: number;
    averageShotSeconds: number;
    shortestShotSeconds: number;
    longestShotSeconds: number;
    hookShotSeconds: number;
    pacingVariation: number;
    stylizedTransitionCount: number;
    stylizedTransitionRatio: number;
  };
  musicStructure: {
    majorMoments: BeatMap['majorMoments'];
    emphasisTimes: number[];
    alignedEmphasisRatio: number;
    payoffTime: number | null;
    payoffNearestMajorMomentMs: number | null;
    energyContrast: number;
    featuredMomentTime: number | null;
    featuredMomentBasis: 'editorial' | 'analysis' | 'none';
    featuredMomentRole: 'opening' | 'payoff' | 'detected';
  } | null;
  audio: {
    integratedLufs: number | null;
    truePeakDbfs: number | null;
  };
  defects: {
    blackSegments: number;
    frozenSegments: number;
  };
  contactSheet: string;
  detailedContactSheet: string;
  transitionSheet: string;
  requiresEditorialReview: true;
  warnings: string[];
  verdict: 'technical-pass' | 'review';
}

export function nearestOffsetMs(time: number, events: number[]): number {
  if (events.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...events.map((event) => Math.abs(event - time))) * 1000;
}

export function featuredMomentTime(beatMap: BeatMap): number | null {
  const openingSection = beatMap.sections?.find(
    (section) => section.start <= 0.5 && section.end > 0,
  );
  if (openingSection?.label === 'peak') return 0;

  const candidates = (beatMap.majorMoments ?? []).filter((moment) => moment.kind !== 'release');
  const score = (moment: (typeof candidates)[number]): number => {
    const kindWeight = moment.kind === 'lift' ? 1 : moment.kind === 'impact' ? 0.8 : 0.4;
    return moment.strength + kindWeight;
  };
  const strongestScore = Math.max(...candidates.map(score), 0);
  const featured = candidates
    .filter((moment) => score(moment) >= strongestScore * 0.72)
    .sort((left, right) => left.time - right.time)[0];
  return featured?.time ?? null;
}

export function featuredMomentTimingWarning(
  time: number | null,
  role: 'opening' | 'payoff' | undefined,
): string | null {
  if (time === null) return null;
  if (role === 'payoff') {
    if (time < 4) return 'The musical payoff arrives before enough anticipation can develop.';
    if (time > 12) return 'The musical payoff arrives more than twelve seconds into the edit.';
    return null;
  }
  return time > 5 ? 'The opening musical hook arrives more than five seconds into the edit.' : null;
}

export function sourceRepetitionWarning(
  sourceMode: SourceMode,
  shotCount: number,
  uniqueSources: number,
): string | null {
  if (sourceMode !== 'stock-montage' || uniqueSources === shotCount) return null;
  return 'Stock montage repeats source footage; replace repeats or mark a different source mode.';
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function variationCoefficient(values: number[]): number {
  const center = average(values);
  if (center === 0) return 0;
  return Math.sqrt(average(values.map((value) => (value - center) ** 2))) / center;
}

function lastNumber(text: string, expression: RegExp): number | null {
  const matches = [...text.matchAll(expression)];
  const value = matches.at(-1)?.[1];
  return value === undefined ? null : Number(value);
}

async function measureAudio(output: string): Promise<QualityReport['audio']> {
  const { stderr } = await run('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i',
    output,
    '-map',
    '0:a:0',
    '-af',
    'ebur128=peak=true',
    '-f',
    'null',
    '-',
  ]);
  return {
    integratedLufs: lastNumber(stderr, /^\s*I:\s+(-?[0-9.]+) LUFS$/gm),
    truePeakDbfs: lastNumber(stderr, /^\s*Peak:\s+(-?[0-9.]+) dBFS$/gm),
  };
}

async function detectDefects(output: string): Promise<QualityReport['defects']> {
  const [{ stderr: black }, { stderr: frozen }] = await Promise.all([
    run('ffmpeg', [
      '-hide_banner',
      '-nostats',
      '-i',
      output,
      '-vf',
      'blackdetect=d=0.1:pix_th=0.05',
      '-an',
      '-f',
      'null',
      '-',
    ]),
    run('ffmpeg', [
      '-hide_banner',
      '-nostats',
      '-i',
      output,
      '-vf',
      'freezedetect=n=-50dB:d=1.0',
      '-an',
      '-f',
      'null',
      '-',
    ]),
  ]);
  return {
    blackSegments: [...black.matchAll(/black_duration:/g)].length,
    frozenSegments: [...frozen.matchAll(/freeze_duration:/g)].length,
  };
}

async function createContactSheet(
  output: string,
  destination: string,
  duration: number,
  detailed = false,
): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const columns = detailed ? 10 : 6;
  const rows = detailed ? 6 : 5;
  const sampleCount = columns * rows;
  const interval = Math.max(detailed ? 0.25 : 0.5, duration / sampleCount);
  const width = detailed ? 108 : 180;
  const height = detailed ? 192 : 320;
  await run('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-i',
    output,
    '-vf',
    `fps=1/${interval.toFixed(4)},scale=${width}:${height},` +
      `drawtext=text='%{pts\\:hms}':x=6:y=6:fontsize=${detailed ? 13 : 18}:` +
      `fontcolor=white:box=1:boxcolor=black@0.65,tile=${columns}x${rows}:padding=2:margin=2`,
    '-frames:v',
    '1',
    destination,
  ]);
}

async function createTransitionSheet(
  output: string,
  destination: string,
  storyboard: Storyboard,
): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const boundaries = storyboard.shots.slice(0, -1).map((shot) => shot.timelineOut);
  const sampleTimes = boundaries.flatMap((time) => [
    Math.max(0, time - 2 / storyboard.fps),
    time,
    Math.min(storyboard.durationSeconds, time + 2 / storyboard.fps),
  ]);
  const frameNumbers = [...new Set(sampleTimes.map((time) => Math.round(time * storyboard.fps)))];
  const selection = frameNumbers.map((frame) => `eq(n\\,${frame})`).join('+') || 'eq(n\\,0)';
  const columns = Math.min(6, Math.max(1, frameNumbers.length));
  const rows = Math.max(1, Math.ceil(frameNumbers.length / columns));
  await run('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-i',
    output,
    '-vf',
    `select=${selection},scale=180:320,tile=${columns}x${rows}:padding=2:margin=2`,
    '-frames:v',
    '1',
    destination,
  ]);
}

export async function evaluateStoryboard(storyboardPath: string): Promise<QualityReport> {
  const absoluteStoryboard = resolve(projectRoot, storyboardPath);
  const storyboard = await readJson<Storyboard>(absoluteStoryboard);
  const beatMap = storyboard.music
    ? await readJson<BeatMap>(resolve(projectRoot, storyboard.music.beatMap))
    : null;
  const output = resolve(projectRoot, storyboard.output);
  const probe = await probeMedia(output);
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const audioStream = probe.streams.find((stream) => stream.codec_type === 'audio');
  if (!video) throw new Error(`No video stream in ${output}`);

  const shotDurations = storyboard.shots.map((shot) => shot.timelineOut - shot.timelineIn);
  const stylizedTransitions = storyboard.shots.filter(
    (shot) => (shot.transitionToNext?.duration ?? 0) > 0.05,
  ).length;
  const majorMoments = beatMap?.majorMoments ?? [];
  const majorMomentTimes = [
    ...majorMoments.map((moment) => moment.time),
    ...(storyboard.music?.featuredAt !== undefined ? [storyboard.music.featuredAt] : []),
  ];
  const payoffShot = storyboard.shots.find((shot) =>
    /payoff|hero-reveal|arrival|landmark|takeaway|result/.test(shot.storyFunction),
  );
  const emphasisTimes = storyboard.shots
    .filter((shot) => (shot.transitionToNext?.duration ?? 0) > 0.05)
    .map((shot) => shot.timelineOut);
  if (payoffShot && payoffShot.timelineIn > 0) emphasisTimes.push(payoffShot.timelineIn);
  const uniqueEmphasisTimes = [...new Set(emphasisTimes)].sort((left, right) => left - right);
  const alignedEmphasisRatio =
    uniqueEmphasisTimes.filter((time) => nearestOffsetMs(time, majorMomentTimes) <= 500).length /
    Math.max(uniqueEmphasisTimes.length, 1);
  const energyValues = beatMap?.energy.map((point) => point.value) ?? [];
  const energyCenter = average(energyValues);
  const energyContrast =
    energyValues.length === 0 || energyCenter === 0
      ? 0
      : (Math.max(...energyValues) - Math.min(...energyValues)) / energyCenter;
  const projectDirectory = dirname(absoluteStoryboard);
  const contactSheet = resolve(projectDirectory, 'quality', 'contact-sheet.jpg');
  const detailedContactSheet = resolve(projectDirectory, 'quality', 'detailed-contact-sheet.jpg');
  const transitionSheet = resolve(projectDirectory, 'quality', 'transition-sheet.jpg');
  const [audio, defects] = await Promise.all([
    measureAudio(output),
    detectDefects(output),
    createContactSheet(output, contactSheet, storyboard.durationSeconds),
    createContactSheet(output, detailedContactSheet, storyboard.durationSeconds, true),
    createTransitionSheet(output, transitionSheet, storyboard),
  ]).then(([audioResult, defectResult]) => [audioResult, defectResult] as const);

  const uniqueSources = new Set(storyboard.shots.map((shot) => shot.source)).size;
  const sourceMode =
    storyboard.sourceMode ??
    (storyboard.audioPlan?.useSourceAudio ? 'continuous-footage' : 'stock-montage');
  const warnings: string[] = [];
  const musicLed =
    Boolean(storyboard.music) && storyboard.videoTypeId !== 'talking-head-broll-short';
  const analyzedFeaturedMusicTime = beatMap ? featuredMomentTime(beatMap) : null;
  const featuredMusicTime = storyboard.music?.featuredAt ?? analyzedFeaturedMusicTime;
  const featuredMomentBasis =
    storyboard.music?.featuredAt !== undefined
      ? 'editorial'
      : analyzedFeaturedMusicTime !== null
        ? 'analysis'
        : 'none';
  const featuredMomentRole = storyboard.music?.featuredRole ?? 'detected';
  const pacingVariation = variationCoefficient(shotDurations);
  const renderedDuration = streamDuration(video, probe.format.duration);
  if (Math.abs(renderedDuration - storyboard.durationSeconds) > 0.2) {
    warnings.push('Rendered duration differs from the storyboard by more than 200 ms.');
  }
  if (video.width !== storyboard.width || video.height !== storyboard.height) {
    warnings.push('Rendered dimensions do not match the storyboard delivery profile.');
  }
  if (video.avg_frame_rate !== `${storyboard.fps}/1`) {
    warnings.push('Rendered frame rate does not match the storyboard.');
  }
  if (!audioStream) warnings.push('Rendered output has no audio stream.');
  if (
    audioStream?.duration &&
    Math.abs(streamDuration(audioStream, probe.format.duration) - storyboard.durationSeconds) > 0.2
  ) {
    warnings.push(
      'Rendered audio-stream duration differs from the storyboard by more than 200 ms.',
    );
  }
  if (
    video.color_space !== 'bt709' ||
    video.color_transfer !== 'bt709' ||
    video.color_primaries !== 'bt709'
  ) {
    warnings.push('Rendered SDR color metadata is not fully tagged as BT.709.');
  }
  if (musicLed && majorMoments.length === 0) {
    warnings.push('The selected music excerpt has no clearly detected large musical change.');
  }
  const featuredTimingWarning = featuredMomentTimingWarning(
    featuredMusicTime,
    storyboard.music?.featuredRole,
  );
  if (musicLed && featuredTimingWarning) warnings.push(featuredTimingWarning);
  if (musicLed && uniqueEmphasisTimes.length > 0 && alignedEmphasisRatio < 0.5) {
    warnings.push('Most payoff or transition accents do not coincide with a major musical change.');
  }
  if (storyboard.videoTypeId === 'fast-paced-reel' && (shotDurations[0] ?? 0) > 1.6) {
    warnings.push('The opening shot lasts longer than 1.6 seconds; review hook strength.');
  }
  if (storyboard.videoTypeId === 'talking-head-broll-short' && pacingVariation < 0.08) {
    warnings.push(
      'Talking-head shot lengths are nearly uniform instead of following speech emphasis.',
    );
  }
  if (storyboard.videoTypeId === 'talking-head-broll-short' && (shotDurations[0] ?? 0) > 3) {
    warnings.push('The spoken opening exceeds three seconds before a visual pattern change.');
  }
  if (storyboard.voiceoverFile && !storyboard.captionsFile) {
    warnings.push('Voiceover is present without a caption or transcript timing file.');
  }
  if (musicLed && pacingVariation < 0.16) {
    warnings.push('Shot durations are nearly uniform, which can make the edit feel mechanical.');
  }
  if (stylizedTransitions / Math.max(storyboard.shots.length - 1, 1) > 0.4) {
    warnings.push('Stylized transitions cover more than 40% of cuts; review effect motivation.');
  }
  if (musicLed && energyContrast < 0.35) {
    warnings.push('The selected music excerpt has limited energy contrast for a music-led edit.');
  }
  if (audio.integratedLufs !== null && (audio.integratedLufs < -18 || audio.integratedLufs > -10)) {
    warnings.push(`Integrated loudness is ${audio.integratedLufs.toFixed(1)} LUFS.`);
  }
  if (audio.truePeakDbfs !== null && audio.truePeakDbfs > -1) {
    warnings.push(
      `True peak is ${audio.truePeakDbfs.toFixed(1)} dBFS; target is at most -1.0 dBFS.`,
    );
  }
  if (defects.blackSegments > 0) warnings.push('Black-frame segments were detected.');
  if (defects.frozenSegments > 0)
    warnings.push('Unexpected frozen segments longer than one second were detected.');
  const repetitionWarning = sourceRepetitionWarning(
    sourceMode,
    storyboard.shots.length,
    uniqueSources,
  );
  if (repetitionWarning) warnings.push(repetitionWarning);

  const report: QualityReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectId: storyboard.projectId,
    output: storyboard.output,
    media: {
      duration: renderedDuration,
      width: video.width ?? 0,
      height: video.height ?? 0,
      fps: video.avg_frame_rate ?? 'unknown',
      hasAudio: Boolean(audioStream),
      sizeBytes: Number(probe.format.size ?? 0),
      color: {
        range: video.color_range ?? 'unknown',
        space: video.color_space ?? 'unknown',
        transfer: video.color_transfer ?? 'unknown',
        primaries: video.color_primaries ?? 'unknown',
      },
    },
    edit: {
      sourceMode,
      shotCount: storyboard.shots.length,
      uniqueSources,
      repeatedSourceShots: storyboard.shots.length - uniqueSources,
      sourceDiversity: Number((uniqueSources / storyboard.shots.length).toFixed(4)),
      averageShotSeconds: Number(average(shotDurations).toFixed(4)),
      shortestShotSeconds: Number(Math.min(...shotDurations).toFixed(4)),
      longestShotSeconds: Number(Math.max(...shotDurations).toFixed(4)),
      hookShotSeconds: Number((shotDurations[0] ?? 0).toFixed(4)),
      pacingVariation: Number(pacingVariation.toFixed(4)),
      stylizedTransitionCount: stylizedTransitions,
      stylizedTransitionRatio: Number(
        (stylizedTransitions / Math.max(storyboard.shots.length - 1, 1)).toFixed(4),
      ),
    },
    musicStructure: storyboard.music
      ? {
          majorMoments,
          emphasisTimes: uniqueEmphasisTimes,
          alignedEmphasisRatio: Number(alignedEmphasisRatio.toFixed(4)),
          payoffTime: payoffShot?.timelineIn ?? null,
          payoffNearestMajorMomentMs:
            payoffShot && majorMomentTimes.length > 0
              ? Number(nearestOffsetMs(payoffShot.timelineIn, majorMomentTimes).toFixed(1))
              : null,
          energyContrast: Number(energyContrast.toFixed(4)),
          featuredMomentTime: featuredMusicTime,
          featuredMomentBasis,
          featuredMomentRole,
        }
      : null,
    audio,
    defects,
    contactSheet: relative(projectRoot, contactSheet),
    detailedContactSheet: relative(projectRoot, detailedContactSheet),
    transitionSheet: relative(projectRoot, transitionSheet),
    requiresEditorialReview: true,
    warnings,
    verdict: warnings.length === 0 ? 'technical-pass' : 'review',
  };
  await writeJson(resolve(projectDirectory, 'quality', 'report.json'), report);
  return report;
}
