import path from 'node:path';
import { MAX_VIDEO_SECONDS, type Job, type JobErrorCode, type JobStage } from '@shared/api';
import { analyze, type Analysis } from './analyze';
import { AutocutError } from './errors';
import { planEdit, type EditPlan, type PlanClient, type PlanProvider } from './plan';
import { OUTPUT_HEIGHT, OUTPUT_WIDTH, render } from './render';

/**
 * Where a job's record and files live. The orchestrator only talks to this, so the same code runs on a Mac
 * (local disk and memory) and on AWS (the database and S3).
 */
export type JobStorage = {
  getJob(jobId: string): Promise<Job | null>;
  /**
   * Claims the right to run a job, atomically: true for exactly one caller until `until`, then a new claim may win.
   * On AWS this is a conditional database update; the S3 event that starts a run can be delivered more than once,
   * and a crashed run must not hold the job forever.
   */
  claimRun(jobId: string, until: Date): Promise<boolean>;
  /** Saves changes to a job. The orchestrator sets updatedAt itself. */
  updateJob(jobId: string, changes: Partial<Job>): Promise<void>;
  /** A local path to the video the job edits. For a refine, that is the original upload's video. */
  videoPath(job: Job): Promise<string>;
  /** A local scratch directory for this job: contact sheets, the reel before it is published. */
  workDir(jobId: string): Promise<string>;
  /** Keeps a job's analysis, so a refine of it can skip Analyze. */
  saveAnalysis(jobId: string, analysis: Analysis): Promise<void>;
  loadAnalysis(jobId: string): Promise<Analysis | null>;
  /** Makes the rendered reel reachable by the app; returns where, and until when. */
  publishReel(jobId: string, localPath: string): Promise<{ url: string; urlExpiresAt: string }>;
};

/** The Claude client the Plan step uses, and how it reaches Claude. */
export type Planner = { client: PlanClient; provider: PlanProvider };

/**
 * How long a claimed run holds a job. Longer than Lambda's 15-minute limit, so a claim only lapses once its run is
 * certainly over, letting a retry take over a run that crashed.
 */
export const RUN_LEASE_MS = 16 * 60 * 1000;

export type OrchestrateDeps = {
  storage: JobStorage;
  planner: Planner;
  now?: () => Date;
  log?: Pick<Console, 'info' | 'error'>;
};

/** What the app shows for each failure. The codes are part of the API contract. */
const FAILURE_MESSAGES: Record<JobErrorCode, string> = {
  upload_expired: 'The upload never arrived. Please try again.',
  video_too_long: `Videos must be ${MAX_VIDEO_SECONDS / 60} minutes or shorter.`,
  unsupported_format: "This video couldn't be read. Try a different file.",
  plan_failed: "Couldn't find a good cut. Try describing it differently.",
  processing_failed: 'Something went wrong making your reel. Please try again.',
};

/**
 * Runs one AutoCut job to the end: Analyze, then Plan, then Render, keeping the job's stage up to date so the app can
 * show progress. A refine (a job with refinesJobId) reuses the analysis of the job it refines and gives Claude that
 * job's plan to adjust. Every failure ends the job as 'failed' with a code and a message the app can show; only a
 * missing job throws. A job that is finished, or claimed by a run still in progress, is returned unchanged, so a
 * repeated trigger is harmless.
 */
export async function runJob(jobId: string, deps: OrchestrateDeps): Promise<Job> {
  const { storage, planner, now = () => new Date(), log = console } = deps;
  const job = await storage.getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found.`);
  if (job.status === 'succeeded' || job.status === 'failed') return job;
  if (!(await storage.claimRun(jobId, new Date(now().getTime() + RUN_LEASE_MS)))) {
    log.info(`Job ${jobId}: another run holds it; skipping this trigger.`);
    return job;
  }

  const update = async (changes: Partial<Job>) => {
    Object.assign(job, changes, { updatedAt: now().toISOString() });
    await storage.updateJob(jobId, { ...changes, updatedAt: job.updatedAt });
  };
  const enter = (stage: JobStage) => update({ status: 'processing', stage });

  try {
    const video = await storage.videoPath(job);
    const workDir = await storage.workDir(jobId);

    let analysis: Analysis | null = null;
    let previousPlan: EditPlan | undefined;
    if (job.refinesJobId) {
      const source = await storage.getJob(job.refinesJobId);
      if (!source || source.status !== 'succeeded' || !source.plan || !source.message) {
        throw new Error(`Job ${jobId} refines ${job.refinesJobId}, which has no finished plan.`);
      }
      previousPlan = { segments: source.plan.segments, message: source.message };
      analysis = await storage.loadAnalysis(job.refinesJobId);
    }
    if (!analysis) {
      // A new upload, or a refine whose source analysis was lost: measure the video.
      await enter('analyzing');
      analysis = await analyze(video, path.join(workDir, 'analysis'));
    }
    await storage.saveAnalysis(jobId, analysis);

    await enter('planning');
    const plan = await planEdit(planner.client, { analysis, prompt: job.prompt, previousPlan }, planner.provider);
    log.info(`Job ${jobId}: planned in ${plan.usage.attempts} call(s), ` +
      `${plan.usage.inputTokens} input and ${plan.usage.outputTokens} output tokens`);

    await enter('rendering');
    const reelPath = path.join(workDir, 'reel.mp4');
    const { durationSeconds } = await render(video, plan.segments, reelPath, path.join(workDir, 'render'));
    const published = await storage.publishReel(jobId, reelPath);

    const totalSeconds = plan.segments.reduce((sum, s) => sum + (s.endSeconds - s.startSeconds), 0);
    await update({
      status: 'succeeded',
      stage: null,
      message: plan.message,
      plan: { segments: plan.segments, totalSeconds: Math.round(totalSeconds * 10) / 10 },
      output: { ...published, durationSeconds, width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT },
      error: null,
    });
  } catch (err) {
    const code = failureCode(err);
    log.error(`Job ${jobId} failed (${code})`, err);
    await update({ status: 'failed', stage: null, output: null, error: { code, message: FAILURE_MESSAGES[code] } });
  }
  return job;
}

/** Maps a step's error to the code the app sees. Anything unexpected is processing_failed. */
export function failureCode(err: unknown): JobErrorCode {
  if (!(err instanceof AutocutError)) return 'processing_failed';
  switch (err.code) {
    case 'video_too_long':
    case 'unsupported_format':
    case 'plan_failed':
      return err.code;
    case 'invalid_plan':
      return 'plan_failed';
    default:
      return 'processing_failed';
  }
}
