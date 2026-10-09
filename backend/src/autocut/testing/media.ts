import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execBinary } from '../exec';
import { ffmpegPath, ffprobePath } from '../ffmpeg-paths';

export type StreamInfo = { codec_type: string; codec_name: string; width?: number; height?: number; duration?: string };

/** Every stream in a media file, as ffprobe reports it. */
export async function probeStreams(file: string): Promise<StreamInfo[]> {
  const { stdout } = await execBinary(ffprobePath(), ['-v', 'error', '-print_format', 'json', '-show_streams', file]);
  return (JSON.parse(stdout) as { streams: StreamInfo[] }).streams;
}

/** The RGB value of one pixel of the first frame at or after `atSeconds` (0 for an image). */
export async function pixelAt(
  file: string,
  x: number,
  y: number,
  workDir: string,
  atSeconds = 0,
): Promise<{ r: number; g: number; b: number }> {
  const out = `pixel-${x}-${y}-${Date.now()}.rgb`;
  await execBinary(
    ffmpegPath(),
    [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      ...(atSeconds > 0 ? ['-ss', String(atSeconds)] : []),
      '-i', file,
      '-vf', `format=rgb24,crop=1:1:${x}:${y}`,
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', out,
    ],
    { cwd: workDir },
  );
  const [r, g, b] = await readFile(path.join(workDir, out));
  return { r, g, b };
}

/** Top-level MP4 box types in file order (ftyp, moov, mdat, ...). */
export async function mp4TopLevelBoxes(file: string): Promise<string[]> {
  const data = await readFile(file);
  const boxes: string[] = [];
  let offset = 0;
  while (offset + 8 <= data.length) {
    let size = data.readUInt32BE(offset);
    const type = data.toString('latin1', offset + 4, offset + 8);
    if (size === 1) size = Number(data.readBigUInt64BE(offset + 8));
    else if (size === 0) size = data.length - offset;
    boxes.push(type);
    if (size < 8) break;
    offset += size;
  }
  return boxes;
}
