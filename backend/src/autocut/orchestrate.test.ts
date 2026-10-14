import type { Job } from '@shared/api';
import { analyze, type Analysis } from './analyze';
import { AutocutError } from './errors';
import { failureCode, RUN_LEASE_MS, runJob, type JobStorage } from './orchestrate';
import { planEdit, type PlanClient } from './plan';
import { render } from './render';

// The steps have their own tests; here they are stand-ins so the orchestration itself is under test.
jest.mock('./analyze', () => ({ analyze: jest.fn() }));
jest.mock('./render', () => ({ ...jest.requireActual('./render'), render: jest.fn() }));
jest.mock('./plan', () => ({ ...jest.requireActual('./plan'), planEdit: jest.fn() }));

const mockAnalyze = jest.mocked(analyze);
const mockPlanEdit = jest.mocked(planEdit);
const mockRender = jest.mocked(render);

const analysis: Analysis = {
  durationSeconds: 40,
  width: 1920,
  height: 1080,
  sheets: [],
  loudness: [],
  loudPeaks: [],
  sceneCuts: [10],
};
const plan = {
  segments: [
    { startSeconds: 12, endSeconds: 18, cropCenterX: 0.4 },
    { startSeconds: 28, endSeconds: 36.5, cropCenterX: 0.6 },
  ],
  message: 'Kept the takedown and the escape, 14.5 s.',
  usage: { attempts: 1, inputTokens: 9000, outputTokens: 400 },
};

const newJob = (overrides: Partial<Job> = {}): Job => ({
  id: 'job-1',
  status: 'processing',
  stage: null,
  prompt: 'AutoCut',
  refinesJobId: null,
  message: null,
  plan: null,
  output: null,
  error: null,
  createdAt: '2026-10-14T10:00:00.000Z',
  updatedAt: '2026-10-14T10:00:00.000Z',
  ...overrides,
});

/** An in-memory JobStorage that records every update, so the stage sequence can be checked. */
function memoryStorage(jobs: Job[], analyses: Record<string, Analysis> = {}) {
  const byId = new Map(jobs.map((j) => [j.id, structuredClone(j)]));
  const updates: { jobId: string; changes: Partial<Job> }[] = [];
  const claims = new Map<string, number>();
  const storage: JobStorage = {
    getJob: async (id) => structuredClone(byId.get(id) ?? null),
    claimRun: async (id, until) => {
      const held = claims.get(id);
      if (held !== undefined && held > clock.getTime()) return false;
      claims.set(id, until.getTime());
      return true;
    },
    updateJob: async (id, changes) => {
      updates.push({ jobId: id, changes });
      Object.assign(byId.get(id)!, changes);
    },
    videoPath: async (job) => `/videos/${job.refinesJobId ?? job.id}.mov`,
    workDir: async (id) => `/work/${id}`,
    saveAnalysis: jest.fn(async (id, a) => {
      analyses[id] = a;
    }),
    loadAnalysis: async (id) => analyses[id] ?? null,
    publishReel: async (id) => ({ url: `https://reels.test/${id}.mp4`, urlExpiresAt: '2026-10-14T11:00:00.000Z' }),
  };
  const stages = () => updates.filter((u) => u.changes.stage).map((u) => u.changes.stage);
  return { storage, updates, stages, stored: (id: string) => byId.get(id)! };
}

const planner = { client: {} as PlanClient, provider: 'bedrock' as const };
const quietLog = { info: jest.fn(), error: jest.fn() };
/** The time runJob sees; tests move it to let a claim lapse. */
let clock = new Date('2026-10-14T10:05:00Z');
const deps = (storage: JobStorage) => ({ storage, planner, log: quietLog, now: () => clock });

beforeEach(() => {
  clock = new Date('2026-10-14T10:05:00Z');
  jest.resetAllMocks();
  mockAnalyze.mockResolvedValue(analysis);
  mockPlanEdit.mockResolvedValue(plan);
  mockRender.mockResolvedValue({ durationSeconds: 14.5 });
});

describe('runJob for a new upload', () => {
  it('analyzes, plans and renders in that order, then succeeds with the plan and the reel', async () => {
    const { storage, stages, stored } = memoryStorage([newJob()]);
    await runJob('job-1', deps(storage));

    expect(stages()).toEqual(['analyzing', 'planning', 'rendering']);
    expect(mockAnalyze).toHaveBeenCalledWith('/videos/job-1.mov', '/work/job-1/analysis');
    expect(mockPlanEdit).toHaveBeenCalledWith(planner.client, { analysis, prompt: 'AutoCut', previousPlan: undefined }, 'bedrock');
    expect(mockRender).toHaveBeenCalledWith('/videos/job-1.mov', plan.segments, '/work/job-1/reel.mp4', '/work/job-1/render');
    expect(stored('job-1')).toMatchObject({
      status: 'succeeded',
      stage: null,
      message: plan.message,
      plan: { segments: plan.segments, totalSeconds: 14.5 },
      output: { url: 'https://reels.test/job-1.mp4', durationSeconds: 14.5, width: 1080, height: 1920 },
      error: null,
      updatedAt: '2026-10-14T10:05:00.000Z',
    });
  });

  it('keeps the analysis so a refine can reuse it', async () => {
    const { storage } = memoryStorage([newJob()]);
    await runJob('job-1', deps(storage));
    expect(storage.saveAnalysis).toHaveBeenCalledWith('job-1', analysis);
  });

  it('returns a finished job unchanged, so a repeated trigger does nothing', async () => {
    const done = newJob({ status: 'succeeded', stage: null });
    const { storage, updates } = memoryStorage([done]);
    await expect(runJob('job-1', deps(storage))).resolves.toEqual(done);
    expect(updates).toHaveLength(0);
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it('runs a job once when the trigger arrives twice at the same time', async () => {
    const { storage, stored } = memoryStorage([newJob()]);
    await Promise.all([runJob('job-1', deps(storage)), runJob('job-1', deps(storage))]);

    expect(mockAnalyze).toHaveBeenCalledTimes(1);
    expect(mockPlanEdit).toHaveBeenCalledTimes(1);
    expect(mockRender).toHaveBeenCalledTimes(1);
    expect(stored('job-1').status).toBe('succeeded');
  });

  it('lets a retry take over once the claim of a crashed run has lapsed', async () => {
    const { storage } = memoryStorage([newJob()]);
    await storage.claimRun('job-1', new Date(clock.getTime() + RUN_LEASE_MS)); // a run that then crashed

    await runJob('job-1', deps(storage));
    expect(mockAnalyze).not.toHaveBeenCalled();

    clock = new Date(clock.getTime() + RUN_LEASE_MS + 1);
    await runJob('job-1', deps(storage));
    expect(mockAnalyze).toHaveBeenCalledTimes(1);
  });

  it('throws for a job that does not exist', async () => {
    const { storage } = memoryStorage([]);
    await expect(runJob('missing', deps(storage))).rejects.toThrow('not found');
  });
});

describe('runJob for a refine', () => {
  const source = newJob({
    id: 'job-1',
    status: 'succeeded',
    message: 'Kept three moments, 24 s.',
    plan: { segments: [{ startSeconds: 0, endSeconds: 24, cropCenterX: 0.5 }], totalSeconds: 24 },
  });
  const refine = newJob({ id: 'job-2', prompt: 'shorter', refinesJobId: 'job-1' });

  it("skips Analyze, reuses the source's analysis, and gives Claude the source's plan to adjust", async () => {
    const { storage, stages, stored } = memoryStorage([source, refine], { 'job-1': analysis });
    await runJob('job-2', deps(storage));

    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(stages()).toEqual(['planning', 'rendering']);
    expect(mockPlanEdit).toHaveBeenCalledWith(
      planner.client,
      { analysis, prompt: 'shorter', previousPlan: { segments: source.plan!.segments, message: source.message } },
      'bedrock',
    );
    // The refine renders from the original upload's video.
    expect(mockRender.mock.calls[0][0]).toBe('/videos/job-1.mov');
    expect(storage.saveAnalysis).toHaveBeenCalledWith('job-2', analysis);
    expect(stored('job-2').status).toBe('succeeded');
  });

  it("analyzes again when the source's analysis is missing", async () => {
    const { storage, stages } = memoryStorage([source, refine]);
    await runJob('job-2', deps(storage));
    expect(stages()).toEqual(['analyzing', 'planning', 'rendering']);
    expect(mockAnalyze).toHaveBeenCalledWith('/videos/job-1.mov', '/work/job-2/analysis');
  });

  it('fails with processing_failed when the source job has no finished plan', async () => {
    const unfinished = newJob({ id: 'job-1', status: 'processing' });
    const { storage, stored } = memoryStorage([unfinished, refine]);
    await runJob('job-2', deps(storage));
    expect(stored('job-2').error?.code).toBe('processing_failed');
    expect(mockPlanEdit).not.toHaveBeenCalled();
  });
});

describe('runJob failures', () => {
  it.each([
    ['analyze', 'video_too_long', 'video_too_long', /5 minutes/],
    ['analyze', 'unsupported_format', 'unsupported_format', /couldn't be read/],
    ['plan', 'plan_failed', 'plan_failed', /describing it differently/],
    ['render', 'invalid_plan', 'plan_failed', /describing it differently/],
    ['render', 'ffmpeg_failed', 'processing_failed', /Something went wrong/],
  ] as const)('a %s %s error ends the job as %s with a message for the app', async (step, thrown, code, message) => {
    const error = new AutocutError(thrown, 'detail for the logs');
    ({ analyze: mockAnalyze, plan: mockPlanEdit, render: mockRender })[step].mockRejectedValue(error);
    const { storage, stored } = memoryStorage([newJob()]);

    await runJob('job-1', deps(storage));

    expect(stored('job-1')).toMatchObject({ status: 'failed', stage: null, output: null, error: { code } });
    expect(stored('job-1').error?.message).toMatch(message);
    expect(stored('job-1').error?.message).not.toContain('detail for the logs');
    expect(quietLog.error).toHaveBeenCalled();
  });

  it('turns an unexpected error (e.g. the API is down) into processing_failed', async () => {
    mockPlanEdit.mockRejectedValue(new Error('503 overloaded'));
    const { storage, stored } = memoryStorage([newJob()]);
    await runJob('job-1', deps(storage));
    expect(stored('job-1').error?.code).toBe('processing_failed');
  });

  it('maps AutocutError codes to job error codes', () => {
    expect(failureCode(new AutocutError('invalid_plan', 'x'))).toBe('plan_failed');
    expect(failureCode(new AutocutError('ffmpeg_failed', 'x'))).toBe('processing_failed');
    expect(failureCode('a string')).toBe('processing_failed');
  });
});
