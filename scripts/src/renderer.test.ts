import assert from 'node:assert/strict';
import test from 'node:test';
import {
  musicFadeInSeconds,
  musicVolumeEnvelope,
  nextVisualDuration,
  resolveRenderProfile,
  sourceAudioSegmentFilter,
  titleFilter,
  visualTransitionFilter,
} from './renderer.js';
import type { Storyboard } from './types.js';

test('preserves a track designed to start at its beginning', () => {
  assert.equal(musicFadeInSeconds(0), 0);
});

test('uses only an anti-click fade for a mid-track excerpt', () => {
  assert.equal(musicFadeInSeconds(20), 0.08);
});

test('builds music volume gradually toward an editorial payoff', () => {
  assert.equal(
    musicVolumeEnvelope(0.55, 9.08),
    "volume='0.550+0.450*min(t/9.080\\,1)':eval=frame,",
  );
  assert.equal(musicVolumeEnvelope(1, 9.08), '');
});

test('renders ordinary edits as true hard cuts without losing duration', () => {
  const cut = { type: 'cut', duration: 0 };
  assert.equal(
    visualTransitionFilter('left', 'right', 'joined', cut, 2),
    '[left][right]concat=n=2:v=1:a=0[joined]',
  );
  assert.equal(nextVisualDuration(2, 3, cut), 5);
});

test('normalizes and edge-fades native source audio segments', () => {
  const filter = sourceAudioSegmentFilter(3, 2.5, 'native_0');
  assert.match(filter, /^\[3:a\]atrim=duration=2\.5000/);
  assert.match(filter, /aresample=48000/);
  assert.match(filter, /afade=t=out:st=2\.4880:d=0\.0120\[native_0\]$/);
});

function storyboard(): Storyboard {
  return {
    schemaVersion: 1,
    projectId: 'render-test',
    createdAt: '2026-07-18T00:00:00.000Z',
    videoTypeId: 'test',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 10,
    gradeId: 'neutral-clean',
    title: 'Move me',
    subtitle: 'Across scene boundaries',
    titlePlan: { timelineIn: 2, timelineOut: 5, anchorX: 0.5, anchorY: 0.7 },
    music: { file: 'music/test.mp3', start: 0, beatMap: 'beat-map.json' },
    shots: [],
    output: 'output/test.mp4',
  };
}

test('uses a smaller proxy profile without changing final delivery settings', () => {
  const plan = storyboard();
  assert.deepEqual(resolveRenderProfile(plan, 'proxy'), {
    name: 'proxy',
    width: 540,
    height: 960,
    preset: 'ultrafast',
    crf: 24,
    audioBitrate: '128k',
  });
  assert.equal(resolveRenderProfile(plan, 'final').width, 1080);
});

test('renders title timing against the composed global timeline', () => {
  const filter = titleFilter(storyboard());
  assert.match(filter ?? '', /between\(t,2\.000,5\.000\)/);
  assert.match(filter ?? '', /x=\(w-text_w\)\*0\.500/);
  assert.match(filter ?? '', /y=h\*0\.700/);
});

test('scales proxy typography with the render profile dimensions', () => {
  const finalPlan = storyboard();
  const proxyProfile = resolveRenderProfile(finalPlan, 'proxy');
  const proxyPlan = {
    ...finalPlan,
    width: proxyProfile.width,
    height: proxyProfile.height,
  };

  assert.match(titleFilter(finalPlan) ?? '', /fontsize=72/);
  assert.match(titleFilter(proxyPlan) ?? '', /fontsize=36/);
  assert.match(titleFilter(proxyPlan) ?? '', /shadowx=2:shadowy=2/);
});
