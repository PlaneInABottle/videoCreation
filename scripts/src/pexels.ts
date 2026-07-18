import { access, copyFile, mkdir, readdir, rename, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { cacheRoot, writeJson } from './config.js';
import type {
  AspectRatio,
  DownloadedVideo,
  PexelsSearchResponse,
  PexelsVideo,
  PexelsVideoFile,
  SourceQuery,
} from './types.js';

const API_BASE = 'https://api.pexels.com/v1/videos/search';
const VIDEO_API_BASE = 'https://api.pexels.com/v1/videos/videos';

export async function searchPexelsVideos(
  apiKey: string,
  query: string,
  orientation: 'portrait' | 'landscape',
  perPage = 15,
): Promise<PexelsVideo[]> {
  const params = new URLSearchParams({
    query,
    orientation,
    min_duration: '5',
    max_duration: '60',
    per_page: String(perPage),
  });
  const response = await fetch(`${API_BASE}?${params.toString()}`, {
    headers: { Authorization: apiKey },
  });
  if (!response.ok) {
    throw new Error(`Pexels search failed (${response.status}): ${await response.text()}`);
  }
  const result = (await response.json()) as PexelsSearchResponse;
  return result.videos;
}

export async function getPexelsVideo(apiKey: string, id: number): Promise<PexelsVideo> {
  const response = await fetch(`${VIDEO_API_BASE}/${id}`, {
    headers: { Authorization: apiKey },
  });
  if (!response.ok) {
    throw new Error(`Pexels video lookup failed (${response.status}): ${await response.text()}`);
  }
  return (await response.json()) as PexelsVideo;
}

export function chooseVideoFile(video: PexelsVideo, aspect: AspectRatio): PexelsVideoFile {
  const portrait = aspect === '9:16';
  const targetWidth = portrait ? 1080 : 1920;
  const targetHeight = portrait ? 1920 : 1080;
  const candidates = video.video_files.filter(
    (file) =>
      file.file_type === 'video/mp4' &&
      file.width !== null &&
      file.height !== null &&
      file.width > 0 &&
      file.height > 0,
  );
  if (candidates.length === 0) throw new Error(`Pexels video ${video.id} has no MP4 file`);

  return [...candidates].sort((left, right) => {
    const score = (file: PexelsVideoFile): number => {
      const width = file.width ?? 0;
      const height = file.height ?? 0;
      const orientationPenalty = height > width === portrait ? 0 : 1_000_000;
      const undersizePenalty =
        width < targetWidth || height < targetHeight
          ? Math.max(targetWidth - width, 0) + Math.max(targetHeight - height, 0) + 100_000
          : 0;
      return (
        orientationPenalty +
        undersizePenalty +
        Math.abs(width - targetWidth) +
        Math.abs(height - targetHeight)
      );
    };
    return score(left) - score(right) || left.id - right.id;
  })[0]!;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function downloadFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Media download failed (${response.status}) for ${url}`);
  }
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.part`;
  await pipeline(
    Readable.fromWeb(response.body as unknown as ReadableStream),
    createWriteStream(temporary),
  );
  await rename(temporary, destination);
}

async function removeStaleProjectSidecars(
  projectDirectory: string,
  selectedIds: Set<number>,
): Promise<void> {
  const directory = resolve(projectDirectory, 'sources');
  const entries = await readdir(directory);
  await Promise.all(
    entries
      .filter((entry) => /^pexels-\d+\.meta\.json$/.test(entry))
      .filter((entry) => {
        const id = Number(entry.match(/^pexels-(\d+)/)?.[1]);
        return !selectedIds.has(id);
      })
      .map((entry) => unlink(resolve(directory, entry))),
  );
}

export function requestedSourceCount(sourceQuery: SourceQuery): number {
  const pinnedCount = sourceQuery.videoIds?.length;
  if (
    pinnedCount !== undefined &&
    sourceQuery.count !== undefined &&
    pinnedCount !== sourceQuery.count
  ) {
    throw new Error(
      `Source query "${sourceQuery.query}" pins ${pinnedCount} videos but requests ${sourceQuery.count}`,
    );
  }
  return sourceQuery.count ?? pinnedCount ?? 1;
}

export async function downloadPexelsVideo(
  video: PexelsVideo,
  file: PexelsVideoFile,
  query: string,
): Promise<DownloadedVideo> {
  const width = file.width ?? video.width;
  const height = file.height ?? video.height;
  const path = resolve(cacheRoot, 'pexels', `pexels-${video.id}-${width}x${height}.mp4`);
  const sidecarPath = `${path}.meta.json`;

  if (!(await fileExists(path))) await downloadFile(file.link, path);
  if (!(await fileExists(sidecarPath))) {
    await writeJson(sidecarPath, {
      source: 'pexels',
      type: 'video',
      id: video.id,
      query,
      url: video.url,
      download_url: file.link,
      downloaded_quality: file.quality,
      width,
      height,
      duration: video.duration,
      user: video.user,
      video_files: video.video_files,
      video_pictures: video.video_pictures,
      license: 'Pexels License - Free for personal and commercial use',
      license_url: 'https://www.pexels.com/license/',
      license_checked_at: new Date().toISOString(),
      attribution: `Video by ${video.user.name} on Pexels`,
      downloaded_at: new Date().toISOString(),
      api_response: video,
    });
  }

  return { path, sidecarPath, video, file, query };
}

export async function acquirePexelsSources(
  queries: SourceQuery[],
  aspect: AspectRatio,
  projectDirectory: string,
): Promise<DownloadedVideo[]> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error('PEXELS_API_KEY is not set');

  const selected: DownloadedVideo[] = [];
  const usedIds = new Set<number>();
  const defaultOrientation = aspect === '9:16' ? 'portrait' : 'landscape';
  await mkdir(resolve(projectDirectory, 'sources'), { recursive: true });

  for (const sourceQuery of queries) {
    const count = requestedSourceCount(sourceQuery);
    const videos = sourceQuery.videoIds
      ? await Promise.all(sourceQuery.videoIds.map((id) => getPexelsVideo(apiKey, id)))
      : await searchPexelsVideos(
          apiKey,
          sourceQuery.query,
          sourceQuery.orientation ?? defaultOrientation,
          Math.max(12, count * 4),
        );
    const eligible = sourceQuery.videoIds
      ? videos
      : videos.filter((video) => !usedIds.has(video.id));
    if (eligible.length < count) {
      throw new Error(
        `Pexels returned only ${eligible.length} unused videos for "${sourceQuery.query}"`,
      );
    }
    for (const video of eligible.slice(0, count)) {
      const asset = await downloadPexelsVideo(
        video,
        chooseVideoFile(video, aspect),
        sourceQuery.query,
      );
      usedIds.add(video.id);
      selected.push(asset);
      await copyFile(
        asset.sidecarPath,
        resolve(projectDirectory, 'sources', `pexels-${video.id}.meta.json`),
      );
    }
  }
  await removeStaleProjectSidecars(projectDirectory, usedIds);
  return selected;
}
