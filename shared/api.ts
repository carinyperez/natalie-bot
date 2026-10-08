/**
 * Contract between the app and the backend API. No runtime dependencies, so both sides can import it.
 *
 * Every endpoint needs `Authorization: Bearer <Cognito token>`. Another user's job returns 404.
 */

/** Every endpoint lives under this prefix. */
export const API_VERSION_PREFIX = '/v1';

/** Longest video v1 accepts: 5 minutes, enough for a full match and one Lambda run. */
export const MAX_VIDEO_SECONDS = 300;

/** Largest upload v1 accepts. */
export const MAX_UPLOAD_BYTES = 2_147_483_648; // 2 GB

/** Longest prompt the server accepts. */
export const MAX_PROMPT_CHARS = 500;

/** What the server uses when the prompt is empty. */
export const DEFAULT_PROMPT = 'AutoCut';

export type ContentType = 'video/mp4' | 'video/quicktime';

export type JobStatus = 'awaiting_upload' | 'processing' | 'succeeded' | 'failed';

/** Where a processing job is. A refine starts at 'planning', reusing the source job's analysis. */
export type JobStage = 'analyzing' | 'planning' | 'rendering';

export type JobErrorCode =
  | 'upload_expired' // no upload arrived within 1 hour
  | 'video_too_long' // ffprobe found more than MAX_VIDEO_SECONDS
  | 'unsupported_format' // FFmpeg could not decode the input
  | 'plan_failed' // the AI could not produce a valid edit; rephrasing may help
  | 'processing_failed'; // anything else; safe to retry with a new job

/** One piece of the source video kept in the reel. */
export type EditSegment = {
  startSeconds: number; // in the source video
  endSeconds: number;
  cropCenterX: number; // 0..1, horizontal centre of the 9:16 window
};

export type Job = {
  id: string; // UUID
  status: JobStatus;
  /** Set only while status is 'processing'. */
  stage: JobStage | null;
  prompt: string;
  /** The job this one refines, or null for a new upload. */
  refinesJobId: string | null;
  /** The AI's one-line summary of the edit, set when status is 'succeeded'. */
  message: string | null;
  /** Set when status is 'succeeded'. */
  plan: { segments: EditSegment[]; totalSeconds: number } | null;
  /** Set only when status is 'succeeded'. */
  output: {
    url: string; // presigned GET, valid 1 hour
    urlExpiresAt: string;
    durationSeconds: number;
    width: 1080;
    height: 1920;
  } | null;
  /** Set only when status is 'failed'. */
  error: { code: JobErrorCode; message: string } | null;
  createdAt: string; // ISO 8601, UTC
  updatedAt: string;
};

/** Body of POST /v1/jobs for a new video. */
export type NewJobRequest = {
  prompt: string; // empty means DEFAULT_PROMPT; at most MAX_PROMPT_CHARS
  contentType: ContentType;
  fileSizeBytes: number; // at most MAX_UPLOAD_BYTES
  durationSeconds: number | null; // from the picker; null when unknown
};

/** Body of POST /v1/jobs to adjust an earlier edit. Reuses its video, so nothing is uploaded. */
export type RefineJobRequest = {
  prompt: string;
  refinesJobId: string; // must be the user's own job, and succeeded
};

export type CreateJobRequest = NewJobRequest | RefineJobRequest;

/** S3 presigned POST. */
export type UploadTarget = {
  url: string;
  fields: Record<string, string>; // send as form fields before the file
  expiresAt: string; // 15 minutes after creation
};

/** A sound to suggest at export. The app only names it; the user adds it in Instagram. */
export type MusicSuggestion = {
  title: string;
  artist: string;
  why: string; // e.g. "High energy, matches the fast cuts"
};

export type ApiErrorCode =
  | 'validation_error' // 400
  | 'prompt_too_long' // 400
  | 'unauthorized' // 401
  | 'not_found' // 404
  | 'file_too_large' // 413
  | 'video_too_long' // 422
  | 'internal_error'; // 500

/** Body of every non-2xx response. */
export type ApiError = { error: { code: ApiErrorCode; message: string } };

/** POST /v1/jobs, 201. `upload` is null for a refine. */
export type CreateJobResponse = { job: Job; upload: UploadTarget | null };

/** GET /v1/jobs/{jobId} */
export type GetJobResponse = { job: Job };

/** GET /v1/jobs/{jobId}/music-suggestions */
export type MusicSuggestionsResponse = { suggestions: MusicSuggestion[] };

/** Everything the app needs from the backend. */
export interface ApiClient {
  /** POST /v1/jobs */
  createJob(req: CreateJobRequest): Promise<CreateJobResponse>;
  /** GET /v1/jobs/{jobId} */
  getJob(jobId: string): Promise<GetJobResponse>;
  /** GET /v1/jobs/{jobId}/music-suggestions */
  getMusicSuggestions(jobId: string): Promise<MusicSuggestionsResponse>;
  /** Sends the file straight to S3 with the presigned POST from createJob. Not a backend endpoint. */
  uploadFile(upload: UploadTarget, fileUri: string, contentType: ContentType): Promise<void>;
}

/** Thrown by an ApiClient for any non-2xx response, so screens can switch on `code`. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: ApiError;

  constructor(status: number, body: ApiError) {
    super(body.error.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.body = body;
  }

  get code(): ApiErrorCode {
    return this.body.error.code;
  }
}
