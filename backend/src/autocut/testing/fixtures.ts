import { existsSync } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execBinary } from '../exec';
import { ffmpegPath } from '../ffmpeg-paths';

/**
 * Test videos generated with ffmpeg itself, so no binaries are committed. Cached in the OS temp dir by name;
 * bump FIXTURE_VERSION when a recipe changes.
 */
const FIXTURE_VERSION = 1;
export const FIXTURE_DIR = path.join(os.tmpdir(), `natalie-bot-autocut-fixtures-v${FIXTURE_VERSION}`);

/** Where the main fixture's known events are. */
export const FIXTURE = {
  durationSeconds: 20,
  width: 1920,
  height: 1080,
  hardCutAt: 10,
  loudBurst: { from: 14, to: 15 },
};

// A moving test pattern for 10 s, a hard cut to static colour bars, and a quiet 440 Hz tone with a loud second at 14 s.
const MAIN_PICTURE = [
  '-f', 'lavfi', '-i', `testsrc2=size=1920x1080:rate=30:duration=${FIXTURE.hardCutAt}`,
  '-f', 'lavfi', '-i', `smptehdbars=size=1920x1080:rate=30:duration=${FIXTURE.durationSeconds - FIXTURE.hardCutAt}`,
];
const MAIN_ARGS = [
  ...MAIN_PICTURE,
  '-f', 'lavfi', '-i',
  `aevalsrc='if(between(t\\,${FIXTURE.loudBurst.from}\\,${FIXTURE.loudBurst.to})\\,0.9\\,0.03)*sin(2*PI*440*t)':s=48000:d=${FIXTURE.durationSeconds}`,
  '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
  '-map', '[v]', '-map', '2:a',
];

const RECIPES = {
  /** 20 s 1920x1080 H.264 + AAC with a hard cut at 10 s and a loud burst at 14-15 s. */
  'main.mp4': MAIN_ARGS,
  /** The same picture with no audio track. */
  'silent.mp4': [...MAIN_PICTURE,'-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]'],
  /** 1080x1920 portrait, 6 s: already 9:16. */
  'portrait.mp4': ['-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6'],
  /** 720x1600 (9:20), 4 s: narrower than 9:16, like a phone screen recording. */
  'narrow.mp4': ['-f', 'lavfi', '-i', 'testsrc2=size=720x1600:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4'],
  /** 301 s at 64x64 and 1 fps: just over MAX_VIDEO_SECONDS, but tiny and quick to make. */
  'too-long.mp4': ['-f', 'lavfi', '-i', 'color=c=black:size=64x64:rate=1:duration=301'],
} satisfies Record<string, string[]>;

export type FixtureName = keyof typeof RECIPES;

/** Path to the named fixture, generating it on first use. Safe to call from parallel Jest workers. */
export async function fixturePath(name: FixtureName, dir = FIXTURE_DIR): Promise<string> {
  const target = path.join(dir, name);
  if (existsSync(target)) return target;
  await mkdir(dir, { recursive: true });
  const partial = path.join(dir, `.${process.pid}-${Date.now()}-${name}`);
  await execBinary(ffmpegPath(), [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    ...RECIPES[name],
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '35', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k',
    '-f', 'mp4', partial,
  ]);
  // rename is atomic, so another worker never sees a half-written file.
  await rename(partial, target);
  return target;
}
