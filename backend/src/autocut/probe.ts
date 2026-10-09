import { AutocutError } from './errors';
import { execBinary } from './exec';
import { ffprobePath } from './ffmpeg-paths';

export type VideoInfo = {
  durationSeconds: number;
  /** Display size: already swapped for a rotated (portrait phone) video, matching what ffmpeg decodes. */
  width: number;
  height: number;
  hasAudio: boolean;
};

type ProbeStream = {
  codec_type?: string;
  width?: number;
  height?: number;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
};

type ProbeOutput = { streams?: ProbeStream[]; format?: { duration?: string } };

/** Reads duration, display size and whether there is audio. Anything ffprobe cannot read is unsupported_format. */
export async function probeVideo(inputPath: string): Promise<VideoInfo> {
  let parsed: ProbeOutput;
  try {
    const { stdout } = await execBinary(ffprobePath(), [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      inputPath,
    ]);
    parsed = JSON.parse(stdout) as ProbeOutput;
  } catch (err) {
    throw new AutocutError('unsupported_format', 'The video could not be read.', { cause: err });
  }

  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const durationSeconds = Number(parsed.format?.duration);
  if (!video || !video.width || !video.height || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new AutocutError('unsupported_format', 'The file has no readable video stream.');
  }

  // Phones store portrait video as landscape plus a rotation; ffmpeg's decoder applies it (autorotate),
  // so every crop and scale downstream must use the rotated size.
  const rotation = Number(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0);
  const quarterTurn = Math.abs(Math.round(rotation / 90)) % 2 === 1;

  return {
    durationSeconds,
    width: quarterTurn ? video.height : video.width,
    height: quarterTurn ? video.width : video.height,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  };
}
