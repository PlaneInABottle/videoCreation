# Editorial and Pipeline Review

Evaluation date: 2026-07-19

## Bottom Line

The pipeline is technically credible and editorially improving, but the examples do not all prove the same thing. Pexels is suitable for stock-montage acquisition and mood/category assembly. It is not suitable evidence for one rider, presenter, route, trip, or production sound bed unless the sources genuinely come from one session.

Reports now say `technical-pass`, never editorial pass, and always include `requiresEditorialReview: true`. Evaluation rewrites the standard, detailed, and transition contact sheets from the current output so stale review images cannot silently survive a rerender.

## What the Research Changed

Official platform guidance supports an immediate opening promise, clear beginning-middle-end structure, sound-on design, and iteration from retention rather than a universal timing formula. The reviewed creator examples added an important correction: successful edits do not simply cut faster.

- A 31.37-second train short held its main train/platform chapter for roughly fourteen seconds, then accelerated near the ending.
- A 63.04-second motorcycle film used dense angle and detail changes early, then longer riding holds. One rider plus wide, medium, machine-detail, and action coverage created both coherence and variety.
- A 41.47-second travel film moved from slow place introduction to human reveal, landscape payoff, and a dense closing montage.
- An 17.97-second M83/Tokyo edit clustered changes around large musical/style waves while holding car, skyline, and headlight motifs between clusters.

The resulting rule is: author scene changes around important musical waves when useful, but do not infer that a wave requires a transition effect. A hard cut is still the default.

## Output Review

### 01 City After Dark — Stock Mood Montage

File: `output/01-cinematic-travel-reel.mp4`

Subjective score: **7.1/10**

What works:

- Nine unique reviewed sources; no repeated traffic or rain clips.
- The daylight insert around eleven seconds is gone.
- A readable traffic → rain → neon → metro → crowd → train → facade → skyline → bokeh progression.
- The low-information platform clip at `10.5–12.25s` was replaced with a brighter, directional train arrival so the build no longer reads as a decode glitch.
- Authored scene changes at the excerpt's major waves, including `4.0`, `6.25`, `8.75`, `12.25`, and `15.75` seconds.
- The skyline payoff arrives at `15.75s`, followed by a distinct visual release.
- Ordinary cuts are true hard cuts. No automatic zoom/dissolve effect is inferred from music.

What is still missing:

- It is a multi-city mood montage, not one documented trip; the title no longer claims Seoul.
- There is no traveler, recurring human objective, or authored action that connects scenes.
- Shot-scale variety is limited because most sources are vertical establishing or medium views.
- Traffic, rain, train, and crowd ambience are absent.

Verdict: useful as a reviewed Pexels montage demo, below strong creator travel work built from one filmed experience.

### 02 Motovlog Stock Montage

File: `output/02-motovlog-fast-cut.mp4`

Subjective score: **5.6/10**

What works:

- The Chris Rea lyric setup resolves at the intended `9.08s` payoff.
- The music envelope grows into that payoff.
- The category is immediately readable as motorcycle travel.

Why it is not a proper motovlog demonstration:

- Rider, bike, camera, country, road surface, weather, and geography change between clips.
- There is no trustworthy engine/road sound continuity or arrival.
- Additional transitions cannot repair the source contradiction.

Verdict: retain only as a stock-montage stress case. Do not present it as the primary motovlog quality example.

### 03 Talking Head with B-roll

File: `output/03-talking-head-broll.mp4`

Publishable-quality score: **3.5/10**

What it proves technically:

- Voice/music mixing, ducking, vertical framing, B-roll replacement, and rendering.

Why it remains unpublishable:

- Generated narration does not match the stock presenters' lips.
- Two unrelated presenters appear as one speaker.
- There are no word-timed captions or transcript-mapped B-roll decisions.
- Timing effects cannot fix the absence of a real performance.

Verdict: negative/control example only.

### 04 Tokyo Night — Stock Mood Montage

File: `output/04-night-city-beat-edit.mp4`

Subjective score: **7.4/10**

What works:

- Strongest visual coherence among the original Pexels edits: night-only Tokyo streets, crowds, trains, signs, and skyline.
- Two complete lyric lines and a recognizable opening phrase.
- Clearer hook-build-payoff shape than the other original stock examples.

Remaining limits:

- Still independently filmed stock rather than one night with a person or objective.
- No traffic, crowd, or train sound accents.
- The current output uses hard cuts only; visual continuity still depends on independently filmed stock.

Verdict: competent mood-template reference, not top creator work.

### 05 Tokyo Expressway — Continuous Licensed Motovlog

File: `output/05-continuous-motovlog.mp4`

Subjective score: **6.7/10**

What works:

- One licensed YouTube source, one rider, one bike, one route, one camera, and selected native audio.
- Eight reviewed time ranges compress a 109.98-second section into 28 seconds while preserving forward direction and geography.
- Native audio reaches the full authored duration, measures `-13.8 LUFS` and `-2.7 dBFS` true peak, and uses short anti-click edge fades.
- Source URL, creator, Creative Commons license, selected section, format, full extractor metadata, and SHA-256 are preserved.

What is still missing:

- One fixed POV produces continuity but limited visual development.
- No helmet/chest alternate, bike detail, roadside camera, rider reaction, or arrival/dismount coverage exists in the selected source.
- Audio is hard-cut-only; authored J-cuts, L-cuts, crossfades, wind control, and engine emphasis are future work.

Verdict: the best proof of continuity and native-audio handling, but not yet the most visually engaging example. A single-session multicamera ride is the correct next source target.

## Pipeline Changes in This Pass

- Added a localhost React/Express Studio for inspecting sources and review sheets, editing a gapless multitrack storyboard, and rendering exact FFmpeg proxies before an explicit save.
- Added revision-conflict checks, stable-asset validation, source-range validation, a sequential render queue, ignored thumbnail/waveform/proxy caches, and atomic verified final replacement.
- Added proxy and final render profiles plus globally timed title overlays that remain correct across composed segments and transitions.
- Added live roll edits for internal cuts, continuous animation-frame playback, and revision fingerprints so late save or preview responses cannot mark newer edits current.
- Fixed live backward seeking during playback, made music the live clock when available, tightened A/V drift correction, and kept musical markers synchronized when the excerpt moves.
- Relabeled analyzer output as relative RMS loudness, candidate moments, loudness transients, and an estimated pulse grid instead of implying semantic song-section or true downbeat detection.
- Serialized project writes, bounded job and proxy retention, and cached FFprobe metadata by source size and modification time.
- Added pinned Pexels IDs, reviewed in-points, and story-function overrides.
- Added explicit source modes: `stock-montage`, `continuous-footage`, and `single-session-multicam`.
- Added type-aware repetition checks: stock montages warn on repeated clips; continuous footage does not.
- Added authored `cutTimes` for major-wave scene maps without reintroducing beat-grid enforcement.
- Replaced one-frame `xfade` substitutes with true hard-cut concatenation.
- Removed automatic transition effects; transition accents now require explicit time, type, and duration.
- Added optional native source-audio assembly for hard-cut timelines.
- Added partial-download timestamp diagnosis after a real WebM exposed audio before the first decodable video keyframe.
- Moved music-volume envelopes before final music loudness normalization.
- Added current standard, detailed, and transition review sheets to every evaluation.
- Changed machine verdict wording from `pass` to `technical-pass` and made editorial review explicit.
- Removed source diversity as a universal quality goal.
- Added a continuous Creative Commons motovlog example with full source provenance.

## Edit Taxonomy Going Forward

Content type and edit structure are separate choices:

- Content types: travel, motovlog, talking head, food, vlog, product, tutorial, lyric, gaming, podcast, fitness.
- Edit structures: mood montage, continuity journey, reveal arc, proof arc, performance highlight, loop study.
- Source modes: stock montage, continuous footage, single-session multicam.

The same content type can use different structures. A travel mood montage and a travel continuity journey should not share one source-selection or quality rule.

## Highest-Priority Next Work

1. Acquire one licensed or user-owned single-session multicamera ride with POV, machine details, rider reaction, roadside coverage, and arrival.
2. Add shot-scale, subject, time-of-day, palette, and camera-motion review metadata before assembly.
3. Add authored J-cuts, L-cuts, short ambience crossfades, wind control, and engine/shift emphasis.
4. Replace the talking-head control with a real presenter, transcript timestamps, silence removal, word-timed captions, and phrase-specific B-roll.
5. Generate opening variants and compare viewed-versus-swiped-away, three-second retention, completion, rewatches, saves, and shares within the same video type.
6. Publish music-led examples only through platform music libraries or properly cleared tracks.

## Research Sources

- TikTok 2026 Creative Starter Pack: `https://ads.tiktok.com/business/library/AUNZ_Creative_Starter_Pack_TakeItToTikTok.pdf`
- TikTok Storytelling Formats: `https://ads.tiktok.com/business/library/Storytelling_Formats_One_Pager_SMB.pdf`
- YouTube recommendation performance guidance: `https://support.google.com/youtube/answer/16559650?hl=en`
- YouTube Shorts analytics guidance: `https://support.google.com/youtube/answer/12942217?hl=en`
- Observed train edit: `https://www.youtube.com/watch?v=PNYH5u9Yuc4`
- Observed motorcycle film: `https://www.youtube.com/watch?v=PSHTkGHfSVo`
- Observed Darjeeling travel film: `https://www.youtube.com/watch?v=7fkcyK5K9w8`
- Observed M83/Tokyo edit: `https://www.youtube.com/watch?v=JJOkj4II4zM`
