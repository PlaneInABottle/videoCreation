import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { probeMedia } from './analyzer.js';
import { cacheRoot, readJson, sha256File, writeJson } from './config.js';
import type { BeatMap, MusicMoment, MusicSection } from './types.js';

const SAMPLE_RATE = 11_025;
const FRAME_SIZE = 512;
const HOP_SIZE = 256;

async function decodeMono(path: string, start: number, duration: number): Promise<Float32Array> {
  const buffer = await new Promise<Buffer>((resolveDecode, reject) => {
    const child = spawn('ffmpeg', [
      '-v',
      'error',
      '-ss',
      start.toFixed(3),
      '-t',
      duration.toFixed(3),
      '-i',
      path,
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(SAMPLE_RATE),
      '-f',
      'f32le',
      'pipe:1',
    ]);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let outputTooLarge = false;
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 256 * 1024 * 1024) {
        outputTooLarge = true;
        child.kill();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (outputTooLarge) {
        reject(new Error('Audio decode exceeded the 256 MB analysis limit'));
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `Audio decode failed: ${Buffer.concat(stderr).toString('utf8') || 'unknown error'}`,
          ),
        );
        return;
      }
      resolveDecode(Buffer.concat(stdout));
    });
  });
  const samples = new Float32Array(Math.floor(buffer.length / 4));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = buffer.readFloatLE(index * 4);
  }
  return samples;
}

export function extractEnvelope(samples: Float32Array): { energy: number[]; novelty: number[] } {
  const frameCount = Math.max(0, Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1);
  const energy: number[] = [];
  const novelty: number[] = [];
  let previousRms = 0;
  let previousPeak = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * HOP_SIZE;
    let sumSquares = 0;
    let peak = 0;
    for (let index = start; index < start + FRAME_SIZE; index += 1) {
      const value = Math.abs(samples[index] ?? 0);
      sumSquares += value * value;
      peak = Math.max(peak, value);
    }
    const rms = Math.sqrt(sumSquares / FRAME_SIZE);
    energy.push(rms);
    novelty.push(Math.max(0, rms - previousRms) * 0.75 + Math.max(0, peak - previousPeak) * 0.25);
    previousRms = rms;
    previousPeak = peak;
  }
  return { energy, novelty };
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function standardDeviation(values: number[]): number {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function averageRange(values: number[], start: number, end: number): number {
  return mean(values.slice(Math.max(0, start), Math.min(values.length, end)));
}

function bucketEnvelope(values: number[], bucketFrames: number, usePeak = false): number[] {
  const result: number[] = [];
  for (let start = 0; start < values.length; start += bucketFrames) {
    const bucket = values.slice(start, start + bucketFrames);
    result.push(usePeak ? Math.max(...bucket, 0) : mean(bucket));
  }
  return result;
}

export function detectMajorMoments(energy: number[], novelty: number[]): MusicMoment[] {
  const frameSeconds = HOP_SIZE / SAMPLE_RATE;
  const bucketSeconds = 0.25;
  const bucketFrames = Math.max(1, Math.round(bucketSeconds / frameSeconds));
  const energyBuckets = bucketEnvelope(energy, bucketFrames);
  const noveltyBuckets = bucketEnvelope(novelty, bucketFrames, true);
  const smoothedEnergy = energyBuckets.map((_, index) =>
    averageRange(energyBuckets, index - 1, index + 2),
  );
  const energySpread = Math.max(standardDeviation(smoothedEnergy), 1e-6);
  const noveltyPeak = Math.max(...noveltyBuckets, 1e-6);
  const averageEnergy = mean(smoothedEnergy);
  const candidates: MusicMoment[] = [];

  for (let index = 3; index < smoothedEnergy.length - 3; index += 1) {
    const before = averageRange(smoothedEnergy, index - 3, index);
    const after = averageRange(smoothedEnergy, index, index + 3);
    const change = (after - before) / energySpread;
    const transient = (noveltyBuckets[index] ?? 0) / noveltyPeak;
    const current = smoothedEnergy[index] ?? 0;
    const localPeak =
      current >= (smoothedEnergy[index - 1] ?? 0) &&
      current > (smoothedEnergy[index + 1] ?? 0) &&
      (current - averageEnergy) / energySpread >= 0.8;

    let kind: MusicMoment['kind'] | null = null;
    let strength = 0;
    if (change >= 0.65) {
      kind = 'lift';
      strength = change + transient * 0.35;
    } else if (change <= -0.65) {
      kind = 'release';
      strength = Math.abs(change) + transient * 0.2;
    } else if (transient >= 0.55) {
      const longerRise =
        (current - averageRange(smoothedEnergy, index - 8, index - 4)) / energySpread;
      kind = longerRise >= 0.65 ? 'lift' : 'impact';
      strength = transient + Math.max(0, longerRise) * 0.35;
    } else if (localPeak) {
      kind = 'peak';
      strength = (current - averageEnergy) / energySpread;
    }

    if (kind) {
      candidates.push({
        time: Number((index * bucketSeconds).toFixed(3)),
        kind,
        strength: Number(strength.toFixed(3)),
      });
    }
  }

  const selected: MusicMoment[] = [];
  for (const candidate of candidates.sort((left, right) => right.strength - left.strength)) {
    if (selected.every((moment) => Math.abs(moment.time - candidate.time) >= 2.25)) {
      selected.push(candidate);
    }
    if (selected.length === 8) break;
  }
  return selected.sort((left, right) => left.time - right.time);
}

export function deriveMusicSections(energy: number[]): MusicSection[] {
  const frameSeconds = HOP_SIZE / SAMPLE_RATE;
  const sectionSeconds = 2;
  const sectionFrames = Math.max(1, Math.round(sectionSeconds / frameSeconds));
  const sectionEnergy = bucketEnvelope(energy, sectionFrames);
  const averageEnergy = mean(sectionEnergy);
  const spread = Math.max(standardDeviation(sectionEnergy), 1e-6);

  return sectionEnergy.map((value, index) => {
    const previous = sectionEnergy[index - 1] ?? value;
    const change = (value - previous) / spread;
    let label: MusicSection['label'] = 'steady';
    if (change >= 0.45) label = 'build';
    else if (change <= -0.45) label = 'release';
    else if (value >= averageEnergy + spread * 0.6) label = 'peak';
    else if (value <= averageEnergy - spread * 0.6) label = 'calm';
    return {
      start: Number((index * sectionSeconds).toFixed(3)),
      end: Number(((index + 1) * sectionSeconds).toFixed(3)),
      label,
      energy: Number(value.toFixed(6)),
    };
  });
}

export function estimateTempo(novelty: number[]): {
  bpm: number;
  confidence: number;
  period: number;
} {
  const secondsPerFrame = HOP_SIZE / SAMPLE_RATE;
  const candidates: Array<{ bpm: number; score: number; period: number }> = [];
  for (let bpm = 65; bpm <= 180; bpm += 1) {
    const period = Math.max(1, Math.round(60 / bpm / secondsPerFrame));
    let score = 0;
    let denominator = 0;
    for (let index = period; index < novelty.length; index += 1) {
      score += (novelty[index] ?? 0) * (novelty[index - period] ?? 0);
      denominator += 1;
    }
    candidates.push({ bpm, score: score / Math.max(denominator, 1), period });
  }
  candidates.sort((left, right) => right.score - left.score || left.bpm - right.bpm);
  const best = candidates[0] ?? { bpm: 120, score: 0, period: 22 };
  const baseline = mean(candidates.map((candidate) => candidate.score));
  const confidence = Math.max(0, Math.min(1, (best.score - baseline) / Math.max(best.score, 1e-9)));
  return { bpm: best.bpm, confidence, period: best.period };
}

export function detectOnsets(novelty: number[]): number[] {
  const average = mean(novelty);
  const threshold = average + standardDeviation(novelty) * 0.55;
  const minimumFrames = Math.round(0.18 / (HOP_SIZE / SAMPLE_RATE));
  const onsets: number[] = [];
  let previous = -minimumFrames;
  for (let index = 1; index < novelty.length - 1; index += 1) {
    const value = novelty[index] ?? 0;
    if (
      value >= threshold &&
      value >= (novelty[index - 1] ?? 0) &&
      value > (novelty[index + 1] ?? 0) &&
      index - previous >= minimumFrames
    ) {
      onsets.push(index * (HOP_SIZE / SAMPLE_RATE));
      previous = index;
    }
  }
  return onsets;
}

export function buildBeatGrid(novelty: number[], period: number, duration: number): number[] {
  let bestOffset = 0;
  let bestScore = -1;
  for (let offset = 0; offset < period; offset += 1) {
    let score = 0;
    for (let index = offset; index < novelty.length; index += period) {
      score += novelty[index] ?? 0;
    }
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }
  const frameSeconds = HOP_SIZE / SAMPLE_RATE;
  const beats: number[] = [];
  for (let frame = bestOffset; frame * frameSeconds < duration; frame += period) {
    beats.push(Number((frame * frameSeconds).toFixed(4)));
  }
  return beats;
}

export async function analyzeBeats(
  path: string,
  start = 0,
  requestedEnd?: number,
): Promise<BeatMap> {
  const probe = await probeMedia(path);
  const sourceDuration = Number(probe.format.duration ?? 0);
  if (sourceDuration <= 0) throw new Error(`Cannot determine audio duration for ${path}`);
  const end = Math.min(requestedEnd ?? sourceDuration, sourceDuration);
  if (end <= start) throw new Error(`Invalid music excerpt ${start}-${end}`);

  const sourceHash = await sha256File(path);
  const cachePath = resolve(
    cacheRoot,
    'beats',
    `${sourceHash}-${start.toFixed(3)}-${end.toFixed(3)}-v2.json`,
  );
  try {
    await access(cachePath);
    return await readJson<BeatMap>(cachePath);
  } catch {
    // Missing cache entries are computed below.
  }
  const duration = end - start;
  const samples = await decodeMono(path, start, duration);
  const { energy, novelty } = extractEnvelope(samples);
  const tempo = estimateTempo(novelty);
  const map: BeatMap = {
    schemaVersion: 1,
    source: path,
    sourceHash,
    excerpt: { start, end },
    analyzer: { name: 'music-structure-energy', version: 2, sampleRate: SAMPLE_RATE },
    bpm: tempo.bpm,
    confidence: Number(tempo.confidence.toFixed(4)),
    beats: buildBeatGrid(novelty, tempo.period, duration),
    onsets: detectOnsets(novelty).map((value) => Number(value.toFixed(4))),
    energy: energy
      .filter((_, index) => index % 11 === 0)
      .map((value, index) => ({
        time: Number((index * 11 * (HOP_SIZE / SAMPLE_RATE)).toFixed(4)),
        value: Number(value.toFixed(6)),
      })),
    majorMoments: detectMajorMoments(energy, novelty),
    sections: deriveMusicSections(energy).map((section) => ({
      ...section,
      end: Math.min(section.end, duration),
    })),
    fallback: tempo.confidence < 0.08,
  };
  await writeJson(cachePath, map);
  return map;
}

export function selectFeaturedMoment(
  moments: MusicMoment[],
  sourceDuration: number,
  excerptDuration: number,
): MusicMoment | undefined {
  const candidates = moments.filter(
    (moment) =>
      moment.kind !== 'release' &&
      moment.time >= Math.max(12, excerptDuration * 0.6) &&
      moment.time <= sourceDuration - excerptDuration,
  );
  const score = (moment: MusicMoment): number => {
    const kindWeight = moment.kind === 'lift' ? 1 : moment.kind === 'impact' ? 0.8 : 0.4;
    return moment.strength + kindWeight;
  };
  const strongestScore = Math.max(...candidates.map(score), 0);
  return candidates
    .filter((moment) => score(moment) >= strongestScore * 0.72)
    .sort((left, right) => left.time - right.time)[0];
}

export function chooseExcerptStart(
  beatMap: Pick<BeatMap, 'bpm' | 'majorMoments'>,
  sourceDuration: number,
  excerptDuration: number,
): number {
  const moments = beatMap.majorMoments ?? [];
  const openingLimit = Math.min(12, excerptDuration * 0.6);
  const designedOpening = moments.some(
    (moment) => moment.kind !== 'release' && moment.time <= openingLimit && moment.strength >= 1.5,
  );
  if (designedOpening) return 0;

  const anchor = selectFeaturedMoment(moments, sourceDuration, excerptDuration);
  if (!anchor) return 0;
  const barSeconds = 240 / Math.max(beatMap.bpm, 1);
  const leadBars = Math.max(1, Math.floor(5 / barSeconds));
  return Number(
    Math.max(
      0,
      Math.min(sourceDuration - excerptDuration, anchor.time - leadBars * barSeconds),
    ).toFixed(3),
  );
}

export async function recommendMusicStart(path: string, duration: number): Promise<number> {
  const probe = await probeMedia(path);
  const sourceDuration = Number(probe.format.duration ?? 0);
  if (sourceDuration <= duration) return 0;
  const fullMap = await analyzeBeats(path, 0, sourceDuration);
  return chooseExcerptStart(fullMap, sourceDuration, duration);
}
