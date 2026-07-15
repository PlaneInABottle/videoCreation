---
name: video-types-and-formats
description: Select a video type, duration, platform, aspect ratio, narrative pattern, and delivery profile from a creative request. Use for reels, Shorts, TikTok, travel edits, motovlogs, talking-head videos, food videos, compact YouTube vlogs, and format conversions between 9:16 and 16:9.
---

# Video Types and Formats

Use `../../knowledge/video-types.json` as the source of truth.

## Workflow

1. Extract subject, audience, target platform, duration, aspect ratio, mood, and available footage tags from the request.
2. Match explicit type names first. Otherwise score each type by `sourceContentTags`, platform, duration, and requested mood.
3. Select `vertical-short` for Reels, TikTok, or Shorts unless the request says otherwise. Select `horizontal-standard` for normal YouTube delivery.
4. Return the selected type's narrative pattern, pacing, shot recipe, technique IDs, color IDs, and music profile IDs.
5. Select a compatible source mode from `../../knowledge/social-editing-patterns.json`. Flag missing coverage needed to complete the narrative, but offer honest substitutions before blocking.
6. For Reels and TikTok, consult `../../knowledge/social-editing-patterns.json` and require a clear hook, build, payoff, and resolution or loop.

## Output Contract

Return JSON-compatible data:

```json
{
  "videoTypeId": "cinematic-travel-reel",
  "deliveryProfileId": "vertical-short",
  "durationSeconds": 35,
  "narrativePattern": [],
  "sourceContentTags": [],
  "editingTechniqueIds": [],
  "preferredColorGradeIds": [],
  "preferredMusicProfileIds": [],
  "assumptions": []
}
```

## Rules

- Treat creative duration ranges as defaults, not platform upload limits.
- Compose 9:16 and 16:9 separately; never promise that a blind center crop will work.
- Preserve important subjects, road direction, captions, and product controls when reframing.
- Do not use a stock montage to claim continuity that requires one person, route, session, or production sound bed.
- Prefer the primary project types when several choices score equally.
- Do not invent a platform specification not present in the knowledge file.
