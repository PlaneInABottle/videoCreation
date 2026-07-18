import type { BeatMap, StoryboardDraft } from '@ai-video-creation/scripts/types';

function draftDuration(draft: StoryboardDraft): number {
  return draft.shots.reduce((sum, shot) => sum + shot.duration, 0);
}

function analysisSignature(file: string, start: number, duration: number): string {
  return `${file}:${start.toFixed(4)}:${duration.toFixed(4)}`;
}

export function draftMusicAnalysisSignature(draft: StoryboardDraft): string | null {
  if (!draft.music) return null;
  return analysisSignature(draft.music.file, draft.music.start, draftDuration(draft));
}

export function beatMapAnalysisSignature(
  draft: StoryboardDraft,
  beatMap: BeatMap | null,
): string | null {
  if (!draft.music || !beatMap) return null;
  return analysisSignature(
    draft.music.file,
    beatMap.excerpt.start,
    beatMap.excerpt.end - beatMap.excerpt.start,
  );
}

export function projectBeatMapToDraft(
  draft: StoryboardDraft,
  beatMap: BeatMap | null,
): BeatMap | null {
  if (!draft.music || !beatMap) return null;
  const duration = draftDuration(draft);
  const offset = beatMap.excerpt.start - draft.music.start;
  const shift = (time: number): number => Number((time + offset).toFixed(4));
  const inside = (time: number): boolean => time >= 0 && time <= duration;

  return {
    ...beatMap,
    excerpt: { start: draft.music.start, end: draft.music.start + duration },
    beats: beatMap.beats.map(shift).filter(inside),
    onsets: beatMap.onsets.map(shift).filter(inside),
    energy: beatMap.energy
      .map((sample) => ({ ...sample, time: shift(sample.time) }))
      .filter((sample) => inside(sample.time)),
    ...(beatMap.majorMoments
      ? {
          majorMoments: beatMap.majorMoments
            .map((moment) => ({ ...moment, time: shift(moment.time) }))
            .filter((moment) => inside(moment.time)),
        }
      : {}),
    ...(beatMap.sections
      ? {
          sections: beatMap.sections
            .map((section) => ({
              ...section,
              start: Math.max(0, shift(section.start)),
              end: Math.min(duration, shift(section.end)),
            }))
            .filter((section) => section.end > section.start),
        }
      : {}),
  };
}
