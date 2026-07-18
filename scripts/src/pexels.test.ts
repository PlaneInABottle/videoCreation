import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseVideoFile,
  getPexelsVideo,
  requestedSourceCount,
  searchPexelsVideos,
} from './pexels.js';
import type { PexelsVideo } from './types.js';

const video: PexelsVideo = {
  id: 1,
  width: 3840,
  height: 2160,
  duration: 10,
  url: 'https://example.com/video',
  image: 'https://example.com/image',
  user: { id: 1, name: 'Creator', url: 'https://example.com/creator' },
  video_pictures: [],
  video_files: [
    {
      id: 1,
      quality: 'hd',
      file_type: 'video/mp4',
      width: 1920,
      height: 1080,
      fps: 30,
      link: 'https://example.com/landscape.mp4',
    },
    {
      id: 2,
      quality: 'hd',
      file_type: 'video/mp4',
      width: 1080,
      height: 1920,
      fps: 30,
      link: 'https://example.com/portrait.mp4',
    },
  ],
};

test('selects the file closest to the requested delivery orientation', () => {
  assert.equal(chooseVideoFile(video, '9:16').id, 2);
  assert.equal(chooseVideoFile(video, '16:9').id, 1);
});

test('uses pinned Pexels IDs as a reproducible source count', () => {
  assert.equal(requestedSourceCount({ query: 'reviewed night clips', videoIds: [11, 22] }), 2);
  assert.throws(
    () => requestedSourceCount({ query: 'invalid pins', count: 1, videoIds: [11, 22] }),
    /pins 2 videos but requests 1/,
  );
});

test('uses the current Pexels v1 video endpoints', async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify(requests.length === 1 ? { videos: [video] } : video), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await searchPexelsVideos('test-key', 'night train', 'portrait', 3);
    await getPexelsVideo('test-key', video.id);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.match(requests[0] ?? '', /^https:\/\/api\.pexels\.com\/v1\/videos\/search\?/);
  assert.equal(requests[1], 'https://api.pexels.com/v1/videos/videos/1');
});
