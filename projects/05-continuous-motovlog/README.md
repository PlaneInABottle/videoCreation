# Continuous Motovlog Demo

This example is deliberately different from the Pexels motovlog montage. It uses one Creative Commons YouTube source, one rider, one bike, one route, one camera position, and the selected source audio.

Source: **“首都高 Triumph Scrambler 900 TOKYO EXPRESSWAY 4K RAW SOUND”** by **Moto Rider Doge**. YouTube metadata reports **Creative Commons Attribution license (reuse allowed)**. The exact source URL, section, format, hash, attribution, and full extractor metadata are preserved under `sources/`.

The edit uses hard cuts only. Native source-audio segments receive 12 ms edge fades to prevent digital clicks, then are concatenated and normalized as one 48 kHz stereo program. Music is intentionally omitted so this example tests continuity and authentic road/engine sound rather than music replacement.

Render:

```bash
npm run create -- --storyboard projects/05-continuous-motovlog/storyboard.json
```

Evaluate:

```bash
npm run evaluate -- --storyboard projects/05-continuous-motovlog/storyboard.json
```
