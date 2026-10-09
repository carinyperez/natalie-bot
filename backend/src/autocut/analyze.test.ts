import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyze, pickLoudPeaks, type Analysis } from './analyze';
import { FIXTURE, fixturePath } from './testing/fixtures';
import { pixelAt, probeStreams } from './testing/media';

// These run the real ffmpeg on generated videos.
jest.setTimeout(60_000);

const newWorkDir = () => mkdtemp(path.join(os.tmpdir(), 'autocut-analyze-test-'));

describe('analyze on the 20 s fixture (hard cut at 10 s, loud second at 14 s)', () => {
  let workDir: string;
  let analysis: Analysis;

  beforeAll(async () => {
    workDir = await newWorkDir();
    analysis = await analyze(await fixturePath('main.mp4'), workDir);
  });

  it('reads duration and size', () => {
    expect(analysis.durationSeconds).toBeCloseTo(FIXTURE.durationSeconds, 1);
    expect(analysis.width).toBe(FIXTURE.width);
    expect(analysis.height).toBe(FIXTURE.height);
  });

  it('makes one contact sheet per 16 s, the last one partial', () => {
    expect(analysis.sheets.map(({ startSeconds, endSeconds }) => [startSeconds, endSeconds])).toEqual([
      [0, 16],
      [16, 20],
    ]);
  });

  it('writes the sheets as JPEGs of 4x4 frames 384 px wide', async () => {
    for (const sheet of analysis.sheets) {
      const head = (await readFile(sheet.path)).subarray(0, 3);
      expect([...head]).toEqual([0xff, 0xd8, 0xff]);
      const [stream] = await probeStreams(sheet.path);
      expect(stream.codec_name).toBe('mjpeg');
      // 4 frames of 384x216 per row and column, with 4 px gaps.
      expect(stream.width).toBe(4 * 384 + 3 * 4);
      expect(stream.height).toBe(4 * 216 + 3 * 4);
    }
  });

  it('puts the frame at second k in tile k, row by row', async () => {
    // The fixture cuts from the test pattern (pure red bar top-left) to grey-edged colour bars at 10 s.
    // Tile 9 (row 2, column 1) is second 9; tile 10 (row 2, column 2) is second 10.
    const tile = (k: number) => ({ x: (k % 4) * (384 + 4) + 30, y: Math.floor(k / 4) * (216 + 4) + 22 });
    const isRed = ({ r, g }: { r: number; g: number }) => r > 200 && g < 60;
    const second9 = await pixelAt(analysis.sheets[0].path, tile(9).x, tile(9).y, workDir);
    const second10 = await pixelAt(analysis.sheets[0].path, tile(10).x, tile(10).y, workDir);
    expect(isRed(second9)).toBe(true);
    expect(isRed(second10)).toBe(false);
  });

  it('measures loudness once per second', () => {
    expect(analysis.loudness).toHaveLength(FIXTURE.durationSeconds);
    analysis.loudness.forEach((lufs) => expect(Number.isFinite(lufs)).toBe(true));
  });

  it('finds the loud burst as the top peak, with peaks at least 2 s apart', () => {
    expect(analysis.loudPeaks[0].second).toBe(FIXTURE.loudBurst.from);
    expect(analysis.loudPeaks[0].lufs).toBeGreaterThan(analysis.loudness[5] + 20);
    expect(analysis.loudPeaks.length).toBeLessThanOrEqual(10);
    for (const a of analysis.loudPeaks) {
      for (const b of analysis.loudPeaks) if (a !== b) expect(Math.abs(a.second - b.second)).toBeGreaterThanOrEqual(2);
    }
  });

  it('finds exactly the one hard cut, and nothing in the moving pattern', () => {
    expect(analysis.sceneCuts).toHaveLength(1);
    expect(analysis.sceneCuts[0]).toBeCloseTo(FIXTURE.hardCutAt, 0);
  });

  it('writes analysis.json next to the sheets', async () => {
    const saved = JSON.parse(await readFile(path.join(workDir, 'analysis.json'), 'utf8'));
    expect(saved).toEqual(analysis);
  });
});

describe('analyze edge cases', () => {
  it('returns empty loudness for a video with no audio track', async () => {
    const analysis = await analyze(await fixturePath('silent.mp4'), await newWorkDir());
    expect(analysis.loudness).toEqual([]);
    expect(analysis.loudPeaks).toEqual([]);
    expect(analysis.sheets).toHaveLength(2);
  });

  it('rejects a video over 5 minutes with video_too_long', async () => {
    await expect(analyze(await fixturePath('too-long.mp4'), await newWorkDir())).rejects.toMatchObject({
      name: 'AutocutError',
      code: 'video_too_long',
    });
  });

  it('rejects a file that is not a video with unsupported_format', async () => {
    const workDir = await newWorkDir();
    const garbage = path.join(workDir, 'garbage.mp4');
    await writeFile(garbage, Buffer.from(Array.from({ length: 64 * 1024 }, (_, i) => (i * 7919) % 256)));
    await expect(analyze(garbage, workDir)).rejects.toMatchObject({ code: 'unsupported_format' });
  });

  it('rejects a missing file with unsupported_format', async () => {
    const workDir = await newWorkDir();
    await expect(analyze(path.join(workDir, 'nope.mp4'), workDir)).rejects.toMatchObject({ code: 'unsupported_format' });
  });
});

describe('pickLoudPeaks', () => {
  it('keeps the loudest of neighbouring seconds and skips silence', () => {
    const loudness = [-30, -10, -12, -40, -9, -70, -70, -20];
    expect(pickLoudPeaks(loudness)).toEqual([
      { second: 4, lufs: -9 },
      { second: 1, lufs: -10 },
      { second: 7, lufs: -20 },
    ]);
  });

  it('returns at most 10 peaks', () => {
    expect(pickLoudPeaks(new Array(100).fill(-20))).toHaveLength(10);
  });
});
