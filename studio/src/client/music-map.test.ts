import { describe, expect, it } from 'vitest';
import type { BeatMap, StoryboardDraft } from '@ai-video-creation/scripts/types';
import {
  beatMapAnalysisSignature,
  draftMusicAnalysisSignature,
  projectBeatMapToDraft,
} from './music-map.js';

const map: BeatMap = {
  schemaVersion: 1,
  source: 'music.mp3',
  sourceHash: 'hash',
  excerpt: { start: 10, end: 14 },
  analyzer: { name: 'test', version: 1, sampleRate: 11_025 },
  bpm: 120,
  confidence: 0.5,
  beats: [0, 1, 2, 3],
  onsets: [0.25, 1.25, 2.25, 3.25],
  energy: [
    { time: 0, value: 0.1 },
    { time: 2, value: 0.2 },
  ],
  majorMoments: [{ time: 2, kind: 'peak', strength: 1 }],
  sections: [
    { start: 0, end: 2, label: 'calm', energy: 0.1 },
    { start: 2, end: 4, label: 'peak', energy: 0.2 },
  ],
  fallback: false,
};

function draft(start = 10): StoryboardDraft {
  return {
    schemaVersion: 1,
    projectId: 'test',
    createdAt: '2026-07-19T00:00:00.000Z',
    videoTypeId: 'test',
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    gradeId: 'neutral',
    music: { file: 'music.mp3', start, beatMap: 'beat-map.json' },
    shots: [
      {
        id: 'one',
        source: 'one.mp4',
        query: 'one',
        sourceIn: 0,
        duration: 2,
        storyFunction: 'hook',
        anchorX: 0.5,
        anchorY: 0.5,
        transitionToNext: { type: 'cut', duration: 0 },
      },
      {
        id: 'two',
        source: 'two.mp4',
        query: 'two',
        sourceIn: 0,
        duration: 2,
        storyFunction: 'payoff',
        anchorX: 0.5,
        anchorY: 0.5,
        transitionToNext: null,
      },
    ],
    output: 'output.mp4',
  };
}

describe('music map projection', () => {
  it('keeps the analysis current when only scene order changes', () => {
    const original = draft();
    const reordered = { ...original, shots: [...original.shots].reverse() };

    expect(draftMusicAnalysisSignature(reordered)).toBe(draftMusicAnalysisSignature(original));
    expect(beatMapAnalysisSignature(reordered, map)).toBe(draftMusicAnalysisSignature(reordered));
  });

  it('moves overlapping source events earlier while a later music excerpt is analyzed', () => {
    const moved = draft(11);
    const projected = projectBeatMapToDraft(moved, map);

    expect(projected?.majorMoments).toEqual([{ time: 1, kind: 'peak', strength: 1 }]);
    expect(projected?.beats).toEqual([0, 1, 2]);
    expect(projected?.sections).toEqual([
      { start: 0, end: 1, label: 'calm', energy: 0.1 },
      { start: 1, end: 3, label: 'peak', energy: 0.2 },
    ]);
    expect(beatMapAnalysisSignature(moved, map)).not.toBe(draftMusicAnalysisSignature(moved));
  });
});
