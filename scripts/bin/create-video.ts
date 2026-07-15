#!/usr/bin/env node
import { access, mkdir } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { analyzeClip } from '../src/analyzer.js';
import { analyzeBeats, recommendMusicStart } from '../src/beat-detector.js';
import { projectRoot, readJson, slugify, writeJson } from '../src/config.js';
import { downloadPopularTrack } from '../src/music.js';
import { acquirePexelsSources } from '../src/pexels.js';
import { requireBinary } from '../src/process.js';
import { evaluateStoryboard } from '../src/quality.js';
import { renderStoryboard } from '../src/renderer.js';
import { createStoryboard } from '../src/storyboard.js';
import type { AspectRatio, ProjectConfig, SourceQuery, Storyboard } from '../src/types.js';

const HELP = `AI video creation pipeline

Usage:
  npm run create -- [options]
  npm run analyze -- --input <video>
  npm run beats -- --input <audio> [--start 0] [--length 30]
  npm run evaluate -- --storyboard <file>

Create options:
  --project <directory>    Read <directory>/project.json
  --storyboard <file>      Render an existing storyboard without acquiring media
  --request <text>         Infer a primary video type from a natural-language request
  --type <id>              cinematic-travel-reel, motovlog-reel, talking-head-broll-short, food-reel
  --length <seconds>       Target duration (default: 30)
  --aspect <9:16|16:9>     Delivery aspect ratio (default: 9:16)
  --music <query>          Popular music search query for yt-dlp
  --music-file <path>      Existing local audio file
  --music-start <seconds>  Start position in the track (default: select a strong section)
  --queries <a,b,c>        Override Pexels search queries
  --title <text>           Opening title
  --subtitle <text>        Opening subtitle
  --output <path>          Output MP4 path
  --storyboard-only        Acquire/analyze and write the storyboard without rendering
  --help                   Show this help

Examples:
  npm run create -- --type cinematic-travel-reel --length 30 --aspect 9:16 --music "M83 Midnight City"
  npm run create -- --project projects/01-cinematic-travel-reel
  npm run create -- --storyboard projects/01-cinematic-travel-reel/storyboard.json
`;

type Flags = Record<string, string | boolean>;

function parseFlags(args: string[]): Flags {
  const flags: Flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token?.startsWith('--')) continue;
    const key = token.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      index += 1;
    }
  }
  return flags;
}

function stringFlag(flags: Flags, key: string): string | undefined {
  const value = flags[key];
  return typeof value === 'string' ? value : undefined;
}

function numberFlag(flags: Flags, key: string, fallback: number): number {
  const value = Number(stringFlag(flags, key) ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`--${key} must be a number`);
  return value;
}

function inferType(request: string): string {
  const normalized = request.toLowerCase();
  if (normalized.includes('moto') || normalized.includes('motorcycle')) return 'motovlog-reel';
  if (normalized.includes('talk') || normalized.includes('b-roll'))
    return 'talking-head-broll-short';
  if (normalized.includes('food') || normalized.includes('restaurant')) return 'food-reel';
  return 'cinematic-travel-reel';
}

function defaultsForType(type: string): {
  queries: SourceQuery[];
  gradeId: string;
  musicQuery: string;
} {
  if (type === 'motovlog-reel') {
    return {
      queries: [
        { query: 'motorcycle riding road', count: 2 },
        { query: 'motorcycle rider helmet', count: 2 },
        { query: 'winding road driving', count: 2 },
        { query: 'city traffic night', count: 2 },
      ],
      gradeId: 'natural-action',
      musicQuery: 'Chris Rea Looking for the Summer official audio',
    };
  }
  if (type === 'talking-head-broll-short') {
    return {
      queries: [
        { query: 'person talking to camera', count: 2 },
        { query: 'walking through city', count: 2 },
        { query: 'coffee shop details', count: 2 },
        { query: 'city architecture close up', count: 2 },
      ],
      gradeId: 'clean-talking-head',
      musicQuery: 'The xx Intro official audio',
    };
  }
  if (type === 'food-reel') {
    return {
      queries: [
        { query: 'chef cooking restaurant', count: 2 },
        { query: 'street food close up', count: 2 },
        { query: 'food plating', count: 2 },
        { query: 'coffee pouring slow motion', count: 2 },
      ],
      gradeId: 'clean-food',
      musicQuery: 'Parcels Tieduprightnow official audio',
    };
  }
  return {
    queries: [
      { query: 'cinematic city street', count: 2 },
      { query: 'beach waves sunset', count: 2 },
      { query: 'travel architecture', count: 2 },
      { query: 'walking through city', count: 2 },
    ],
    gradeId: 'warm-travel',
    musicQuery: 'M83 Midnight City official audio',
  };
}

function inlineConfig(flags: Flags): ProjectConfig {
  const request = stringFlag(flags, 'request') ?? '';
  const type = stringFlag(flags, 'type') ?? inferType(request);
  const defaults = defaultsForType(type);
  const aspectValue = stringFlag(flags, 'aspect') ?? '9:16';
  if (aspectValue !== '9:16' && aspectValue !== '16:9') {
    throw new Error('--aspect must be 9:16 or 16:9');
  }
  const queryOverride = stringFlag(flags, 'queries');
  const queries = queryOverride
    ? queryOverride.split(',').map((query) => ({ query: query.trim(), count: 1 }))
    : defaults.queries;
  const id = slugify(stringFlag(flags, 'title') ?? `${type}-${aspectValue.replace(':', 'x')}`);
  return {
    id,
    type,
    length: numberFlag(flags, 'length', 30),
    aspect: aspectValue as AspectRatio,
    queries,
    gradeId: defaults.gradeId,
    ...(type !== 'talking-head-broll-short' ? { editStyle: 'social-arc' } : {}),
    ...(stringFlag(flags, 'music-file')
      ? { musicFile: stringFlag(flags, 'music-file')! }
      : { musicQuery: stringFlag(flags, 'music') ?? defaults.musicQuery }),
    ...(stringFlag(flags, 'music-start')
      ? { musicStart: numberFlag(flags, 'music-start', 0) }
      : {}),
    ...(stringFlag(flags, 'title') ? { title: stringFlag(flags, 'title')! } : {}),
    ...(stringFlag(flags, 'subtitle') ? { subtitle: stringFlag(flags, 'subtitle')! } : {}),
    ...(stringFlag(flags, 'output') ? { output: stringFlag(flags, 'output')! } : {}),
  };
}

async function resolveExistingFile(path: string, projectDirectory: string): Promise<string> {
  const candidates = isAbsolute(path)
    ? [path]
    : [resolve(projectDirectory, path), resolve(projectRoot, path)];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next project-relative or root-relative candidate.
    }
  }
  throw new Error(`File does not exist: ${path}`);
}

async function createCommand(flags: Flags): Promise<void> {
  await Promise.all(['ffmpeg', 'ffprobe', 'yt-dlp'].map(requireBinary));
  const storyboardPath = stringFlag(flags, 'storyboard');
  if (storyboardPath) {
    const storyboard = await readJson<Storyboard>(resolve(projectRoot, storyboardPath));
    const output = await renderStoryboard(storyboard);
    console.log(JSON.stringify({ output }, null, 2));
    return;
  }

  const projectFlag = stringFlag(flags, 'project');
  const projectDirectory = projectFlag
    ? resolve(projectRoot, projectFlag)
    : resolve(projectRoot, 'projects', inlineConfig(flags).id);
  await mkdir(projectDirectory, { recursive: true });
  const config = projectFlag
    ? await readJson<ProjectConfig>(resolve(projectDirectory, 'project.json'))
    : inlineConfig(flags);
  if (!projectFlag) await writeJson(resolve(projectDirectory, 'project.json'), config);

  const musicFile = config.musicFile
    ? await resolveExistingFile(config.musicFile, projectDirectory)
    : await downloadPopularTrack(
        config.musicQuery ?? defaultsForType(config.type).musicQuery,
        projectDirectory,
      );
  const assets = await acquirePexelsSources(config.queries, config.aspect, projectDirectory);
  const musicStart = config.musicStart ?? (await recommendMusicStart(musicFile, config.length));
  const resolvedConfig = { ...config, musicStart };
  if (config.musicStart === undefined)
    await writeJson(resolve(projectDirectory, 'project.json'), resolvedConfig);
  const beatMap = await analyzeBeats(musicFile, musicStart, musicStart + config.length);
  await writeJson(resolve(projectDirectory, 'beat-map.json'), beatMap);
  const storyboard = await createStoryboard(
    resolvedConfig,
    assets,
    musicFile,
    beatMap,
    projectDirectory,
  );
  if (flags['storyboard-only']) {
    console.log(
      JSON.stringify({ storyboard: resolve(projectDirectory, 'storyboard.json') }, null, 2),
    );
    return;
  }
  const output = await renderStoryboard(storyboard);
  console.log(
    JSON.stringify({ output, storyboard: resolve(projectDirectory, 'storyboard.json') }, null, 2),
  );
}

async function analyzeCommand(flags: Flags): Promise<void> {
  await Promise.all(['ffmpeg', 'ffprobe'].map(requireBinary));
  const input = stringFlag(flags, 'input');
  if (!input) throw new Error('analyze requires --input <video>');
  console.log(
    JSON.stringify(await analyzeClip(resolve(projectRoot, input), Boolean(flags.scenes)), null, 2),
  );
}

async function beatsCommand(flags: Flags): Promise<void> {
  await Promise.all(['ffmpeg', 'ffprobe'].map(requireBinary));
  const input = stringFlag(flags, 'input');
  if (!input) throw new Error('beats requires --input <audio>');
  const start = numberFlag(flags, 'start', 0);
  const length = numberFlag(flags, 'length', 30);
  console.log(
    JSON.stringify(await analyzeBeats(resolve(projectRoot, input), start, start + length), null, 2),
  );
}

async function evaluateCommand(flags: Flags): Promise<void> {
  await Promise.all(['ffmpeg', 'ffprobe'].map(requireBinary));
  const storyboard = stringFlag(flags, 'storyboard');
  if (!storyboard) throw new Error('evaluate requires --storyboard <file>');
  console.log(JSON.stringify(await evaluateStoryboard(storyboard), null, 2));
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'create';
  const flags = parseFlags(process.argv.slice(3));
  if (flags.help || command === 'help') {
    console.log(HELP);
    return;
  }
  if (command === 'create') await createCommand(flags);
  else if (command === 'analyze') await analyzeCommand(flags);
  else if (command === 'beats') await beatsCommand(flags);
  else if (command === 'evaluate') await evaluateCommand(flags);
  else throw new Error(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
