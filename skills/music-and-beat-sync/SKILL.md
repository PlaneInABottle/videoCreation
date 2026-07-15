---
name: music-and-beat-sync
description: Select music by mood and video type, analyze BPM, beats, onsets, sections, and energy, fit an excerpt to an exact duration, synchronize edits, and duck music under dialogue. Use for beat-driven reels, motovlogs, travel montages, popular-song edits, sound design, and dialogue/music mixing.
---

# Music and Beat Sync

Use `../../knowledge/music-genres.json` as the source of truth.

## Workflow

1. Select candidate music profiles from the video type, requested mood, dialogue density, and required emotional arc.
2. Choose an excerpt containing a useful entrance, lift, impact, peak, release, vocal change, chorus, or drop. For a known popular section, verify synced lyrics or audition the track. Decide whether it is the opening hook or a later payoff. For a payoff, preserve a complete preceding lyric or musical pickup and build toward the recognizable phrase in roughly six to twelve seconds. Never back into the middle of a lyric or begin directly on the climax by default.
3. Decode an analysis copy and generate major moments, energy sections, onset, beat, and confidence data.
4. Map the hook, scene-change clusters, pacing change, payoff, and ending to large musical or narrative changes. Author exact major-wave cut times when the automatic section map is insufficient.
5. Use beats and onsets only as secondary micro-timing aids for ordinary cuts.
6. Preserve speech and action continuity even when a cut must move away from a beat.
7. Fit the excerpt with phrase-aware trimming, complete-bar removal, looping, or a designed fade. End between complete lyric or instrumental phrases rather than fading through a sentence.
8. Duck music under dialogue and normalize only after the relative mix is complete.

## Beat Map Contract

```json
{
  "sourceHash": "sha256",
  "excerpt": { "start": 0, "end": 35 },
  "analyzer": { "name": "music-structure-energy", "version": 2 },
  "bpm": 120,
  "confidence": 0.7,
  "beats": [],
  "onsets": [],
  "energy": [],
  "majorMoments": [{ "time": 12.5, "kind": "lift", "strength": 1.8 }],
  "sections": [{ "start": 10, "end": 12, "label": "build", "energy": 0.2 }],
  "fallback": false
}
```

## Rules

- Do not call every onset a beat or every fourth beat a downbeat.
- Use a tempo grid only when detection is unreliable.
- Vary shot durations; avoid cutting on every available event.
- Never treat regular beat proximity as an edit-quality score.
- Reserve hero reveals, speed changes, and stylized transitions for meaningful musical changes.
- Do not infer that a meaningful musical change requires an effect. Use a hard scene change unless compatible motion, shape, light, or composition explicitly motivates a transition.
- For music-led short videos, review excerpts whose first featured section arrives later than five seconds.
- Treat explicit editorial hook timing as stronger evidence than an energy-only peak, and preserve both in the report.
- Do not confuse immediate visual attention with immediate musical climax; suspense can hook visually while music builds.
- Shape pacing around sections and contrast: readable setup, increasing density through a build, a longer peak or payoff hold, and a calmer release. Beat timing is only a local refinement.
- Use a gradual volume envelope when the music should grow into a later payoff instead of beginning at full intensity.
- Prefer instrumental or sparse sections under speech.
- Record title, artist, source URL, excerpt, hash, and analysis metadata for user-directed popular tracks.
- Treat analyzer confidence as evidence, not certainty; audition important sync points.
