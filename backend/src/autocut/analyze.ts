import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MAX_VIDEO_SECONDS } from '@shared/api';
import { AutocutError } from './errors';
import { execBinary } from './exec';
import { ffmpegPath } from './ffmpeg-paths';
import { probeVideo } from './probe';

/** What Analyze measures about a video, for the planner (Claude) to read. */
export type Analysis = {
  durationSeconds: number;
  width: number;
  height: number;
  /**
   * JPEG contact sheets: one frame per second, 4x4 per sheet, read left to right, top to bottom. Tile k of a sheet
   * is the frame at second startSeconds + k. Frames carry no drawn timestamp (the Linux ffmpeg build has no
   * drawtext, and Lambda has no fonts), so the planner is told each sheet's seconds in text instead.
   */
  sheets: { path: string; startSeconds: number; endSeconds: number }[];
  /** loudness[s] = loudest EBU R128 momentary loudness (LUFS) measured during second s. */
  loudness: number[];
  /** The loudest seconds, loudest first, at least PEAK_MIN_GAP_SECONDS apart. */
  loudPeaks: { second: number; lufs: number }[];
  /** Times (seconds) where the picture changes abruptly: hard cuts, camera switches. */
  sceneCuts: number[];
};

export const SHEET_COLUMNS = 4;
export const SHEET_ROWS = 4;
export const SECONDS_PER_SHEET = SHEET_COLUMNS * SHEET_ROWS; // at 1 frame per second
export const FRAME_WIDTH = 384;
export const TILE_PADDING = 4;

/**
 * ffmpeg's scene score is the normalised mean difference between consecutive frames (0..1). Hard cuts score
 * 0.4-1.0; pans, zooms and fast play in sports footage mostly stay under 0.2. 0.3 catches cuts between similar-looking
 * shots (same field, other camera) without flagging ordinary motion.
 */
export const SCENE_THRESHOLD = 0.3;
/** Cuts closer than this to the previous one are the same cut (a flash or a dissolve scoring on several frames). */
const SCENE_MIN_GAP_SECONDS = 0.5;

/** Below the EBU R128 absolute gate: treated as silence, and never a peak. */
export const SILENCE_LUFS = -70;
const MAX_PEAKS = 10;
const PEAK_MIN_GAP_SECONDS = 2;

const LOUDNESS_FILE = 'loudness.txt';
const SCENES_FILE = 'scenes.txt';
const SHEET_PATTERN = 'sheet-%03d.jpg';

/**
 * Measures `inputPath` in one ffmpeg pass and writes the contact sheets and analysis.json into `workDir`.
 * Throws AutocutError 'video_too_long' (over MAX_VIDEO_SECONDS) or 'unsupported_format' (undecodable).
 */
export async function analyze(inputPath: string, workDir: string): Promise<Analysis> {
  const input = path.resolve(inputPath);
  const dir = path.resolve(workDir);
  const info = await probeVideo(input);
  if (info.durationSeconds > MAX_VIDEO_SECONDS) {
    throw new AutocutError(
      'video_too_long',
      `The video is ${Math.round(info.durationSeconds)} s long; the limit is ${MAX_VIDEO_SECONDS} s.`,
    );
  }
  await mkdir(dir, { recursive: true });
  // Sheets from an earlier run in the same workDir would otherwise be listed as this video's.
  for (const stale of (await readdir(dir)).filter(isSheetFile)) await rm(path.join(dir, stale));

  // ffmpeg runs with cwd = workDir, so every file it writes is a bare name: no paths inside the filtergraph to escape.
  const graph = [
    '[0:v]setpts=PTS-STARTPTS,split=2[forsheets][forscenes]',
    `[forsheets]fps=1:round=down,scale=${FRAME_WIDTH}:-2,setsar=1,` +
      `tile=${SHEET_COLUMNS}x${SHEET_ROWS}:padding=${TILE_PADDING}:color=white[sheets]`,
    // Scene scores barely change with resolution, so score small frames: much less work on 1080p/4K input.
    `[forscenes]scale=192:-2,select='gt(scene\\,${SCENE_THRESHOLD})',metadata=mode=print:file=${SCENES_FILE}[scenes]`,
  ];
  const outputs = ['-map', '[sheets]', '-fps_mode', 'passthrough', '-q:v', '3', SHEET_PATTERN, '-map', '[scenes]', '-f', 'null', '-'];
  if (info.hasAudio) {
    // ebur128 emits a frame every 100 ms carrying the momentary loudness (400 ms window) in its metadata.
    graph.push(
      `[0:a]asetpts=PTS-STARTPTS,ebur128=metadata=1,ametadata=mode=print:key=lavfi.r128.M:file=${LOUDNESS_FILE}[loud]`,
    );
    outputs.push('-map', '[loud]', '-f', 'null', '-');
  }

  try {
    await execBinary(
      ffmpegPath(),
      ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input, '-filter_complex', graph.join(';'), ...outputs],
      { cwd: dir },
    );
  } catch (err) {
    // ffprobe accepted the container but the streams would not decode.
    throw new AutocutError('unsupported_format', 'The video could not be decoded.', { cause: err });
  }

  const sheetFiles = (await readdir(dir)).filter(isSheetFile).sort();
  const sheets = sheetFiles.map((file, i) => ({
    path: path.join(dir, file),
    startSeconds: i * SECONDS_PER_SHEET,
    endSeconds: Math.min((i + 1) * SECONDS_PER_SHEET, info.durationSeconds),
  }));

  const loudness = info.hasAudio
    ? loudnessPerSecond(await readFile(path.join(dir, LOUDNESS_FILE), 'utf8'), info.durationSeconds)
    : [];
  const analysis: Analysis = {
    durationSeconds: info.durationSeconds,
    width: info.width,
    height: info.height,
    sheets,
    loudness,
    loudPeaks: pickLoudPeaks(loudness),
    sceneCuts: sceneCutTimes(await readFile(path.join(dir, SCENES_FILE), 'utf8')),
  };
  await writeFile(path.join(dir, 'analysis.json'), JSON.stringify(analysis, null, 2));
  return analysis;
}

function isSheetFile(name: string): boolean {
  return /^sheet-\d{3}\.jpg$/.test(name);
}

/** Pairs of (pts_time, value) from a metadata=mode=print file: a `pts_time:` line, then `key=value` lines. */
export function parseMetadataPrint(text: string, key: string): { time: number; value: number }[] {
  const points: { time: number; value: number }[] = [];
  let time = NaN;
  for (const line of text.split('\n')) {
    const ptsMatch = /pts_time:(-?[\d.]+)/.exec(line);
    if (ptsMatch) {
      time = Number(ptsMatch[1]);
      continue;
    }
    if (line.startsWith(`${key}=`) && Number.isFinite(time)) {
      const value = Number(line.slice(key.length + 1));
      if (Number.isFinite(value)) points.push({ time, value });
    }
  }
  return points;
}

/** One value per second of video: the loudest momentary reading in that second, floored at SILENCE_LUFS. */
export function loudnessPerSecond(text: string, durationSeconds: number): number[] {
  const seconds = Math.ceil(durationSeconds - 1e-6);
  const perSecond = new Array<number>(seconds).fill(SILENCE_LUFS);
  for (const { time, value } of parseMetadataPrint(text, 'lavfi.r128.M')) {
    const s = Math.floor(time);
    if (s >= 0 && s < seconds) perSecond[s] = Math.max(perSecond[s], value);
  }
  return perSecond.map((v) => Math.round(v * 10) / 10);
}

/** Greedy: loudest second first, skipping any second within PEAK_MIN_GAP_SECONDS of one already picked. */
export function pickLoudPeaks(loudness: number[]): { second: number; lufs: number }[] {
  const candidates = loudness
    .map((lufs, second) => ({ second, lufs }))
    .filter((p) => p.lufs > SILENCE_LUFS)
    .sort((a, b) => b.lufs - a.lufs || a.second - b.second);
  const peaks: { second: number; lufs: number }[] = [];
  for (const candidate of candidates) {
    if (peaks.length >= MAX_PEAKS) break;
    if (peaks.every((p) => Math.abs(p.second - candidate.second) >= PEAK_MIN_GAP_SECONDS)) peaks.push(candidate);
  }
  return peaks;
}

/** Scene-cut times from the select/metadata output, merging cuts closer than SCENE_MIN_GAP_SECONDS. */
export function sceneCutTimes(text: string): number[] {
  const cuts: number[] = [];
  for (const { time } of parseMetadataPrint(text, 'lavfi.scene_score')) {
    const last = cuts[cuts.length - 1];
    if (last === undefined || time - last >= SCENE_MIN_GAP_SECONDS) cuts.push(Math.round(time * 100) / 100);
  }
  return cuts;
}
