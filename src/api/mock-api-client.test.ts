import { MockApiClient } from '@/api/mock-api-client';
import { ApiRequestError, MAX_UPLOAD_BYTES, MAX_VIDEO_SECONDS, type CreateJobRequest } from '@shared/api';

const validRequest: CreateJobRequest = {
  trackId: 'track-1',
  contentType: 'video/mp4',
  fileSizeBytes: 5_000_000,
  durationSeconds: 42,
};

/** Runs a mock call to completion under fake timers, capturing a rejection instead of leaving it unhandled. */
async function settle<T>(promise: Promise<T>, ms = 1_000) {
  const result = promise.then(
    (value) => ({ value, error: null }),
    (error: unknown) => ({ value: null, error }),
  );
  await jest.advanceTimersByTimeAsync(ms);
  return result;
}

async function expectApiError(promise: Promise<unknown>, status: number, code: string) {
  const { error } = await settle(promise);
  expect(error).toBeInstanceOf(ApiRequestError);
  expect(error).toMatchObject({ status, code });
}

/** Creates a job and uploads its file. Returns the job id; processing starts at the current fake time. */
async function startJob(client: MockApiClient) {
  const { value } = await settle(client.createJob(validRequest));
  const { job, upload } = value!;
  await settle(client.uploadFile(upload));
  return job.id;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('MockApiClient', () => {
  it('lists three tracks', async () => {
    const { value } = await settle(new MockApiClient().listTracks());
    expect(value!.tracks).toHaveLength(3);
  });

  describe('createJob', () => {
    it('creates a job awaiting upload, with an upload target', async () => {
      const { value } = await settle(new MockApiClient().createJob(validRequest));
      expect(value!.job).toMatchObject({ status: 'awaiting_upload', trackId: 'track-1', output: null, error: null });
      expect(value!.upload.url).toBeTruthy();
    });

    it('rejects an unknown track', async () => {
      await expectApiError(
        new MockApiClient().createJob({ ...validRequest, trackId: 'nope' }),
        422,
        'unknown_track',
      );
    });

    it('rejects a file over the upload limit', async () => {
      await expectApiError(
        new MockApiClient().createJob({ ...validRequest, fileSizeBytes: MAX_UPLOAD_BYTES + 1 }),
        413,
        'file_too_large',
      );
    });

    it('rejects a video over the length limit', async () => {
      await expectApiError(
        new MockApiClient().createJob({ ...validRequest, durationSeconds: MAX_VIDEO_SECONDS + 1 }),
        422,
        'video_too_long',
      );
    });

    it('accepts a video whose length is unknown', async () => {
      const { error } = await settle(new MockApiClient().createJob({ ...validRequest, durationSeconds: null }));
      expect(error).toBeNull();
    });
  });

  describe('getJob', () => {
    it('returns 404 for an unknown job', async () => {
      await expectApiError(new MockApiClient().getJob('missing'), 404, 'not_found');
    });

    it('moves an uploaded job through processing to succeeded after about 8 seconds', async () => {
      const client = new MockApiClient();
      const jobId = await startJob(client);

      await jest.advanceTimersByTimeAsync(7_500);
      const processing = await settle(client.getJob(jobId), 200);
      expect(processing.value!.job.status).toBe('processing');

      await jest.advanceTimersByTimeAsync(500);
      const done = await settle(client.getJob(jobId), 200);
      expect(done.value!.job).toMatchObject({
        status: 'succeeded',
        error: null,
        output: { width: 1080, height: 1920, durationSeconds: 42 },
      });
      expect(done.value!.job.output!.url).toMatch(/^https:\/\//);
    });

    it('ends in failed when forceFail is set', async () => {
      const client = new MockApiClient({ forceFail: true });
      const jobId = await startJob(client);

      await jest.advanceTimersByTimeAsync(8_000);
      const done = await settle(client.getJob(jobId));
      expect(done.value!.job).toMatchObject({
        status: 'failed',
        output: null,
        error: { code: 'processing_failed' },
      });
    });
  });
});
