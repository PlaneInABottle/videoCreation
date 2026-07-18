# Video Creation Knowledge Base

This directory is the source of truth for video-planning decisions. It describes what to make, how to edit it, how to synchronize edits to music, and how to choose a color treatment. Phase 2 skills should read these files rather than duplicate their contents.

## Files

| File                           | Purpose                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `video-types.json`             | Output profiles, platform context, narratives, shot recipes, pacing, and technique references for each video type.  |
| `social-editing-patterns.json` | Source modes, edit structures, short-form recipes, observed examples, review rubric, and current platform research. |
| `editing-techniques.json`      | Cuts, transitions, timing effects, framing methods, and audio treatments with FFmpeg implementation notes.          |
| `music-genres.json`            | Music profiles, beat-grid logic, synchronization policy, ducking, track fitting, and analysis-tool comparison.      |
| `color-grades.json`            | Correction workflow and restrained grade presets with FFmpeg filter starting points.                                |

All machine-readable files use stable kebab-case IDs. Relationships are represented by IDs, such as a video type referencing `hard-cut`, `warm-travel`, and `driving-rock`.

## Core Editing Model

The editor should make decisions in this order:

1. Parse the requested story, duration, aspect ratio, mood, and sound needs.
2. Select a video type, edit structure, source mode, and output profile.
3. Build a narrative arc before selecting effects.
4. Analyze music when present and identify large waves, phrase boundaries, energy sections, onsets, and secondary beat evidence.
5. Select reviewed clips for story function, shot-scale variation, and visual continuity.
6. Author scene changes around narrative or large musical events, then reject cuts that damage speech or action continuity.
7. Normalize every selected clip to a common resolution, frame rate, timebase, sample aspect ratio, and pixel format.
8. Apply correction, reframing, timing changes, transitions, sound design, and a restrained grade.
9. Mix dialogue, source ambience, effects, and music.
10. Render and verify duration, dimensions, streams, synchronization, and loudness.

Music informs pacing; it does not override meaning. A large musical wave may motivate a hard scene change without motivating a transition effect.

## Source Modes

- `stock-montage`: independently filmed clips. Review and pin IDs/in-points, avoid repeated sources by default, and do not imply one trip or person.
- `continuous-footage`: one recording or session. Reusing one source is expected; preserve direction, geography, usable timestamps, and native audio.
- `single-session-multicam`: one person/place/activity with multiple shot scales and synchronized sound. Prefer this for the strongest polished examples.

## Primary Project Profiles

### Cinematic Travel Reel

- Target: 30-40 seconds, normally 9:16.
- Arc: hook, orientation, sensory details, movement, hero reveal, release.
- Footage: city establishing shots, architecture, streets, beaches, food details, moving POV, and occasional face-to-camera moments.
- Rhythm: mostly one- or two-beat shots, with longer holds for visual payoff.
- Style: hard cuts and match cuts dominate; transitions are reserved for major phrase or location changes.

### Motovlog Reel

- Target: 25-40 seconds, normally 9:16.
- Arc: immediate motion, route context, acceleration, destination or encounter, final release.
- Footage: chest POV, road geometry, controls, mirrors, traffic, landmarks, reaction shots, and destination details.
- Rhythm: faster around musical peaks, but road readability and safety context remain clear.
- Style: hard cuts, motion matches, sparse whip transitions, speed ramps only around clean movement.

### Talking Head With B-roll

- Target: 30-60 seconds for short-form and up to five minutes for a compact YouTube story.
- Arc: spoken hook, setup, proof/examples, takeaway.
- Footage: a clean primary statement plus B-roll that demonstrates each claim.
- Rhythm: edit speech for clarity first; align B-roll changes or emphasis cuts to nearby musical events.
- Style: J-cuts, L-cuts, jump cuts hidden by B-roll, captions, and subtle music ducking.

### Food Reel

- Target: 20-40 seconds, normally 9:16.
- Arc: finished-dish hook, ingredients/place, preparation, texture reveal, first bite or final plate.
- Footage: wide context, hands, close details, steam/pour/cut actions, plate, and reaction.
- Rhythm: alternate fast preparation fragments with slower texture moments.
- Style: action match cuts, natural kitchen sound accents, warm but believable color.

## Aspect-Ratio Policy

The project has two delivery masters:

- Vertical: 1080x1920, 9:16, intended for Reels, TikTok, and Shorts.
- Horizontal: 1920x1080, 16:9, intended for standard YouTube videos.

Vertical and horizontal outputs must be composed separately. Do not blindly center-crop a finished horizontal timeline. Reframe each source segment around its subject. If a horizontal shot cannot survive a vertical crop, use a designed background fill or select a different shot.

YouTube states that square or vertical uploads up to three minutes can be classified as Shorts, while 16:9 remains the standard desktop aspect ratio. TikTok's current auction-ad specification recommends 9:16 for vertical and also accepts 16:9 and 1:1. The project durations are creative targets, not platform maximums.

## Pacing Model

Shape density by story and music section instead of deriving every shot from BPM:

- Opening: deliver the visual or spoken promise immediately and keep it readable.
- Setup: establish person, place, direction, or problem with enough context to create anticipation.
- Build: add new information and vary shot scale; shorten only selected shots as tension rises.
- Payoff: place the strongest action, result, or view on a useful narrative or musical change and hold it long enough to register.
- Release or loop: resolve with ambience, reaction, departure, or an image/sound that reconnects to the opening.

An editor may author exact `cutTimes` around verified musical waves. Beats and onsets can refine nearby local cuts, but are not the primary pacing generator.

## Music Synchronization Rules

Store three separate event classes:

- `beats`: recurring pulse positions used for pacing.
- `onsets`: local transients such as kicks, snares, hits, or new notes; useful for impact edits.
- `sections`: larger musical changes such as intro, verse, chorus, breakdown, and outro; useful for story changes.

Prefer verified phrase and section evidence over a BPM-only grid. Energy analysis cannot identify which lyric, melody, or edit point is culturally recognizable; known hooks need editorial metadata or auditioning.

Cut priority:

1. Narrative event or intelligible speech.
2. Strong section boundary, lyric change, silence, lift, impact, or release.
3. Action completion or direction match.
4. Strong onset near the intended cut.
5. Regular beat subdivision.
6. Time-grid fallback when reliable events are unavailable.

Use beats or onsets only to refine a cut that already works for story, action, and the larger musical phrase. Do not score ordinary beat proximity or infer an effect from a musical event.

## Audio Mix Model

Audio layers, in priority order:

1. Dialogue or essential location sound.
2. Intentional sound effects and action accents.
3. Ambient bed that preserves a sense of place.
4. Music.

Use `sidechaincompress` to duck music when dialogue is present, then mix with `amix`. Use fades at every artificial music boundary. Loudness normalization belongs near the end of the audio chain, after the relative mix is established. Keep a true-peak ceiling to reduce clipping after platform transcoding.

Popular music can be a local edit-development reference. Store title, artist, source URL, selected excerpt, and analysis metadata so an edit can be recreated. Publishing still requires the platform's licensed audio library or separately cleared rights; local acquisition is not a publishing license.

## Color Workflow

Correction and grading are separate stages:

1. Interpret source color correctly.
2. Correct exposure and white balance.
3. Match adjacent clips.
4. Protect skin, food, sky, and highlight detail.
5. Apply the selected creative grade.
6. Check the result at full output resolution and in motion.

The values in `color-grades.json` are conservative starting points, not automatic truths. A named look should never be applied without first normalizing mismatched source clips.

## FFmpeg Constraints

- Accurate editorial cuts require decoding and re-encoding; stream-copy cuts are keyframe-limited.
- Reset timestamps after trimming with `setpts=PTS-STARTPTS` and `asetpts=PTS-STARTPTS`.
- `xfade` inputs must have matching constant frame rate, resolution, pixel format, frame rate, and timebase.
- Normalize clips before concatenation or transitions.
- J-cuts and L-cuts are timeline relationships, not single filters; trim and place audio independently from video.
- Match cuts require semantic or motion-aware shot selection; FFmpeg only executes the selected timing.
- Complex effects such as whip-pan, light-leak, and glitch transitions need composed filter graphs or overlay assets.
- Slow motion is best when high-frame-rate source footage exists. Frame interpolation can help but may create artifacts around occlusion and fast motion.

## Analysis Tool Decision

The current TypeScript analyzer decodes a mono PCM excerpt and produces relative RMS loudness regions, candidate lifts/crests/drops, loudness transients, a fixed estimated pulse grid, BPM, and an uncalibrated pulse-fit score. Its two-second regions are not semantic verses or choruses, its pulse ticks are not individually detected beats, and every fourth tick is not a detected downbeat. Explicit editorial hook and verified phrase timing are stronger than amplitude-only inference.

A future analyzer may add richer musical descriptors, but it must be evaluated on known excerpts and cannot claim cultural hook recognition from signal energy. Do not assume tempo confidence guarantees frame-accurate or editorially correct cut positions.

## Sources

Research checked on 2026-07-12:

- FFmpeg filter documentation: <https://ffmpeg.org/ffmpeg-filters.html>
- FFmpeg project documentation via Context7: `/websites/ffmpeg_documentation`
- Essentia.js documentation via Context7: `/mtg/essentia.js`
- Essentia `RhythmExtractor2013`: <https://essentia.upf.edu/reference/std_RhythmExtractor2013.html>
- Essentia `OnsetRate`: <https://essentia.upf.edu/reference/std_OnsetRate.html>
- aubio command-line documentation: <https://aubio.org/manual/latest/cli.html>
- YouTube recommended encoding settings: <https://support.google.com/youtube/answer/1722171>
- YouTube three-minute Shorts: <https://support.google.com/youtube/answer/15424877>
- TikTok auction in-feed video specifications: <https://ads.tiktok.com/help/article/video-ads-specifications>
- TikTok 2026 Creative Starter Pack: <https://ads.tiktok.com/business/library/AUNZ_Creative_Starter_Pack_TakeItToTikTok.pdf>
- YouTube recommendation performance guidance: <https://support.google.com/youtube/answer/16559650?hl=en>
- YouTube Shorts analytics guidance: <https://support.google.com/youtube/answer/12942217?hl=en>

Creative ranges and recipes in this knowledge base are project defaults synthesized for the user's footage and output goals. They should be refined after visual review of the Phase 4 examples.
