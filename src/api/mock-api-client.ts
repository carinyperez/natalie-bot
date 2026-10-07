import {
  ApiRequestError,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_SECONDS,
  type ApiClient,
  type ApiErrorCode,
  type CreateJobRequest,
  type CreateJobResponse,
  type GetJobResponse,
  type Job,
  type ListTracksResponse,
  type Track,
  type UploadTarget,
} from '@shared/api';

const NETWORK_DELAY_MS = 200;
const UPLOAD_DELAY_MS = 1000;
const PROCESSING_MS = 8000;
const HOUR_MS = 60 * 60 * 1000;
const UPLOAD_WINDOW_MS = 15 * 60 * 1000;
const SAMPLE_OUTPUT_URL = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';

const TRACKS: Track[] = [
  {
    id: 'track-1',
    title: 'Sunrise Drive',
    artist: 'SoundHelix',
    durationSeconds: 372,
    previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  },
  {
    id: 'track-2',
    title: 'City Lights',
    artist: 'SoundHelix',
    durationSeconds: 425,
    previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
  },
  {
    id: 'track-3',
    title: 'Slow Burn',
    artist: 'SoundHelix',
    durationSeconds: 344,
    previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
  },
];

type StoredJob = {
  job: Job;
  inputDurationSeconds: number | null;
  /** Epoch ms when the upload landed; null until then. */
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

  async listTracks(): Promise<ListTracksResponse> {
    await delay(NETWORK_DELAY_MS);
    return { tracks: TRACKS.map((track) => ({ ...track })) };
  }

  async createJob(req: CreateJobRequest): Promise<CreateJobResponse> {
    await delay(NETWORK_DELAY_MS);
    if (!TRACKS.some((track) => track.id === req.trackId)) {
      throw apiError(422, 'unknown_track', `No track with id ${req.trackId}.`);
    }
    if (req.fileSizeBytes > MAX_UPLOAD_BYTES) {
      throw apiError(413, 'file_too_large', 'Videos must be 1 GB or smaller.');
    }
    if (req.durationSeconds != null && req.durationSeconds > MAX_VIDEO_SECONDS) {
      throw apiError(422, 'video_too_long', `Videos must be ${MAX_VIDEO_SECONDS} seconds or shorter.`);
    }

    const now = Date.now();
    const job: Job = {
      id: uuid(),
      status: 'awaiting_upload',
      trackId: req.trackId,
      createdAt: iso(now),
      updatedAt: iso(now),
      output: null,
      error: null,
    };
    this.jobs.set(job.id, { job, inputDurationSeconds: req.durationSeconds, processingStartedAt: null });

    const upload: UploadTarget = {
      url: 'https://mock-uploads.s3.amazonaws.com/',
      fields: { key: `uploads/${job.id}`, 'Content-Type': req.contentType },
      expiresAt: iso(now + UPLOAD_WINDOW_MS),
    };
    return { job: copyJob(job), upload };
  }

  async getJob(jobId: string): Promise<GetJobResponse> {
    await delay(NETWORK_DELAY_MS);
    const stored = this.jobs.get(jobId);
    if (!stored) throw apiError(404, 'not_found', 'Job not found.');
    this.finishIfDue(stored);
    return { job: copyJob(stored.job) };
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
    stored.job.updatedAt = iso(now);
  }

  /** Processing has no timer: a job is finished on read once PROCESSING_MS has passed. */
  private finishIfDue(stored: StoredJob) {
    const { job, processingStartedAt } = stored;
    if (job.status !== 'processing' || processingStartedAt == null) return;
    const finishedAt = processingStartedAt + PROCESSING_MS;
    if (Date.now() < finishedAt) return;

    job.updatedAt = iso(finishedAt);
    if (this.forceFail) {
      job.status = 'failed';
      job.error = { code: 'processing_failed', message: 'Something went wrong making your reel. Please try again.' };
      return;
    }
    job.status = 'succeeded';
    job.output = {
      url: SAMPLE_OUTPUT_URL,
      urlExpiresAt: iso(finishedAt + HOUR_MS),
      durationSeconds: stored.inputDurationSeconds ?? 30,
      width: 1080,
      height: 1920,
    };
  }
}

function apiError(status: number, code: ApiErrorCode, message: string) {
  return new ApiRequestError(status, { error: { code, message } });
}

function copyJob(job: Job): Job {
  return {
    ...job,
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
