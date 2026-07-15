# AI Video Creation

Local TypeScript and FFmpeg pipeline for turning a creative request into a storyboard and rendered video. It separates stock montages from continuous-footage and single-session edits so technical variety is not confused with story continuity.

## Pipeline

```text
request, project.json, or reviewed storyboard
  -> video type and format
  -> source mode: stock montage | continuous footage | single-session multicam
  -> reviewed Pexels IDs, local footage, or licensed continuous source
  -> optional music plus native source-audio plan
  -> musical structure and authored major-wave map when music-led
  -> edit structure and hook-build-payoff storyboard
  -> normalized FFmpeg segments
  -> true hard cuts or explicitly authored compatible transitions
  -> grade, title, native audio, music, dialogue, and effects
  -> verified MP4
```

Every Pexels download has a `.meta.json` sidecar. Licensed external sources preserve URL, creator, license, selected range, format, and hash metadata. Intermediate renders and command manifests are kept under `.cache/` for diagnosis and reuse.

See `EVALUATION.md` for the final technical and subjective review of all demos.

## Requirements

- Node.js 20 or newer
- FFmpeg and FFprobe
- yt-dlp
- `PEXELS_API_KEY`

On this machine the Pexels key is loaded by `~/.zshrc`. Run commands from a login shell or export the key first.

Popular-song files in this workspace are edit-development references, not a publishing license. For release, use the platform's licensed music library, a cleared master/composition, or royalty-free music whose terms cover the intended use.

## Install

```bash
npm install
npm test
npm run typecheck
npm run lint
```

## Create Videos

Render a predefined project:

```bash
npm run create -- --project projects/01-cinematic-travel-reel
```

Create directly from options:

```bash
npm run create -- \
  --type cinematic-travel-reel \
  --length 30 \
  --aspect 9:16 \
  --music "M83 Midnight City official audio" \
  --title "COAST / CITY"
```

Create from a natural-language request:

```bash
npm run create -- \
  --request "make a 30 second vertical motovlog with energetic music" \
  --music "Chris Rea Looking for the Summer official audio"
```

Review a storyboard before rendering:

```bash
npm run create -- --project projects/01-cinematic-travel-reel --storyboard-only
npm run create -- --storyboard projects/01-cinematic-travel-reel/storyboard.json
```

Inspect local footage or music:

```bash
npm run analyze -- --input raw-footage/ride.mp4 --scenes
npm run beats -- --input music/track.mp3 --start 10 --length 30
```

Evaluate a rendered edit:

```bash
npm run evaluate -- --storyboard projects/04-night-city-beat-edit/storyboard.json
```

The evaluator rewrites `quality/report.json`, `contact-sheet.jpg`, `detailed-contact-sheet.jpg`, and `transition-sheet.jpg` from the current output. It checks hook duration, featured-music arrival, pacing variation, major-wave emphasis, payoff placement, effect density, render properties, source-mode repetition rules, loudness, black frames, and frozen frames. `technical-pass` means delivery/decode checks passed; `requiresEditorialReview` always remains true. Regular beat proximity is not an edit-quality score.

Run `npm run create -- --help` for all options.

## Add a Project

Create `projects/<id>/project.json`:

```json
{
  "id": "my-travel-reel",
  "type": "cinematic-travel-reel",
  "sourceMode": "stock-montage",
  "editStyle": "social-arc",
  "length": 30,
  "aspect": "9:16",
  "gradeId": "warm-travel",
  "musicQuery": "artist track official audio",
  "title": "ONE DAY AWAY",
  "cutTimes": [0, 1.5, 5, 9, 14, 20, 26, 30],
  "queries": [
    { "query": "reviewed city movement", "videoIds": [12345, 23456, 34567, 45678] },
    { "query": "reviewed street details", "videoIds": [56789, 67890, 78901] }
  ]
}
```

`videoIds` pins reviewed Pexels results so rerenders do not drift when search ranking changes. Use one query entry per reviewed clip when each needs its own `sourceIn`, `storyFunction`, or framing anchor. The number of `cutTimes` must be the number of shots plus one, beginning at `0` and ending at the project duration. Omit `cutTimes` to use section-shaped automatic pacing.

When `musicStart` is omitted, the pipeline keeps a designed opening with an early lift or backs up from a later structural event by complete bars. Energy analysis cannot determine which lyric or melody is culturally recognizable. For a known popular section, set `musicStart` to the beginning of a complete setup phrase, `musicHookTime` to the recognizable phrase's absolute track time, and `musicHookRole` to `opening` or `payoff`. Use `payoff` when the visual hook should create immediate attention while the music builds anticipation for roughly 6-12 seconds. Pacing follows musical sections: readable setup, denser build, longer peak or payoff hold, and relaxed release. `musicVolumeStart` and `musicVolumeFullAt` can add a gradual audio rise into a payoff.

Scene changes may be authored on large musical waves, but transition effects are never inferred from music alone. Add `transitionAccents` only after reviewing both clips around a cut. Then run `npm run create -- --project projects/my-travel-reel`.

## Choose the Source Mode First

- `stock-montage`: independent clips assembled around one subject and visual world. Pin reviewed IDs, avoid repeated clips, and do not imply one continuous trip.
- `continuous-footage`: one recording or session compressed into a story. Reusing one source is expected; preserve direction, geography, and native audio.
- `single-session-multicam`: one person/place/activity with wide, medium, detail, POV, and reaction coverage. This is the strongest source mode for polished travel, product, food, and motorcycle edits.

The Pexels examples prove acquisition and montage assembly. They cannot honestly prove rider, route, presenter, or production-sound continuity. `projects/05-continuous-motovlog` is the continuous-footage example:

```bash
npm run create -- --storyboard projects/05-continuous-motovlog/storyboard.json
npm run evaluate -- --storyboard projects/05-continuous-motovlog/storyboard.json
```

Its source metadata records the YouTube Creative Commons license, creator attribution, selected section, format, and hash. Native source-audio editing is currently limited to hard-cut timelines; J-cuts, L-cuts, and audio crossfades require an authored sound plan.

## Add Your Footage

Place action-camera clips in `raw-footage/`. Use `npm run analyze` to inspect metadata, scene boundaries, sparse review frames, and candidate mixed-content segments. The next workflow step is to classify the generated review frames and replace Pexels storyboard source paths with selected local segments; the renderer accepts any readable local video path.

For long mixed recordings, analyze in chunks and preserve source timestamps. A single file may contain POV riding, city establishing footage, food, and talking sections; do not classify it from one thumbnail.

## Knowledge and Skills

- `knowledge/`: structured video, editing, social-editing, music, and color research.
- `skills/`: six modular AI playbooks that compose the workflow.
- `scripts/`: the executable TypeScript pipeline.

## Output Profiles

- Vertical short: 1080x1920, 30 fps, H.264/AAC MP4.
- Horizontal standard: 1920x1080, source-appropriate pacing, H.264/AAC MP4.

## Troubleshooting

- `PEXELS_API_KEY is not set`: run from a login shell or export the key.
- Pexels has no matching source: simplify the query or change its orientation.
- yt-dlp fails: update yt-dlp or place an audio file locally and use `musicFile`/`--music-file`.
- FFmpeg transition fails: verify all generated segments share dimensions, frame rate, pixel format, and timebase.
- Output is shorter than requested: inspect shot durations and transition overlap in `storyboard.json`.
- Poor crop: adjust `anchorX` and `anchorY` in the query definition, from `0` to `1`.
