/**
 * Contract between the app and the backend API. No runtime dependencies, so both sides can import it.
 *
 * Every endpoint needs `Authorization: Bearer <Cognito token>`. Another user's job returns 404.
 */

/** Every endpoint lives under this prefix. */
export const API_VERSION_PREFIX = '/v1';

/** Longest video v1 accepts, per the product brief. */
export const MAX_VIDEO_SECONDS = 90;

/** Largest upload v1 accepts. */
export const MAX_UPLOAD_BYTES = 1_073_741_824; // 1 GB

export type Track = {
  id: string;
  title: string;
  artist: string;
  durationSeconds: number;
  previewUrl: string; // presigned GET, valid 1 hour
};

export type JobStatus = 'awaiting_upload' | 'processing' | 'succeeded' | 'failed';

export type JobErrorCode =
  | 'upload_expired' // no upload arrived within 1 hour
  | 'video_too_long' // ffprobe found more than 90 s
  | 'unsupported_format' // FFmpeg could not decode the input
  | 'processing_failed'; // anything else; safe to retry with a new job

export type Job = {
  id: string; // UUID
  status: JobStatus;
  trackId: string;
  createdAt: string; // ISO 8601, UTC
  updatedAt: string;
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
};

/** Body of POST /v1/jobs. */
export type CreateJobRequest = {
  trackId: string;
  contentType: 'video/mp4' | 'video/quicktime';
  fileSizeBytes: number; // at most MAX_UPLOAD_BYTES
  durationSeconds: number | null; // from the picker; null when unknown
};

/** S3 presigned POST. */
export type UploadTarget = {
  url: string;
  fields: Record<string, string>; // send as form fields before the file
  expiresAt: string; // 15 minutes after creation
};

export type ApiErrorCode =
  | 'validation_error' // 400
  | 'unauthorized' // 401
  | 'not_found' // 404
  | 'file_too_large' // 413
  | 'video_too_long' // 422
  | 'unknown_track' // 422
  | 'internal_error'; // 500

/** Body of every non-2xx response. */
export type ApiError = { error: { code: ApiErrorCode; message: string } };

/** GET /v1/tracks */
export type ListTracksResponse = { tracks: Track[] };

/** POST /v1/jobs, 201 */
export type CreateJobResponse = { job: Job; upload: UploadTarget };

/** GET /v1/jobs/{jobId} */
export type GetJobResponse = { job: Job };

/** Everything the app needs from the backend. */
export interface ApiClient {
  /** GET /v1/tracks */
  listTracks(): Promise<ListTracksResponse>;
  /** POST /v1/jobs */
  createJob(req: CreateJobRequest): Promise<CreateJobResponse>;
  /** GET /v1/jobs/{jobId} */
  getJob(jobId: string): Promise<GetJobResponse>;
  /** Sends the file straight to S3 with the presigned POST from createJob. Not a backend endpoint. */
  uploadFile(upload: UploadTarget, fileUri: string, contentType: CreateJobRequest['contentType']): Promise<void>;
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
