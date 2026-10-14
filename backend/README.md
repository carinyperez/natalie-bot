# Natalie Bot backend

## Try AutoCut locally

Analyze and Render (`src/autocut/`) run on local files with the ffmpeg/ffprobe from the `ffmpeg-static` and `ffprobe-static` devDependencies, so nothing needs installing beyond `npm ci`. Set `FFMPEG_PATH` / `FFPROBE_PATH` to use other binaries.

```bash
npm run autocut:try -- ~/Movies/match.mov                        # Claude plans it, default prompt "AutoCut"
npm run autocut:try -- ~/Movies/match.mov "just the takedowns"   # Claude plans it from your prompt
npm run autocut:try -- ~/Movies/match.mov 12-18,40.5-47@0.3      # hand-written plan, no Claude call
```

- **With a prompt (or nothing):** the Plan step sends the contact sheets, the loud moments, the scene cuts and your prompt to Claude (`src/autocut/plan.ts`), checks the plan it gets back, and renders it. This calls Claude, which costs money (roughly 5–25 cents a plan). There are two ways to reach it:
    - **Amazon Bedrock** (what the app uses): set `AWS_REGION` and AWS credentials (`AWS_PROFILE`, or a Bedrock API key in `AWS_BEARER_TOKEN_BEDROCK`) for an account with Claude Opus 5.5 and Claude Opus 4.8 (the refusal fallback) enabled in Bedrock.
    - **Anthropic's API** (quickest for a local try): set `ANTHROPIC_API_KEY`. When it is set, the script uses it instead of Bedrock. It prints the plan, Claude's one-line summary and the tokens used.
- **With segments:** comma-separated `start-end` in seconds, each optionally `@cropCenterX` (0 = left edge, 1 = right edge, default 0.5). No API call.

Either way it prints an analysis summary, leaves the contact sheets and `analysis.json` in a temp directory, and prints the path of the rendered 1080x1920 reel.

`npm run autocut:fixtures` generates the test videos the Jest tests use (into the OS temp dir).
