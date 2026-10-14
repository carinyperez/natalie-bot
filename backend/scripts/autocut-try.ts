/**
 * Try AutoCut on a local video: Analyze, then a plan, then Render.
 * The plan comes from Claude when the second argument is a prompt, or is hand-written when it is a list of segments.
 * Usage: npm run autocut:try -- <video> [prompt | start-end[@cropCenterX],...]
 * Examples:
 *   npm run autocut:try -- ~/Movies/match.mov                       (Claude, default prompt "AutoCut")
 *   npm run autocut:try -- ~/Movies/match.mov "just the takedowns"  (Claude, your prompt)
 *   npm run autocut:try -- ~/Movies/match.mov 12-18,40.5-47@0.3     (no Claude call)
 */
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PROMPT, type EditSegment } from '@shared/api';
import { analyze } from '../src/autocut/analyze';
import { probeVideo } from '../src/autocut/probe';
import { planEdit } from '../src/autocut/plan';
import { createPlanClient } from '../src/autocut/plan-client';
import { render } from '../src/autocut/render';

/** A hand-written plan is only digits, dots, dashes, @ and commas; anything else is a prompt for Claude. */
const isSegmentList = (arg: string) => /^[\d.\-@,\s]+$/.test(arg);

function parsePlan(spec: string): EditSegment[] {
  return spec.split(',').map((part) => {
    const match = /^\s*([\d.]+)-([\d.]+)(?:@([\d.]+))?\s*$/.exec(part);
    if (!match) throw new Error(`Bad segment "${part}": expected start-end or start-end@cropCenterX, in seconds.`);
    return { startSeconds: Number(match[1]), endSeconds: Number(match[2]), cropCenterX: match[3] ? Number(match[3]) : 0.5 };
  });
}

async function main(): Promise<void> {
  const [video, planArg = DEFAULT_PROMPT] = process.argv.slice(2);
  if (!video) {
    console.error('Usage: npm run autocut:try -- <video> [prompt | start-end[@cropCenterX],...]');
    process.exit(2);
  }
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'autocut-'));

  let started = Date.now();
  const analysis = await analyze(video, workDir);
  console.log(`Analyzed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(`  ${analysis.durationSeconds.toFixed(2)} s, ${analysis.width}x${analysis.height}`);
  console.log(`  ${analysis.sheets.length} contact sheet(s) in ${workDir}`);
  console.log(`  scene cuts (s): ${analysis.sceneCuts.join(', ') || 'none'}`);
  console.log(`  loudest seconds: ${analysis.loudPeaks.slice(0, 5).map((p) => `${p.second}s (${p.lufs} LUFS)`).join(', ') || 'no audio'}`);
  console.log(`  full analysis: ${path.join(workDir, 'analysis.json')}`);

  let segments: EditSegment[];
  if (isSegmentList(planArg)) {
    segments = parsePlan(planArg);
  } else {
    started = Date.now();
    // The app reaches Claude through Amazon Bedrock (AWS credentials and AWS_REGION). With ANTHROPIC_API_KEY set,
    // this script calls Anthropic's API directly instead, which needs no AWS setup.
    const provider = process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'bedrock';
    console.log(`Planning with Claude through ${provider === 'anthropic' ? "Anthropic's API" : 'Amazon Bedrock'}...`);
    const plan = await planEdit(createPlanClient(provider), { analysis, prompt: planArg }, provider);
    segments = plan.segments;
    console.log(`Planned in ${((Date.now() - started) / 1000).toFixed(1)} s for "${planArg}"`);
    console.log(`  ${plan.message}`);
    for (const s of segments) console.log(`  ${s.startSeconds}-${s.endSeconds} s, cropCenterX ${s.cropCenterX}`);
    const { attempts, inputTokens, outputTokens } = plan.usage;
    console.log(`  ${attempts} Claude call(s), ${inputTokens} input and ${outputTokens} output tokens`);
  }

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
