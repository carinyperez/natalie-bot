# Natalie Bot backend

## Try AutoCut locally

Analyze and Render (`src/autocut/`) run on local files with the ffmpeg/ffprobe from the `ffmpeg-static` and `ffprobe-static` devDependencies, so nothing needs installing beyond `npm ci`. Set `FFMPEG_PATH` / `FFPROBE_PATH` to use other binaries.

```bash
npm run autocut:try -- ~/Movies/match.mov 12-18,40.5-47@0.3
```

The second argument is a hand-written plan: comma-separated `start-end` segments in seconds, each optionally `@cropCenterX` (0 = left edge, 1 = right edge, default 0.5). It prints an analysis summary, leaves the contact sheets and `analysis.json` in a temp directory, and prints the path of the rendered 1080x1920 reel.

`npm run autocut:fixtures` generates the test videos the Jest tests use (into the OS temp dir).
