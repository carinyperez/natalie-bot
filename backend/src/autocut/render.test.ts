import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { EditSegment } from '@shared/api';
import { analyze } from './analyze';
import { cropWindow, render, validateSegments } from './render';
import { FIXTURE, fixturePath } from './testing/fixtures';
import { mp4TopLevelBoxes, pixelAt, probeStreams } from './testing/media';

// These run the real ffmpeg on generated videos.
jest.setTimeout(60_000);

const newWorkDir = () => mkdtemp(path.join(os.tmpdir(), 'autocut-render-test-'));
const seg = (startSeconds: number, endSeconds: number, cropCenterX = 0.5): EditSegment => ({
  startSeconds,
  endSeconds,
  cropCenterX,
});

async function renderFixture(name: Parameters<typeof fixturePath>[0], segments: EditSegment[]) {
  const workDir = await newWorkDir();
  const outputPath = path.join(workDir, 'reel.mp4');
  const result = await render(await fixturePath(name), segments, outputPath, workDir);
  return { workDir, outputPath, result, streams: await probeStreams(outputPath) };
}

describe('render a 2-segment plan', () => {
  // 5 s of colour bars spanning the loud burst, then 4 s of the moving pattern: not in source order.
  const plan = [seg(12, 17), seg(2, 6)];
  let out: Awaited<ReturnType<typeof renderFixture>>;

  beforeAll(async () => {
    out = await renderFixture('main.mp4', plan);
  });

  it('outputs 1080x1920 H.264 with AAC audio', () => {
    const video = out.streams.find((s) => s.codec_type === 'video');
    const audio = out.streams.find((s) => s.codec_type === 'audio');
    expect(video).toMatchObject({ codec_name: 'h264', width: 1080, height: 1920 });
    expect(audio).toMatchObject({ codec_name: 'aac' });
  });

  it('lasts the sum of the segments, with audio as long as the video', () => {
    expect(Math.abs(out.result.durationSeconds - 9)).toBeLessThanOrEqual(0.3);
    const [video, audio] = ['video', 'audio'].map((t) => Number(out.streams.find((s) => s.codec_type === t)?.duration));
    expect(Math.abs(video - audio)).toBeLessThanOrEqual(0.05);
  });

  it('puts the moov box before mdat (faststart)', async () => {
    const boxes = await mp4TopLevelBoxes(out.outputPath);
    expect(boxes).toContain('moov');
    expect(boxes.indexOf('moov')).toBeLessThan(boxes.indexOf('mdat'));
  });

  it("keeps the source's audio, in sync: the loud second lands 2 s into the reel", async () => {
    // Source 14-15 s is loud; the reel starts at source 12 s.
    const { loudness } = await analyze(out.outputPath, out.workDir);
    expect(loudness[2]).toBeGreaterThan(-15);
    for (const quiet of [0, 4, 6, 8]) expect(loudness[quiet]).toBeLessThan(-25);
  });
});

describe('crop', () => {
  it('centres a 9:16 full-height window on cropCenterX', () => {
    expect(cropWindow(1920, 1080, 0.5)).toEqual({ x: 656, y: 0, width: 606, height: 1080 });
  });

  it('clamps the window inside the frame at either edge', () => {
    expect(cropWindow(1920, 1080, 0)).toEqual({ x: 0, y: 0, width: 606, height: 1080 });
    expect(cropWindow(1920, 1080, 0.05)).toEqual({ x: 0, y: 0, width: 606, height: 1080 });
    expect(cropWindow(1920, 1080, 1)).toEqual({ x: 1314, y: 0, width: 606, height: 1080 });
    expect(cropWindow(1920, 1080, 0.97)).toEqual({ x: 1314, y: 0, width: 606, height: 1080 });
  });

  it('does not crop a source that is already 9:16 or narrower', () => {
    expect(cropWindow(1080, 1920, 0.5)).toBeNull();
    expect(cropWindow(720, 1600, 0.2)).toBeNull();
  });

  it('shows the left edge of the source at cropCenterX 0 and the right edge at 1', async () => {
    // The fixture's first 10 s are colour bars: red at the far left, cyan at the far right.
    const left = await renderFixture('main.mp4', [seg(1, 2, 0)]);
    const right = await renderFixture('main.mp4', [seg(1, 2, 1)]);
    const l = await pixelAt(left.outputPath, 60, 1000, left.workDir, 0.5);
    const r = await pixelAt(right.outputPath, 1020, 1000, right.workDir, 0.5);
    expect([l.r > 200, l.g < 60, l.b < 60]).toEqual([true, true, true]); // red
    expect([r.r < 60, r.g > 200, r.b > 200]).toEqual([true, true, true]); // cyan
    for (const out of [left, right]) {
      expect(out.streams.find((s) => s.codec_type === 'video')).toMatchObject({ width: 1080, height: 1920 });
    }
  });

  it('passes a 9:16 source through full-frame, with no bars', async () => {
    const out = await renderFixture('portrait.mp4', [seg(0, 2)]);
    expect(out.streams.find((s) => s.codec_type === 'video')).toMatchObject({ width: 1080, height: 1920 });
    const edge = await pixelAt(out.outputPath, 20, 960, out.workDir, 0.5);
    expect(Math.max(edge.r, edge.g, edge.b)).toBeGreaterThan(200); // the pattern's red bar, not black
  });

  it('fits a narrower-than-9:16 source with black side bars', async () => {
    const out = await renderFixture('narrow.mp4', [seg(0, 2)]);
    expect(out.streams.find((s) => s.codec_type === 'video')).toMatchObject({ width: 1080, height: 1920 });
    const edge = await pixelAt(out.outputPath, 20, 960, out.workDir, 0.5);
    expect(Math.max(edge.r, edge.g, edge.b)).toBeLessThan(30);
  });
});

describe('render edge cases', () => {
  it('adds a silent audio track when the source has none', async () => {
    const out = await renderFixture('silent.mp4', [seg(1, 3), seg(11, 13)]);
    expect(out.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
    expect(Math.abs(out.result.durationSeconds - 4)).toBeLessThanOrEqual(0.3);
  });

  it('renders a segment that runs to the very end of the video', async () => {
    const out = await renderFixture('main.mp4', [seg(FIXTURE.durationSeconds - 2, FIXTURE.durationSeconds), seg(3, 4)]);
    expect(Math.abs(out.result.durationSeconds - 3)).toBeLessThanOrEqual(0.3);
  });
});

describe('invalid plans', () => {
  const cases: [string, EditSegment[]][] = [
    ['no segments', []],
    ['a segment past the end', [seg(18, 21)]],
    ['a negative start', [seg(-1, 3)]],
    ['overlapping segments', [seg(2, 6), seg(5, 8)]],
    ['overlapping segments out of order', [seg(10, 14), seg(2, 11)]],
    ['end before start', [seg(6, 2)]],
    ['a too-short segment', [seg(2, 2.2)]],
    ['cropCenterX outside 0..1', [seg(2, 6, 1.5)]],
    ['a NaN field', [seg(2, Number.NaN)]],
  ];

  it.each(cases)('rejects %s with invalid_plan', (_, segments) => {
    expect(() => validateSegments(segments, FIXTURE.durationSeconds)).toThrow(
      expect.objectContaining({ name: 'AutocutError', code: 'invalid_plan' }),
    );
  });

  it('accepts touching, non-overlapping segments', () => {
    expect(() => validateSegments([seg(2, 6), seg(6, 8)], FIXTURE.durationSeconds)).not.toThrow();
  });

  it('render() rejects an invalid plan before running ffmpeg', async () => {
    const workDir = await newWorkDir();
    await expect(
      render(await fixturePath('main.mp4'), [seg(15, 25)], path.join(workDir, 'reel.mp4'), workDir),
    ).rejects.toMatchObject({ code: 'invalid_plan' });
  });
});
