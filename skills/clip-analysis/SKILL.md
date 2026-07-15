---
name: clip-analysis
description: Inspect local action-camera or stock footage, extract media metadata, sample long clips efficiently, detect scene boundaries, and segment mixed-content recordings into reusable clip records. Use when importing raw footage, finding usable moments, or preparing a searchable clip catalog.
---

# Clip Analysis

## Workflow

1. Hash the source and reuse cached analysis when path-independent content and analyzer version match.
2. Probe format, streams, dimensions, rotation, frame rate, duration, per-stream start timestamps, color metadata, and audio presence with FFprobe. Partial downloads may have audio before the first decodable video keyframe.
3. Detect likely scene changes with FFmpeg before requesting semantic analysis.
4. Sample representative frames sparsely: start, end, scene candidates, and intervals that grow with duration.
5. Classify sampled regions independently so one long file may produce city, landscape, food, POV, and talking segments.
6. Merge adjacent samples with compatible labels; split at scene boundaries or strong label changes.
7. Assign quality flags for blur, darkness, clipping, instability, duplicate content, and weak duration.

## Cost Controls

- Up to 60 seconds: sample every 5-10 seconds plus boundaries.
- 1-10 minutes: sample every 15-30 seconds plus scene candidates.
- Over 10 minutes: analyze in chunks and persist progress.
- Cap expensive semantic frames per chunk; metadata and scene detection run locally first.

## Clip Record Contract

```json
{
  "source": "raw-footage/ride.mp4",
  "hash": "sha256",
  "duration": 240,
  "video": { "width": 3840, "height": 2160, "fps": 60 },
  "hasAudio": true,
  "segments": [
    {
      "start": 0,
      "end": 18.4,
      "labels": ["chest-pov", "road", "city"],
      "quality": 0.84,
      "sampleFrames": []
    }
  ]
}
```

## Rules

- Never classify an entire long recording from one thumbnail.
- Preserve timestamps in source time.
- Reject or normalize selected ranges that end before the earliest decodable A/V timestamp.
- Distinguish no-audio from silent-audio.
- Do not split rapidly around noisy scene detections; enforce a useful minimum segment length.
- Keep uncertain labels and confidence rather than inventing certainty.
