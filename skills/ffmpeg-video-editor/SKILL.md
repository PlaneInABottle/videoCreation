---
name: ffmpeg-video-editor
description: Render project storyboards with FFmpeg, including normalized cuts, transitions, reframing, speed changes, color treatment, music, ambience, and final encoding. Use when converting a cut plan into MP4, debugging filter graphs, or verifying rendered media.
---

# Project FFmpeg Video Editor

Load the system `ffmpeg-video-editor` skill for general command patterns. Use this skill for project-specific constraints.

## Preflight

1. Require `ffmpeg` and `ffprobe` on `PATH`.
2. Probe every input before constructing the graph.
3. Reject missing video streams, invalid durations, and unreadable files.

## Render Workflow

1. Trim source segments accurately and reset timestamps.
2. Normalize video to the delivery resolution, constant frame rate, square pixels, `yuv420p`, and a common timebase.
3. Normalize audio to stereo 48 kHz when present.
4. Apply per-shot reframe, timing, correction, and grade.
5. Concatenate hard-cut segments or chain compatible `xfade` transitions.
6. Build dialogue, native source audio, ambience, effect, and music layers independently. For partial downloads, inspect stream start timestamps and avoid or normalize pre-keyframe gaps before selecting the first segment.
7. Encode H.264/AAC MP4 with `+faststart`.
8. Verify dimensions, duration tolerance, video/audio streams, frame rate, and decode integrity with FFprobe/FFmpeg.

## Required Defaults

```text
vertical:   1080x1920
horizontal: 1920x1080
video:      libx264, yuv420p, CRF 18-21
audio:      AAC, 48 kHz, stereo
color:      SDR BT.709 workflow
```

## Rules

- Use argument arrays through `spawn`, not shell-built commands.
- Never pass untrusted paths into a shell string.
- Normalize every `xfade` input; FFmpeg requires matching constant frame rate, resolution, pixel format, frame rate, and timebase.
- Render ordinary cuts with `concat`, not a one-frame `xfade` substitute.
- The current native-source-audio path is hard-cut-only. Give each audio segment a short anti-click edge fade, concatenate to the authored duration, then normalize the final program.
- Use `-shortest` only as an output guard, not to decide edit duration.
- Keep intermediate artifacts until the final probe succeeds.
- Surface complete FFmpeg stderr when rendering fails.
