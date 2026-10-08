import {
  ApiRequestError,
  DEFAULT_PROMPT,
  MAX_PROMPT_CHARS,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_SECONDS,
  type ApiClient,
  type ApiErrorCode,
  type CreateJobRequest,
  type CreateJobResponse,
  type EditSegment,
  type GetJobResponse,
  type Job,
  type JobStage,
  type MusicSuggestionsResponse,
  type UploadTarget,
} from '@shared/api';

const NETWORK_DELAY_MS = 200;
const UPLOAD_DELAY_MS = 1000;
const HOUR_MS = 60 * 60 * 1000;
const UPLOAD_WINDOW_MS = 15 * 60 * 1000;
const SAMPLE_OUTPUT_URL = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';

/** How long each stage lasts. A new upload runs all three; a refine reuses the analysis and starts at planning. */
const UPLOAD_STAGES: StageStep[] = [
  { stage: 'analyzing', ms: 3000 },
  { stage: 'planning', ms: 3000 },
  { stage: 'rendering', ms: 2000 },
];
const REFINE_STAGES: StageStep[] = [
  { stage: 'planning', ms: 2000 },
  { stage: 'rendering', ms: 2000 },
];

/** Assumed source length when the picker didn't report one. */
const UNKNOWN_DURATION_SECONDS = 60;

const SUGGESTIONS: MusicSuggestionsResponse['suggestions'] = [
  { title: 'Sample Sound One', artist: 'Mock Artist', why: 'High energy, matches the fast cuts' },
  { title: 'Sample Sound Two', artist: 'Mock Artist', why: 'Builds up to the best moment' },
  { title: 'Sample Sound Three', artist: 'Mock Artist', why: 'Trending with sports clips this week' },
];

type StageStep = { stage: JobStage; ms: number };

type StoredJob = {
  job: Job;
  sourceDurationSeconds: number;
  stages: StageStep[];
  /** Epoch ms when processing started (upload landed, or refine created); null until then. */
  processingStartedAt: number | null;
};

export type MockApiClientOptions = {
  /** Make every job end in 'failed' with 'processing_failed' instead of succeeding. */
  forceFail?: boolean;
};

/** In-memory stand-in for the backend. Behaves like the real API, including its validation errors. */
export class MockApiClient implements ApiClient {
  private readonly jobs = new Map<string, StoredJob>();
  private readonly forceFail: boolean;

  constructor(options: MockApiClientOptions = {}) {
    this.forceFail = options.forceFail ?? false;
  }

  async createJob(req: CreateJobRequest): Promise<CreateJobResponse> {
    await delay(NETWORK_DELAY_MS);
    if (req.prompt.length > MAX_PROMPT_CHARS) {
      throw apiError(400, 'prompt_too_long', `Keep it under ${MAX_PROMPT_CHARS} characters.`);
    }
    const prompt = req.prompt.trim() || DEFAULT_PROMPT;
    const now = Date.now();

    if ('refinesJobId' in req) {
      const source = this.jobs.get(req.refinesJobId);
      if (!source) throw apiError(404, 'not_found', 'Job not found.');
      if (source.job.status !== 'succeeded') {
        throw apiError(400, 'validation_error', 'Only a finished reel can be adjusted.');
      }
      const job = newJob(prompt, req.refinesJobId, now);
      job.status = 'processing';
      job.stage = REFINE_STAGES[0].stage;
      this.jobs.set(job.id, {
        job,
        sourceDurationSeconds: source.sourceDurationSeconds,
        stages: REFINE_STAGES,
        processingStartedAt: now,
      });
      return { job: copyJob(job), upload: null };
    }

    if (req.fileSizeBytes > MAX_UPLOAD_BYTES) {
      throw apiError(413, 'file_too_large', 'Videos must be 2 GB or smaller.');
    }
    if (req.durationSeconds != null && req.durationSeconds > MAX_VIDEO_SECONDS) {
      throw apiError(422, 'video_too_long', `Videos must be ${MAX_VIDEO_SECONDS / 60} minutes or shorter.`);
    }

    const job = newJob(prompt, null, now);
    this.jobs.set(job.id, {
      job,
      sourceDurationSeconds: req.durationSeconds ?? UNKNOWN_DURATION_SECONDS,
      stages: UPLOAD_STAGES,
      processingStartedAt: null,
    });
    const upload: UploadTarget = {
      url: 'https://mock-uploads.s3.amazonaws.com/',
      fields: { key: `uploads/${job.id}`, 'Content-Type': req.contentType },
      expiresAt: iso(now + UPLOAD_WINDOW_MS),
    };
    return { job: copyJob(job), upload };
  }

  async getJob(jobId: string): Promise<GetJobResponse> {
    await delay(NETWORK_DELAY_MS);
    const stored = this.find(jobId);
    this.advance(stored);
    return { job: copyJob(stored.job) };
  }

  async getMusicSuggestions(jobId: string): Promise<MusicSuggestionsResponse> {
    await delay(NETWORK_DELAY_MS);
    const stored = this.find(jobId);
    this.advance(stored);
    if (stored.job.status !== 'succeeded') {
      throw apiError(400, 'validation_error', 'Suggestions are ready once the reel is.');
    }
    return { suggestions: SUGGESTIONS.map((s) => ({ ...s })) };
  }

  async uploadFile(upload: UploadTarget): Promise<void> {
    await delay(UPLOAD_DELAY_MS);
    const jobId = upload.fields.key?.replace('uploads/', '');
    const stored = jobId ? this.jobs.get(jobId) : undefined;
    if (!stored) throw apiError(404, 'not_found', 'Job not found.');
    if (stored.job.status !== 'awaiting_upload') return;

    const now = Date.now();
    stored.processingStartedAt = now;
    stored.job.status = 'processing';
    stored.job.stage = stored.stages[0].stage;
    stored.job.updatedAt = iso(now);
  }

  private find(jobId: string) {
    const stored = this.jobs.get(jobId);
    if (!stored) throw apiError(404, 'not_found', 'Job not found.');
    return stored;
  }

  /** There are no timers: a job's stage is worked out from how long it has been processing, on read. */
  private advance(stored: StoredJob) {
    const { job, processingStartedAt, stages } = stored;
    if (job.status !== 'processing' || processingStartedAt == null) return;

    let stageEndsAt = processingStartedAt;
    for (const step of stages) {
      stageEndsAt += step.ms;
      if (Date.now() < stageEndsAt) {
        if (job.stage !== step.stage) {
          job.stage = step.stage;
          job.updatedAt = iso(stageEndsAt - step.ms);
        }
        return;
      }
    }

    job.stage = null;
    job.updatedAt = iso(stageEndsAt);
    if (this.forceFail) {
      job.status = 'failed';
      job.error = { code: 'processing_failed', message: 'Something went wrong making your reel. Please try again.' };
      return;
    }
    const plan = fakePlan(job.prompt, stored.sourceDurationSeconds);
    job.status = 'succeeded';
    job.plan = plan;
    job.message = `Kept the best moments, framed on the action. ${plan.totalSeconds} s.`;
    job.output = {
      url: SAMPLE_OUTPUT_URL,
      urlExpiresAt: iso(stageEndsAt + HOUR_MS),
      durationSeconds: plan.totalSeconds,
      width: 1080,
      height: 1920,
    };
  }
}

/** Two segments from the source: 24 s by default, 12 s when the prompt asks for something shorter. */
function fakePlan(prompt: string, sourceSeconds: number): NonNullable<Job['plan']> {
  const target = Math.min(/short/i.test(prompt) ? 12 : 24, sourceSeconds);
  const half = target / 2;
  const segments: EditSegment[] = [
    { startSeconds: 0, endSeconds: half, cropCenterX: 0.4 },
    { startSeconds: sourceSeconds - half, endSeconds: sourceSeconds, cropCenterX: 0.6 },
  ];
  return { segments, totalSeconds: target };
}

function newJob(prompt: string, refinesJobId: string | null, now: number): Job {
  return {
    id: uuid(),
    status: 'awaiting_upload',
    stage: null,
    prompt,
    refinesJobId,
    message: null,
    plan: null,
    output: null,
    error: null,
    createdAt: iso(now),
    updatedAt: iso(now),
  };
}

function apiError(status: number, code: ApiErrorCode, message: string) {
  return new ApiRequestError(status, { error: { code, message } });
}

function copyJob(job: Job): Job {
  return {
    ...job,
    plan: job.plan && { ...job.plan, segments: job.plan.segments.map((s) => ({ ...s })) },
    output: job.output && { ...job.output },
    error: job.error && { ...job.error },
  };
}

function iso(ms: number) {
  return new Date(ms).toISOString();
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Random v4 UUID. Not cryptographically strong, which is fine for a mock. */
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
