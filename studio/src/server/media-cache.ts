import { access, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { run, sha256File } from '@ai-video-creation/scripts';
import { ProjectStore } from './project-store.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureShotThumbnail(
  store: ProjectStore,
  projectId: string,
  shotId: string,
): Promise<string> {
  const key = await store.shotThumbnailKey(projectId, shotId);
  const directory = resolve(store.studioCache, 'thumbnails', projectId);
  const output = resolve(directory, `${shotId}-${key.slice(0, 12)}.jpg`);
  await mkdir(directory, { recursive: true });
  if (await exists(output)) return output;
  const source = await store.sourcePath(projectId, shotId);
  const { storyboard } = await store.canonical(projectId);
  const shot = storyboard.shots.find((candidate) => candidate.id === shotId);
  if (!shot) throw new Error('Shot not found');
  try {
    await run('ffmpeg', [
      '-y',
      '-v',
      'error',
      '-ss',
      shot.sourceIn.toFixed(3),
      '-i',
      source,
      '-frames:v',
      '1',
      '-vf',
      'scale=480:-2',
      '-q:v',
      '3',
      output,
    ]);
  } catch (error) {
    throw new Error(`Could not create the shot thumbnail: ${String(error)}`);
  }
  return output;
}

export async function ensureMusicWaveform(store: ProjectStore, projectId: string): Promise<string> {
  const source = await store.musicPath(projectId);
  const hash = (await sha256File(source)).slice(0, 16);
  const directory = resolve(store.studioCache, 'waveforms');
  const output = resolve(directory, `${projectId}-${hash}.png`);
  await mkdir(directory, { recursive: true });
  if (await exists(output)) return output;
  await run('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-i',
    source,
    '-filter_complex',
    'aformat=channel_layouts=mono,showwavespic=s=2400x160:colors=0x8b5cf6',
    '-frames:v',
    '1',
    output,
  ]);
  return output;
}
