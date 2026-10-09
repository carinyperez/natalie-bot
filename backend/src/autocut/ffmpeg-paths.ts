/**
 * Where the ffmpeg and ffprobe binaries are. FFMPEG_PATH / FFPROBE_PATH win (the Lambda FFmpeg layer will set
 * them); otherwise the ffmpeg-static / ffprobe-static devDependencies, so local runs and CI need no system install.
 * The static packages are required lazily, so a bundle that sets the env vars never loads them.
 */

export function ffmpegPath(): string {
  const fromEnv = process.env.FFMPEG_PATH;
  if (fromEnv) return fromEnv;
  // ffmpeg-static exports the path, or null when it has no binary for this platform.
  const bundled = require('ffmpeg-static') as string | null;
  if (!bundled) throw new Error('No ffmpeg binary: set FFMPEG_PATH or install ffmpeg-static for this platform.');
  return bundled;
}

export function ffprobePath(): string {
  const fromEnv = process.env.FFPROBE_PATH;
  if (fromEnv) return fromEnv;
  const bundled = (require('ffprobe-static') as { path?: string }).path;
  if (!bundled) throw new Error('No ffprobe binary: set FFPROBE_PATH or install ffprobe-static for this platform.');
  return bundled;
}
