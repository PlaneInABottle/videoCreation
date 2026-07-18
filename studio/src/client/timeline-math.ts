export type TimelineSnapMode = 'off' | 'major' | 'beat';

export function snapTimelineValue(
  time: number,
  duration: number,
  candidates: number[],
  enabled: boolean,
  pixelsPerSecond = 56,
): number {
  const clamped = Math.max(0, Math.min(duration, time));
  if (!enabled || candidates.length === 0) return clamped;
  const nearest = candidates.reduce(
    (best, candidate) =>
      Math.abs(candidate - clamped) < Math.abs(best - clamped) ? candidate : best,
    candidates[0]!,
  );
  const threshold = 8 / pixelsPerSecond;
  return Math.abs(nearest - clamped) <= threshold ? nearest : clamped;
}
