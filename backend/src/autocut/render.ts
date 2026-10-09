import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { EditSegment } from '@shared/api';
import { AutocutError } from './errors';
import { execBinary } from './exec';
import { ffmpegPath } from './ffmpeg-paths';
import { probeVideo } from './probe';

export const OUTPUT_WIDTH = 1080;
export const OUTPUT_HEIGHT = 1920;
export const OUTPUT_FPS = 30;
/** Audio overlap at each join, so cuts don't click. */
export const CROSSFADE_SECONDS = 0.1;
/** Shorter pieces are a planner mistake (and would be shorter than the crossfade's reach). */
export const MIN_SEGMENT_SECONDS = 0.5;

/** A 9:16 window of the source, in source pixels. */
export type CropWindow = { x: number; y: number; width: number; height: number };

/**
 * The full-height 9:16 window centred at cropCenterX x width, slid back inside the frame when it would overhang
 * an edge. Returns null when the source is not wider than 9:16 (portrait or taller): nothing to crop sideways.
 */
export function cropWindow(sourceWidth: number, sourceHeight: number, cropCenterX: number): CropWindow | null {
  if (sourceWidth * 16 <= sourceHeight * 9) return null;
  const width = Math.floor((sourceHeight * 9) / 16 / 2) * 2; // even, for yuv420p
  const centred = Math.round(cropCenterX * sourceWidth - width / 2);
  const x = Math.floor(clamp(centred, 0, sourceWidth - width) / 2) * 2;
  return { x, y: 0, width, height: sourceHeight };
}

/** Filters that turn one source frame into a 1080x1920 frame. */
function framingFilters(sourceWidth: number, sourceHeight: number, cropCenterX: number): string {
  const crop = cropWindow(sourceWidth, sourceHeight, cropCenterX);
  if (crop) {
    return `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},setsar=1`;
  }
  // Already 9:16, or narrower (e.g. a phone screen recording): fit the whole picture inside 1080x1920 and fill the
  // sides with black, rather than cutting off its top and bottom. cropCenterX has nothing to move here.
  return (
    `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
    `pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`
  );
}

/** Throws invalid_plan unless the segments can be rendered from a video of this length. */
export function validateSegments(segments: EditSegment[], durationSeconds: number): void {
  const fail = (message: string): never => {
    throw new AutocutError('invalid_plan', message);
  };
  if (!Array.isArray(segments) || segments.length === 0) fail('The plan has no segments.');
  segments.forEach((s, i) => {
    const label = `Segment ${i + 1}`;
    if (![s.startSeconds, s.endSeconds, s.cropCenterX].every(Number.isFinite)) fail(`${label} has a non-numeric field.`);
    if (s.startSeconds < 0) fail(`${label} starts before 0 s.`);
    if (s.endSeconds > durationSeconds + 1e-3) fail(`${label} ends after the video (${durationSeconds} s).`);
    if (s.endSeconds - s.startSeconds < MIN_SEGMENT_SECONDS) fail(`${label} is shorter than ${MIN_SEGMENT_SECONDS} s.`);
    if (s.cropCenterX < 0 || s.cropCenterX > 1) fail(`${label} has cropCenterX outside 0..1.`);
  });
  // Playback order is the plan's order; overlap is checked in source order.
  const bySource = [...segments].sort((a, b) => a.startSeconds - b.startSeconds);
  for (let i = 1; i < bySource.length; i++) {
    if (bySource[i].startSeconds < bySource[i - 1].endSeconds - 1e-3) fail('Two segments overlap.');
  }
}

/**
 * Cuts `segments` (in the given order) out of `inputPath` into a 1080x1920 H.264/AAC MP4 at `outputPath`,
 * with a short audio crossfade at each join. Returns the output's real duration.
 */
export async function render(
  inputPath: string,
  segments: EditSegment[],
  outputPath: string,
  workDir: string,
): Promise<{ durationSeconds: number }> {
  const input = path.resolve(inputPath);
  const output = path.resolve(outputPath);
  const info = await probeVideo(input);
  validateSegments(segments, info.durationSeconds);
  await mkdir(path.resolve(workDir), { recursive: true });
  await mkdir(path.dirname(output), { recursive: true });

  const inputs: string[] = [];
  const graph: string[] = [];
  const last = segments.length - 1;
  const totalSeconds = segments.reduce((sum, s) => sum + (s.endSeconds - s.startSeconds), 0);

  segments.forEach((segment, i) => {
    const length = segment.endSeconds - segment.startSeconds;
    // Every audio piece but the last runs CROSSFADE_SECONDS past its cut: the crossfade eats that overlap,
    // so the joined audio stays exactly as long as the joined video and in sync with it.
    const audioLength = i < last ? length + CROSSFADE_SECONDS : length;
    // One input per segment, seeked with -ss before -i: ffmpeg decodes only that range (from the nearest
    // keyframe, discarding frames before the exact start), instead of the whole video once per segment.
    inputs.push('-ss', seconds(segment.startSeconds), '-t', seconds(audioLength), '-i', input);
    graph.push(
      `[${i}:v]trim=duration=${seconds(length)},setpts=PTS-STARTPTS,` +
        `${framingFilters(info.width, info.height, segment.cropCenterX)},fps=${OUTPUT_FPS},format=yuv420p[v${i}]`,
    );
    if (info.hasAudio) {
      // apad + atrim: a piece that hits the end of the video still comes out at full length (silence padded).
      graph.push(
        `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS,` +
          `apad,atrim=duration=${seconds(audioLength)}[a${i}]`,
      );
    }
  });

  graph.push(`${segments.map((_, i) => `[v${i}]`).join('')}concat=n=${segments.length}:v=1:a=0[vout]`);
  if (info.hasAudio) {
    let previous = 'a0';
    for (let i = 1; i <= last; i++) {
      const next = i === last ? 'aout' : `x${i}`;
      graph.push(`[${previous}][a${i}]acrossfade=d=${CROSSFADE_SECONDS}:c1=tri:c2=tri[${next}]`);
      previous = next;
    }
    if (last === 0) graph.push('[a0]anull[aout]');
  } else {
    // No audio in the source: a silent track, so every reel plays the same way in every player.
    graph.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${seconds(totalSeconds)}[aout]`);
  }

  try {
    await execBinary(
      ffmpegPath(),
      [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        ...inputs,
        '-filter_complex', graph.join(';'),
        '-map', '[vout]', '-map', '[aout]',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        // moov atom at the front, so the app can start playing before the whole file has downloaded.
        '-movflags', '+faststart',
        output,
      ],
      { cwd: path.resolve(workDir) },
    );
  } catch (err) {
    throw new AutocutError('ffmpeg_failed', 'Rendering the reel failed.', { cause: err });
  }

  const rendered = await probeVideo(output);
  return { durationSeconds: rendered.durationSeconds };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Seconds as ffmpeg reads them, without float noise like 3.0000000000000004. */
function seconds(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}
