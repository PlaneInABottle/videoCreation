import { access, copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { projectRoot, slugify, writeJson } from './config.js';
import { run } from './process.js';

interface YtDlpEntry {
  id: string;
  title?: string;
  track?: string;
  artist?: string;
  uploader?: string;
  webpage_url?: string;
  original_url?: string;
  duration?: number;
}

interface YtDlpSearchResult {
  entries?: YtDlpEntry[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function downloadPopularTrack(
  query: string,
  projectDirectory: string,
): Promise<string> {
  const search = await run('yt-dlp', [
    '--no-playlist',
    '--playlist-items',
    '1',
    '--dump-single-json',
    `ytsearch1:${query}`,
  ]);
  const result = JSON.parse(search.stdout) as YtDlpSearchResult & YtDlpEntry;
  const entry = result.entries?.[0] ?? result;
  if (!entry.id) throw new Error(`yt-dlp found no result for "${query}"`);

  const musicDirectory = resolve(projectRoot, 'music');
  await mkdir(musicDirectory, { recursive: true });
  await mkdir(resolve(projectDirectory, 'sources'), { recursive: true });
  const base = `${slugify(query)}-${entry.id}`;
  const audioPath = resolve(musicDirectory, `${base}.mp3`);
  const sourceUrl = entry.webpage_url ?? `https://www.youtube.com/watch?v=${entry.id}`;

  if (!(await exists(audioPath))) {
    await run(
      'yt-dlp',
      [
        '--no-playlist',
        '--restrict-filenames',
        '-f',
        'bestaudio/best',
        '-x',
        '--audio-format',
        'mp3',
        '--audio-quality',
        '0',
        '-o',
        resolve(musicDirectory, `${base}.%(ext)s`),
        sourceUrl,
      ],
      { inheritStderr: true },
    );
  }

  const sidecar = {
    source: 'youtube',
    type: 'audio',
    id: entry.id,
    query,
    title: entry.track ?? entry.title ?? query,
    artist: entry.artist ?? entry.uploader ?? 'unknown',
    url: sourceUrl,
    duration: entry.duration ?? null,
    downloaded_at: new Date().toISOString(),
    usage: 'user-directed popular music input',
  };
  await writeJson(`${audioPath}.meta.json`, sidecar);
  await copyFile(
    `${audioPath}.meta.json`,
    resolve(projectDirectory, 'sources', `${base}.meta.json`),
  );
  return audioPath;
}
