import { access, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cacheRoot, readJson, sha256File, writeJson } from './config.js';
import { run } from './process.js';
import type { ProbeResult, ProbeStream } from './types.js';

export async function probeMedia(path: string): Promise<ProbeResult> {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_format',
    '-show_streams',
    '-of',
    'json',
    path,
  ]);
  return JSON.parse(stdout) as ProbeResult;
}

export function parseFrameRate(value: string | undefined): number {
  if (!value) return 0;
  const [numeratorText, denominatorText = '1'] = value.split('/');
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  return denominator === 0 ? 0 : numerator / denominator;
}

export function streamDuration(stream: ProbeStream, formatDuration?: string): number {
  return Number(stream.duration ?? formatDuration ?? 0);
}

export async function detectSceneChanges(path: string, threshold = 0.32): Promise<number[]> {
  const { stderr } = await run('ffmpeg', [
    '-hide_banner',
    '-i',
    path,
    '-vf',
    `select=gt(scene\\,${threshold}),showinfo`,
    '-an',
    '-f',
    'null',
    '-',
  ]);
  return [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((match) => Number(match[1]));
}

export function chooseSampleTimes(duration: number, sceneChanges: number[]): number[] {
  if (duration <= 0) return [];
  const interval = duration <= 60 ? 8 : duration <= 600 ? 20 : 45;
  const times = new Set<number>([Math.min(0.5, duration / 2), Math.max(0, duration - 0.5)]);
  for (let time = interval; time < duration; time += interval) times.add(time);
  for (const scene of sceneChanges) times.add(Math.min(duration - 0.05, scene + 0.15));
  const sorted = [...times]
    .filter((time) => time >= 0 && time < duration)
    .sort((left, right) => left - right);
  if (sorted.length <= 36) return sorted.map((time) => Number(time.toFixed(3)));
  const sampled = Array.from({ length: 36 }, (_, index) => {
    const sourceIndex = Math.round((index * (sorted.length - 1)) / 35);
    return sorted[sourceIndex] ?? 0;
  });
  return [...new Set(sampled)].map((time) => Number(time.toFixed(3)));
}

export function buildSegments(
  duration: number,
  sceneChanges: number[],
): Array<{
  start: number;
  end: number;
  labels: string[];
  classificationStatus: 'pending-ai-review';
}> {
  const boundaries = [
    0,
    ...sceneChanges.filter((time) => time >= 2 && duration - time >= 2),
    duration,
  ].sort((left, right) => left - right);
  const deduplicated = boundaries.filter(
    (value, index) => index === 0 || value - (boundaries[index - 1] ?? 0) >= 2,
  );
  if ((deduplicated.at(-1) ?? 0) !== duration) deduplicated.push(duration);
  return deduplicated.slice(0, -1).map((start, index) => ({
    start: Number(start.toFixed(3)),
    end: Number((deduplicated[index + 1] ?? duration).toFixed(3)),
    labels: [],
    classificationStatus: 'pending-ai-review',
  }));
}

async function extractSampleFrames(
  path: string,
  hash: string,
  times: number[],
): Promise<Array<{ time: number; path: string }>> {
  const directory = resolve(cacheRoot, 'analysis', hash, 'frames');
  await mkdir(directory, { recursive: true });
  const frames: Array<{ time: number; path: string }> = [];
  for (const [index, time] of times.entries()) {
    const destination = resolve(directory, `frame-${String(index + 1).padStart(3, '0')}.jpg`);
    try {
      await access(destination);
    } catch {
      await run('ffmpeg', [
        '-y',
        '-v',
        'error',
        '-ss',
        time.toFixed(3),
        '-i',
        path,
        '-frames:v',
        '1',
        '-vf',
        'scale=640:-2',
        '-q:v',
        '3',
        destination,
      ]);
    }
    frames.push({ time, path: destination });
  }
  return frames;
}

export async function analyzeClip(path: string, includeScenes = false): Promise<unknown> {
  const hash = await sha256File(path);
  const cachePath = resolve(
    cacheRoot,
    'analysis',
    `${hash}-${includeScenes ? 'detailed' : 'basic'}-v2.json`,
  );
  try {
    await access(cachePath);
    return await readJson<unknown>(cachePath);
  } catch {
    // Missing cache entries are computed below.
  }
  const probe = await probeMedia(path);
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  if (!video) throw new Error(`${path} has no video stream`);

  const duration = Number(probe.format.duration ?? video.duration ?? 0);
  const sceneChanges = includeScenes ? await detectSceneChanges(path) : [];
  const sampleFrames = includeScenes
    ? await extractSampleFrames(path, hash, chooseSampleTimes(duration, sceneChanges))
    : [];
  const segments = buildSegments(duration, sceneChanges).map((segment) => ({
    ...segment,
    sampleFrames: sampleFrames.filter(
      (frame) => frame.time >= segment.start && frame.time < segment.end,
    ),
  }));
  const analysis = {
    schemaVersion: 1,
    analyzerVersion: 2,
    source: path,
    hash,
    duration,
    video: {
      codec: video.codec_name ?? 'unknown',
      width: video.width ?? 0,
      height: video.height ?? 0,
      fps: parseFrameRate(video.avg_frame_rate),
    },
    audio: audio
      ? {
          codec: audio.codec_name ?? 'unknown',
          sampleRate: Number(audio.sample_rate ?? 0),
          channels: audio.channels ?? 0,
        }
      : null,
    sceneChanges,
    sampleFrames,
    segments,
  };
  await writeJson(cachePath, analysis);
  return analysis;
}

export async function verifyRenderedMedia(
  path: string,
  expected: { width: number; height: number; duration: number; requireAudio: boolean },
): Promise<ProbeResult> {
  const probe = await probeMedia(path);
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  if (!video) throw new Error(`Rendered file has no video stream: ${path}`);
  const videoDuration = streamDuration(video, probe.format.duration);
  if (video.width !== expected.width || video.height !== expected.height) {
    throw new Error(
      `Unexpected dimensions ${String(video.width)}x${String(video.height)} for ${path}`,
    );
  }
  if (Math.abs(videoDuration - expected.duration) > 0.2) {
    throw new Error(`Unexpected video duration ${videoDuration.toFixed(3)}s for ${path}`);
  }
  if (expected.requireAudio && !audio)
    throw new Error(`Rendered file has no audio stream: ${path}`);
  if (audio) {
    const audioDuration = streamDuration(audio, probe.format.duration);
    if (Math.abs(audioDuration - expected.duration) > 0.2) {
      throw new Error(`Unexpected audio duration ${audioDuration.toFixed(3)}s for ${path}`);
    }
  }
  await run('ffmpeg', ['-v', 'error', '-i', path, '-f', 'null', '-']);
  return probe;
}
