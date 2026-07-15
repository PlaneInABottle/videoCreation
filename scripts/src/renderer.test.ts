import assert from 'node:assert/strict';
import test from 'node:test';
import {
  musicFadeInSeconds,
  musicVolumeEnvelope,
  nextVisualDuration,
  sourceAudioSegmentFilter,
  visualTransitionFilter,
} from './renderer.js';

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
