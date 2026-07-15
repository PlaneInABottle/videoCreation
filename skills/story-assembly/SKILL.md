---
name: story-assembly
description: Orchestrate video type selection, clip analysis, music analysis, shot selection, edit planning, rendering, and verification into a reproducible storyboard. Use when a user asks to create, revise, or render a complete video from local or Pexels footage.
---

# Story Assembly

Compose the other project skills; do not duplicate their detailed knowledge.

## Workflow

1. Use `video-types-and-formats` to resolve type, format, duration, and narrative pattern.
2. Declare `stock-montage`, `continuous-footage`, or `single-session-multicam` source mode. Use `clip-analysis` or Pexels metadata to create eligible source segments. Pin reviewed Pexels IDs and in-points for reproducible examples.
3. Select a music profile and use `music-and-beat-sync` to choose a structurally useful excerpt and create its map.
4. Use `../../knowledge/social-editing-patterns.json` to select an edit structure and shape a hook, readable setup, escalating build, payoff, and release or loop. Author `cutTimes` when important scene changes should follow verified large musical waves.
5. Fill every narrative beat with a distinct visual function. Prefer one coherent person, place, or activity over maximum source diversity.
6. Use `editing-techniques` to create cuts, reframes, transitions, timing changes, and audio accents.
7. Write the storyboard before rendering.
8. Use `ffmpeg-video-editor` to render and verify the output.
9. Run `npm run evaluate -- --storyboard <path>` and review the fresh contact, detailed-contact, and transition sheets. Treat `technical-pass` as decode/delivery evidence, never editorial approval.
10. Preserve the request, resolved plan, source metadata, music structure map, storyboard, render command manifest, probe result, and quality report.

## Storyboard Contract

```json
{
  "schemaVersion": 1,
  "projectId": "01-cinematic-travel-reel",
  "request": {},
  "videoTypeId": "cinematic-travel-reel",
  "deliveryProfileId": "vertical-short",
  "durationSeconds": 30,
  "music": {},
  "shots": [],
  "audioPlan": {},
  "colorGradeId": "warm-travel",
  "output": "output/example.mp4"
}
```

## Quality Gate

- The first two seconds communicate subject or promise.
- When the featured section is the opening hook, it begins immediately or arrives within roughly five seconds.
- When a popular phrase is intentionally a payoff, the opening visual hooks immediately and the complete musical setup resolves in roughly six to twelve seconds.
- Every shot has a story function and usable duration.
- Repeated source footage is intentional.
- Stock montages do not repeat a source by default; continuous footage may reuse one source across distinct reviewed ranges.
- Transition density is low and motivated.
- Speech is intelligible and not cut mid-word.
- Song excerpts do not begin or end inside a lyric phrase.
- The strongest visual aligns with a large musical or narrative event, not merely a regular beat.
- A large musical event may motivate a hard scene change without motivating a transition effect.
- The long payoff shot is assigned to the narrative payoff function, not a fixed percentage of the shot list.
- Music-led edits vary shot density by section and hold the visual payoff long enough to register; they do not optimize every cut for beat proximity.
- Shot durations vary across hook, setup, build, payoff, and release.
- The sequence remains coherent enough to feel like one experience.
- Final duration, aspect, streams, and decode verification pass.

## Revision

When the user requests a change, update the storyboard first and rerender only affected intermediates. A machine pass does not replace visual review. Keep the prior storyboard and output until the replacement verifies successfully.
