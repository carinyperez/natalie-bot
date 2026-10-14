import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Job } from '@shared/api';
import type { Analysis } from './analyze';
import { runJob, type JobStorage } from './orchestrate';
import type { PlanClient } from './plan';
import { fixturePath } from './testing/fixtures';
import { probeStreams } from './testing/media';

// Real Analyze and Render (ffmpeg) on the 20 s fixture; only Claude is a stand-in, returning a fixed plan.
jest.setTimeout(60_000);

/** A fake Claude that answers each call with the next plan. */
function scriptedClaude(plans: object[]) {
  const sent: unknown[] = [];
  const create = jest.fn(async (params: unknown) => {
    sent.push(params);
    const next = plans[sent.length - 1];
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(next) }], usage: { input_tokens: 1, output_tokens: 1 } };
  });
  return { client: { beta: { messages: { create } } } as unknown as PlanClient, sent };
}

/** JobStorage on local disk and memory: the shape the local backend will use. */
async function diskStorage(video: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'autocut-orchestrate-test-'));
  const jobs = new Map<string, Job>();
  const analyses = new Map<string, Analysis>();
  const stages: string[] = [];
  const storage: JobStorage = {
    getJob: async (id) => structuredClone(jobs.get(id) ?? null),
    updateJob: async (id, changes) => {
      if (changes.stage) stages.push(`${id}:${changes.stage}`);
      Object.assign(jobs.get(id)!, changes);
    },
    videoPath: async () => video,
    workDir: async (id) => {
      const dir = path.join(root, id);
      await mkdir(dir, { recursive: true });
      return dir;
    },
    saveAnalysis: async (id, a) => void analyses.set(id, a),
    loadAnalysis: async (id) => analyses.get(id) ?? null,
    publishReel: async (_id, localPath) => ({ url: `file://${localPath}`, urlExpiresAt: '2099-01-01T00:00:00.000Z' }),
  };
  const add = (job: Partial<Job> & { id: string }) =>
    jobs.set(job.id, {
      status: 'processing', stage: null, prompt: 'AutoCut', refinesJobId: null, message: null, plan: null,
      output: null, error: null, createdAt: '2026-10-14T10:00:00.000Z', updatedAt: '2026-10-14T10:00:00.000Z', ...job,
    });
  return { storage, add, stages };
}

const seg = (startSeconds: number, endSeconds: number) => ({ startSeconds, endSeconds, cropCenterX: 0.5 });

it('turns the fixture into a reel, then refines it from the saved analysis', async () => {
  const { storage, add, stages } = await diskStorage(await fixturePath('main.mp4'));
  const claude = scriptedClaude([
    { segments: [seg(2, 8), seg(11, 17)], message: 'Kept both halves, 12 s.' },
    { segments: [seg(2, 7), seg(11, 16)], message: 'Trimmed each half, 10 s.' },
  ]);
  const deps = { storage, planner: { client: claude.client, provider: 'bedrock' as const }, log: { info() {}, error() {} } };

  add({ id: 'job-1' });
  const first = await runJob('job-1', deps);
  expect(first).toMatchObject({ status: 'succeeded', message: 'Kept both halves, 12 s.', plan: { totalSeconds: 12 } });
  const [video, audio] = await probeStreams(first.output!.url.replace('file://', ''));
  expect(video).toMatchObject({ codec_type: 'video', width: 1080, height: 1920 });
  expect(audio.codec_type).toBe('audio');
  expect(first.output!.durationSeconds).toBeCloseTo(12, 0);

  add({ id: 'job-2', prompt: 'shorter', refinesJobId: 'job-1' });
  const second = await runJob('job-2', deps);
  expect(second).toMatchObject({ status: 'succeeded', plan: { totalSeconds: 10 } });
  expect(second.output!.durationSeconds).toBeCloseTo(10, 0);

  // The refine skipped Analyze, and Claude was shown the first plan to adjust.
  expect(stages).toEqual(['job-1:analyzing', 'job-1:planning', 'job-1:rendering', 'job-2:planning', 'job-2:rendering']);
  expect(JSON.stringify(claude.sent[1])).toContain('Kept both halves, 12 s.');
});
