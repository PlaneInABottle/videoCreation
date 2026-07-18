---
name: editing-techniques
description: Design and execute cuts, transitions, pacing, B-roll, reframing, timing effects, and audio accents for automated video edits. Use when building a cut plan, choosing transitions, hiding talking-head removals, creating montages, speed ramps, slow motion, or vertical reframes.
---

# Editing Techniques

Use `../../knowledge/editing-techniques.json` for definitions, constraints, and FFmpeg mappings.

## Workflow

1. Start from the selected video type and narrative beats.
2. Assign each source segment a story function before choosing an effect.
3. Use `hard-cut` by default.
4. Add match cuts where motion, composition, color, sound, or meaning genuinely connects shots.
5. Use soft or stylized transitions only for a motivated change of time, place, energy, or perspective and only after reviewing both sides of the cut. Major music events alone may choose the cut time, not the effect.
6. Validate continuity: screen direction, action completion, subject position, shot-size variation, speech, and ambience.
7. Emit a timestamped cut plan using technique IDs from the knowledge file.

## Gapless Timeline Editing

- Reordering a shot ripples the sequence; it never creates a gap. Preserve an authored transition only when its original from/to pair remains adjacent. New adjacencies start as hard cuts.
- Trimming a shot end changes sequence duration and ripples every downstream timeline time. Rolling an internal cut grows one adjacent shot while shrinking the other, preserving total duration. Enforce a 0.5-second minimum shot duration and validate both source handles before preview or save.
- A slip edit moves `sourceIn` without changing timeline duration. Reject slips before source time zero or beyond the probed source duration.
- Snap only manual boundary or title gestures within a small visible threshold. Default to scene edges, the playhead, and authored large musical moments; allow every detected beat only through an explicit opt-in mode. A snap aid must never become beat-grid enforcement or an evaluation score.
- Keep transition choices to the reviewed project whitelist. Native source-audio timelines remain hard-cut-only until an explicit audio-overlap model exists.

## Cut Plan Contract

```json
{
  "source": "clip.mp4",
  "sourceIn": 4.2,
  "sourceOut": 6.1,
  "timelineIn": 8.0,
  "timelineOut": 9.9,
  "techniqueId": "match-cut",
  "transitionToNext": { "id": "hard-cut", "duration": 0 },
  "reframe": { "x": 0.5, "y": 0.5 },
  "storyFunction": "destination-reveal"
}
```

## Rules

- Preserve story, speech, completed action, and large musical structure before routine beat alignment.
- Use hard cuts for most edits; a professional edit is not a transition collection.
- Keep automatic transition accents disabled. Store an explicit transition time, type, and duration only after footage-compatibility review.
- Never use stream-copy cuts when frame-accurate timing is required.
- Treat J-cuts, L-cuts, match cuts, B-roll selection, and subject reframing as timeline or semantic decisions, not single filters.
- Require normalized streams before concat or `xfade`.
- Use slow motion primarily from high-frame-rate footage; visually inspect interpolation.
- Keep glitch, whip, light-leak, impact, and zoom effects sparse.
