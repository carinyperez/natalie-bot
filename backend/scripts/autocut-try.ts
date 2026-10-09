/**
 * Try AutoCut's Analyze and Render on a local video, with a hand-written plan instead of Claude's.
 * Usage: npm run autocut:try -- <video> <start-end[@cropCenterX],start-end[@cropCenterX],...>
 * Example: npm run autocut:try -- ~/Movies/match.mov 12-18,40.5-47@0.3
 */
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { EditSegment } from '@shared/api';
import { analyze } from '../src/autocut/analyze';
import { probeVideo } from '../src/autocut/probe';
import { render } from '../src/autocut/render';

function parsePlan(spec: string): EditSegment[] {
  return spec.split(',').map((part) => {
    const match = /^\s*([\d.]+)-([\d.]+)(?:@([\d.]+))?\s*$/.exec(part);
    if (!match) throw new Error(`Bad segment "${part}": expected start-end or start-end@cropCenterX, in seconds.`);
    return { startSeconds: Number(match[1]), endSeconds: Number(match[2]), cropCenterX: match[3] ? Number(match[3]) : 0.5 };
  });
}

async function main(): Promise<void> {
  const [video, planSpec] = process.argv.slice(2);
  if (!video || !planSpec) {
    console.error('Usage: npm run autocut:try -- <video> <start-end[@cropCenterX],...>');
    process.exit(2);
  }
  const segments = parsePlan(planSpec);
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'autocut-'));

  let started = Date.now();
  const analysis = await analyze(video, workDir);
  console.log(`Analyzed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(`  ${analysis.durationSeconds.toFixed(2)} s, ${analysis.width}x${analysis.height}`);
  console.log(`  ${analysis.sheets.length} contact sheet(s) in ${workDir}`);
  console.log(`  scene cuts (s): ${analysis.sceneCuts.join(', ') || 'none'}`);
  console.log(`  loudest seconds: ${analysis.loudPeaks.slice(0, 5).map((p) => `${p.second}s (${p.lufs} LUFS)`).join(', ') || 'no audio'}`);
  console.log(`  full analysis: ${path.join(workDir, 'analysis.json')}`);

  started = Date.now();
  const outputPath = path.join(workDir, 'reel.mp4');
  await render(video, segments, outputPath, workDir);
  const reel = await probeVideo(outputPath);
  console.log(`Rendered ${segments.length} segment(s) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(`  ${reel.durationSeconds.toFixed(2)} s, ${reel.width}x${reel.height}, ${reel.hasAudio ? 'with' : 'no'} audio`);
  console.log(outputPath);
}

main().catch((err: unknown) => {
  const code = (err as { code?: string }).code;
  console.error(code ? `${code}: ${(err as Error).message}` : err);
  process.exit(1);
});
