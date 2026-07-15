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
