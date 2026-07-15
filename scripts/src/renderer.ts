import { createHash } from 'node:crypto';
import { access, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyRenderedMedia } from './analyzer.js';
import { cacheRoot, projectRoot, readJson, writeJson } from './config.js';
import { run } from './process.js';
import type { Storyboard, StoryboardShot } from './types.js';

interface GradeKnowledge {
  grades: Array<{ id: string; ffmpegStartingPoint: string }>;
}

function contentHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function escapeDrawtext(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll(':', '\\:')
    .replaceAll('%', '\\%');
}

export function musicFadeInSeconds(musicStart: number): number {
  return musicStart <= 0.01 ? 0 : 0.08;
}

export function musicVolumeEnvelope(
  volumeStart: number | undefined,
  volumeFullAt: number | undefined,
): string {
  if (volumeStart === undefined || volumeFullAt === undefined || volumeFullAt <= 0) return '';
  const start = Math.max(0, Math.min(1, volumeStart));
  if (start >= 1) return '';
  return `volume='${start.toFixed(3)}+${(1 - start).toFixed(3)}*min(t/${volumeFullAt.toFixed(3)}\\,1)':eval=frame,`;
}

function titleFilter(storyboard: Storyboard): string | null {
  if (!storyboard.title) return null;
  const size = storyboard.aspect === '9:16' ? 72 : 64;
  const subtitleSize = Math.round(size * 0.42);
  const title = escapeDrawtext(storyboard.title.toUpperCase());
  const filters = [
    `drawtext=text='${title}':fontcolor=white:fontsize=${size}:font='DejaVu Sans':x=(w-text_w)/2:y=h*0.72:shadowcolor=black@0.8:shadowx=3:shadowy=3:enable='between(t,0.35,2.8)'`,
  ];
  if (storyboard.subtitle) {
    const subtitle = escapeDrawtext(storyboard.subtitle);
    filters.push(
      `drawtext=text='${subtitle}':fontcolor=white@0.92:fontsize=${subtitleSize}:font='DejaVu Sans':x=(w-text_w)/2:y=h*0.72+${size + 18}:shadowcolor=black@0.8:shadowx=2:shadowy=2:enable='between(t,0.55,2.8)'`,
    );
  }
  return filters.join(',');
}

function cropFilter(storyboard: Storyboard, shot: StoryboardShot): string {
  const x = Math.max(0, Math.min(1, shot.anchorX));
  const y = Math.max(0, Math.min(1, shot.anchorY));
  return [
    `scale=${storyboard.width}:${storyboard.height}:force_original_aspect_ratio=increase`,
    `crop=${storyboard.width}:${storyboard.height}:(iw-ow)*${x.toFixed(3)}:(ih-oh)*${y.toFixed(3)}`,
    'setsar=1',
    `fps=${storyboard.fps}`,
    'format=yuv420p',
    'settb=AVTB',
    'setpts=PTS-STARTPTS',
  ].join(',');
}

export function visualTransitionFilter(
  current: string,
  next: string,
  result: string,
  transition: NonNullable<StoryboardShot['transitionToNext']>,
  offset: number,
): string {
  if (transition.type === 'cut' || transition.duration === 0) {
    return `[${current}][${next}]concat=n=2:v=1:a=0[${result}]`;
  }
  return `[${current}][${next}]xfade=transition=${transition.type}:duration=${transition.duration.toFixed(4)}:offset=${offset.toFixed(4)}[${result}]`;
}

export function nextVisualDuration(
  currentDuration: number,
  nextDuration: number,
  transition: NonNullable<StoryboardShot['transitionToNext']>,
): number {
  return currentDuration + nextDuration - transition.duration;
}

export function sourceAudioSegmentFilter(
  inputIndex: number,
  duration: number,
  label: string,
): string {
  const edgeFade = Math.min(0.012, duration / 4);
  const fadeOutStart = Math.max(0, duration - edgeFade);
  return (
    `[${inputIndex}:a]atrim=duration=${duration.toFixed(4)},asetpts=PTS-STARTPTS,` +
    `aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,` +
    `afade=t=in:st=0:d=${edgeFade.toFixed(4)},` +
    `afade=t=out:st=${fadeOutStart.toFixed(4)}:d=${edgeFade.toFixed(4)}[${label}]`
  );
}

async function renderSegment(
  storyboard: Storyboard,
  shot: StoryboardShot,
  index: number,
  grade: string,
  directory: string,
): Promise<string> {
  const cacheKey = contentHash({
    shot,
    width: storyboard.width,
    height: storyboard.height,
    fps: storyboard.fps,
    grade,
    title: index === 0 ? storyboard.title : null,
    subtitle: index === 0 ? storyboard.subtitle : null,
  });
  const output = resolve(
    directory,
    `${String(index + 1).padStart(2, '0')}-${shot.id}-${cacheKey}.mp4`,
  );
  if (await exists(output)) return output;
  const filters = [cropFilter(storyboard, shot), grade];
  if (index === 0) {
    const text = titleFilter(storyboard);
    if (text) filters.push(text);
  }
  await run(
    'ffmpeg',
    [
      '-y',
      '-v',
      'error',
      '-ss',
      shot.sourceIn.toFixed(3),
      '-t',
      shot.sourceDuration.toFixed(3),
      '-i',
      resolve(projectRoot, shot.source),
      '-an',
      '-vf',
      filters.join(','),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '19',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      output,
    ],
    { inheritStderr: true },
  );
  return output;
}

async function composeVisual(
  storyboard: Storyboard,
  segments: string[],
  output: string,
): Promise<void> {
  if (await exists(output)) return;
  const args = ['-y', '-v', 'error'];
  for (const segment of segments) args.push('-i', segment);

  const graph: string[] = segments.map((_, index) => {
    const intendedDuration = storyboard.shots[index]?.sourceDuration ?? 0;
    return (
      `[${index}:v]fps=${storyboard.fps},format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS,` +
      `tpad=stop_mode=clone:stop_duration=0.12,trim=duration=${intendedDuration.toFixed(4)}[v${index}]`
    );
  });
  let current = 'v0';
  let currentDuration = storyboard.shots[0]?.sourceDuration ?? 0;
  for (let index = 0; index < storyboard.shots.length - 1; index += 1) {
    const transition = storyboard.shots[index]?.transitionToNext;
    if (!transition) throw new Error(`Shot ${index} is missing a transition`);
    const next = `v${index + 1}`;
    const result = `x${index + 1}`;
    const offset = currentDuration - transition.duration;
    graph.push(visualTransitionFilter(current, next, result, transition, offset));
    current = result;
    currentDuration = nextVisualDuration(
      currentDuration,
      storyboard.shots[index + 1]?.sourceDuration ?? 0,
      transition,
    );
  }
  graph.push(
    `[${current}]tpad=stop_mode=clone:stop_duration=0.2,trim=duration=${storyboard.durationSeconds.toFixed(3)},setpts=PTS-STARTPTS[visual]`,
  );
  args.push(
    '-filter_complex',
    graph.join(';'),
    '-map',
    '[visual]',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '19',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    output,
  );
  await run('ffmpeg', args, { inheritStderr: true });
}

async function addAudio(storyboard: Storyboard, visual: string, output: string): Promise<string[]> {
  const useSourceAudio = storyboard.audioPlan?.useSourceAudio === true;
  if (!storyboard.music && !useSourceAudio) {
    throw new Error('Storyboard must provide music or enable source audio');
  }
  if (storyboard.voiceoverFile && useSourceAudio) {
    throw new Error('Source audio and voiceover mixing require an explicit dialogue edit plan');
  }

  const args = ['-y', '-v', 'error', '-i', visual];
  const musicInputIndex = storyboard.music ? 1 : null;
  if (storyboard.music) {
    args.push(
      '-stream_loop',
      '-1',
      '-ss',
      storyboard.music.start.toFixed(3),
      '-i',
      resolve(projectRoot, storyboard.music.file),
    );
  }
  const duration = storyboard.durationSeconds;
  const fadeInDuration = musicFadeInSeconds(storyboard.music?.start ?? 0);
  const fadeIn = fadeInDuration > 0 ? `afade=t=in:st=0:d=${fadeInDuration.toFixed(2)},` : '';
  const fadeOutDuration = Math.min(0.65, duration);
  const fadeOutStart = Math.max(0, duration - fadeOutDuration);
  const volumeEnvelope = musicVolumeEnvelope(
    storyboard.music?.volumeStart,
    storyboard.music?.volumeFullAt,
  );
  const graph: string[] = [];

  let audioGraph: string;
  if (storyboard.voiceoverFile) {
    if (musicInputIndex === null) throw new Error('Voiceover mixing currently requires music');
    args.push('-i', resolve(projectRoot, storyboard.voiceoverFile));
    audioGraph =
      `[${musicInputIndex}:a]atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=0.62,` +
      `${fadeIn}${volumeEnvelope}afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutDuration.toFixed(3)}[music];` +
      `[2:a]atrim=duration=${Math.max(0, duration - 0.4).toFixed(3)},asetpts=PTS-STARTPTS,` +
      `adelay=400|400,apad=whole_dur=${duration},asplit=2[voice_sc][voice_mix];` +
      `[music][voice_sc]sidechaincompress=threshold=0.025:ratio=8:attack=10:release=350[ducked];` +
      `[ducked][voice_mix]amix=inputs=2:duration=longest:normalize=0,` +
      `loudnorm=I=-15:TP=-1.5:LRA=11,alimiter=limit=0.70:level=false:latency=true,` +
      `atrim=duration=${duration}[aout]`;
  } else if (useSourceAudio) {
    const unsupportedTransition = storyboard.shots.find(
      (shot) =>
        shot.transitionToNext &&
        (shot.transitionToNext.type !== 'cut' || shot.transitionToNext.duration !== 0),
    );
    if (unsupportedTransition) {
      throw new Error('Native source audio currently requires a hard-cut-only visual timeline');
    }

    const firstSourceInput = musicInputIndex === null ? 1 : 2;
    const sourceLabels: string[] = [];
    for (const [index, shot] of storyboard.shots.entries()) {
      const shotDuration = shot.timelineOut - shot.timelineIn;
      const inputIndex = firstSourceInput + index;
      const label = `source_audio_${index}`;
      args.push(
        '-ss',
        shot.sourceIn.toFixed(3),
        '-t',
        shotDuration.toFixed(3),
        '-i',
        resolve(projectRoot, shot.source),
      );
      graph.push(sourceAudioSegmentFilter(inputIndex, shotDuration, label));
      sourceLabels.push(label);
    }
    graph.push(
      `${sourceLabels.map((label) => `[${label}]`).join('')}concat=n=${sourceLabels.length}:v=0:a=1,` +
        `volume=${(storyboard.audioPlan?.sourceVolume ?? 1).toFixed(3)}[native]`,
    );
    if (musicInputIndex !== null) {
      graph.push(
        `[${musicInputIndex}:a]atrim=duration=${duration},asetpts=PTS-STARTPTS,` +
          `volume=${(storyboard.audioPlan?.musicVolume ?? 0.35).toFixed(3)},${fadeIn}${volumeEnvelope}` +
          `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutDuration.toFixed(3)}[music]`,
      );
      graph.push(
        `[native][music]amix=inputs=2:duration=longest:normalize=0,` +
          `loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.84:level=false:latency=true,` +
          `atrim=duration=${duration}[aout]`,
      );
    } else {
      graph.push(
        `[native]loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.84:level=false:latency=true,` +
          `atrim=duration=${duration}[aout]`,
      );
    }
    audioGraph = graph.join(';');
  } else {
    if (musicInputIndex === null) throw new Error('Music input is missing');
    audioGraph =
      `[${musicInputIndex}:a]atrim=duration=${duration},asetpts=PTS-STARTPTS,` +
      `${fadeIn}${volumeEnvelope}afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutDuration.toFixed(3)},` +
      `loudnorm=I=-14:TP=-3.5:LRA=11,alimiter=limit=0.55:level=false:latency=true,` +
      `atrim=duration=${duration}[aout]`;
  }
  args.push(
    '-filter_complex',
    audioGraph,
    '-map',
    '0:v:0',
    '-map',
    '[aout]',
    '-c:v',
    'copy',
    '-bsf:v',
    'h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-color_range',
    'tv',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-colorspace',
    'bt709',
    '-t',
    duration.toFixed(3),
    '-movflags',
    '+faststart',
    output,
  );
  await run('ffmpeg', args, { inheritStderr: true });
  return args;
}

export async function renderStoryboard(storyboard: Storyboard): Promise<string> {
  const gradeKnowledge = await readJson<GradeKnowledge>(
    resolve(projectRoot, 'knowledge', 'color-grades.json'),
  );
  const grade = gradeKnowledge.grades.find((candidate) => candidate.id === storyboard.gradeId);
  if (!grade) throw new Error(`Unknown color grade: ${storyboard.gradeId}`);

  const renderDirectory = resolve(cacheRoot, 'renders', storyboard.projectId);
  await mkdir(renderDirectory, { recursive: true });
  const segments: string[] = [];
  for (const [index, shot] of storyboard.shots.entries()) {
    segments.push(
      await renderSegment(storyboard, shot, index, grade.ffmpegStartingPoint, renderDirectory),
    );
  }
  const visual = resolve(
    renderDirectory,
    `visual-${contentHash({ compositionVersion: 2, segments, shots: storyboard.shots, duration: storyboard.durationSeconds })}.mp4`,
  );
  await composeVisual(storyboard, segments, visual);

  const output = resolve(projectRoot, storyboard.output);
  await mkdir(resolve(output, '..'), { recursive: true });
  const audioArgs = await addAudio(storyboard, visual, output);
  const probe = await verifyRenderedMedia(output, {
    width: storyboard.width,
    height: storyboard.height,
    duration: storyboard.durationSeconds,
    requireAudio: true,
  });
  await writeJson(resolve(renderDirectory, 'render-manifest.json'), {
    storyboard,
    segments,
    visual,
    output,
    finalAudioCommand: { command: 'ffmpeg', args: audioArgs },
    probe,
  });
  return output;
}
