import { MockApiClient } from '@/api/mock-api-client';
import {
  ApiRequestError,
  MAX_PROMPT_CHARS,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_SECONDS,
  type NewJobRequest,
} from '@shared/api';

const validRequest: NewJobRequest = {
  prompt: 'AutoCut',
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
async function startJob(client: MockApiClient, request: NewJobRequest = validRequest) {
  const { value } = await settle(client.createJob(request));
  const { job, upload } = value!;
  await settle(client.uploadFile(upload!));
  return job.id;
}

/**
 * Reads a job `ms` after the previous read point. The read lands exactly then: the wait covers all but the
 * mock's 200 ms network delay, and the read's own settle covers the rest.
 */
async function readAfter(client: MockApiClient, jobId: string, ms: number) {
  await jest.advanceTimersByTimeAsync(ms - 200);
  const { value } = await settle(client.getJob(jobId), 200);
  return value!.job;
}

/** Uploads a video and lets it finish. Returns the succeeded job's id. */
async function finishedJob(client: MockApiClient) {
  const jobId = await startJob(client);
  const job = await readAfter(client, jobId, 9_000);
  expect(job.status).toBe('succeeded');
  return jobId;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('MockApiClient', () => {
  describe('createJob for a new video', () => {
    it('creates a job awaiting upload, with an upload target', async () => {
      const { value } = await settle(new MockApiClient().createJob(validRequest));
      expect(value!.job).toMatchObject({
        status: 'awaiting_upload',
        stage: null,
        prompt: 'AutoCut',
        refinesJobId: null,
        plan: null,
        output: null,
      });
      expect(value!.upload?.url).toBeTruthy();
    });

    it('uses the default prompt when the prompt is empty', async () => {
      const { value } = await settle(new MockApiClient().createJob({ ...validRequest, prompt: '   ' }));
      expect(value!.job.prompt).toBe('AutoCut');
    });

    it('rejects a prompt over the limit', async () => {
      await expectApiError(
        new MockApiClient().createJob({ ...validRequest, prompt: 'x'.repeat(MAX_PROMPT_CHARS + 1) }),
        400,
        'prompt_too_long',
      );
    });

    it('rejects a file over the upload limit', async () => {
      await expectApiError(
        new MockApiClient().createJob({ ...validRequest, fileSizeBytes: MAX_UPLOAD_BYTES + 1 }),
        413,
        'file_too_large',
      );
    });

    it('rejects a video over the length limit, and accepts one at the limit or of unknown length', async () => {
      await expectApiError(
        new MockApiClient().createJob({ ...validRequest, durationSeconds: MAX_VIDEO_SECONDS + 1 }),
        422,
        'video_too_long',
      );
      for (const durationSeconds of [MAX_VIDEO_SECONDS, null]) {
        const { error } = await settle(new MockApiClient().createJob({ ...validRequest, durationSeconds }));
        expect(error).toBeNull();
      }
    });
  });

  describe('processing a new video', () => {
    it('moves through analyzing, planning and rendering, then succeeds after about 8 seconds', async () => {
      const client = new MockApiClient();
      const jobId = await startJob(client);

      expect((await readAfter(client, jobId, 2_900)).stage).toBe('analyzing');
      expect((await readAfter(client, jobId, 200)).stage).toBe('planning'); // 3.1 s
      expect((await readAfter(client, jobId, 3_000)).stage).toBe('rendering'); // 6.1 s
      expect((await readAfter(client, jobId, 1_800)).status).toBe('processing'); // 7.9 s

      const done = await readAfter(client, jobId, 200); // 8.1 s
      expect(done).toMatchObject({ status: 'succeeded', stage: null, error: null });
      expect(done.message).toMatch(/24 s/);
      expect(done.plan?.totalSeconds).toBe(24);
      expect(done.output).toMatchObject({ width: 1080, height: 1920, durationSeconds: 24 });
      expect(done.output!.url).toMatch(/^https:\/\//);
    });

    it('keeps every planned segment inside the source video', async () => {
      const client = new MockApiClient();
      const done = await readAfter(client, await startJob(client), 9_000);
      for (const segment of done.plan!.segments) {
        expect(segment.startSeconds).toBeGreaterThanOrEqual(0);
        expect(segment.endSeconds).toBeLessThanOrEqual(validRequest.durationSeconds!);
        expect(segment.endSeconds).toBeGreaterThan(segment.startSeconds);
      }
    });

    it('ends in failed when forceFail is set', async () => {
      const client = new MockApiClient({ forceFail: true });
      const done = await readAfter(client, await startJob(client), 9_000);
      expect(done).toMatchObject({
        status: 'failed',
        stage: null,
        plan: null,
        output: null,
        error: { code: 'processing_failed' },
      });
    });

    it('returns 404 for an unknown job', async () => {
      await expectApiError(new MockApiClient().getJob('missing'), 404, 'not_found');
    });
  });

  describe('refining an edit', () => {
    it('reuses the video without an upload, starts at planning, and makes a shorter reel when asked', async () => {
      const client = new MockApiClient();
      const sourceId = await finishedJob(client);

      const { value } = await settle(client.createJob({ prompt: 'make it shorter', refinesJobId: sourceId }), 200);
      expect(value!.upload).toBeNull();
      expect(value!.job).toMatchObject({ status: 'processing', stage: 'planning', refinesJobId: sourceId });

      const refineId = value!.job.id;
      expect((await readAfter(client, refineId, 2_100)).stage).toBe('rendering'); // 2.1 s after creation
      const done = await readAfter(client, refineId, 2_000); // 4.1 s
      expect(done.status).toBe('succeeded');
      expect(done.output!.durationSeconds).toBe(12);
    });

    it('returns 404 when the job to refine does not exist', async () => {
      await expectApiError(
        new MockApiClient().createJob({ prompt: 'shorter', refinesJobId: 'missing' }),
        404,
        'not_found',
      );
    });

    it('rejects refining a job that has not finished', async () => {
      const client = new MockApiClient();
      const jobId = await startJob(client);
      await expectApiError(client.createJob({ prompt: 'shorter', refinesJobId: jobId }), 400, 'validation_error');
    });
  });

  describe('getMusicSuggestions', () => {
    it('returns three suggestions once the reel is ready', async () => {
      const client = new MockApiClient();
      const jobId = await finishedJob(client);
      const { value } = await settle(client.getMusicSuggestions(jobId));
      expect(value!.suggestions).toHaveLength(3);
      for (const suggestion of value!.suggestions) {
        expect(suggestion.title && suggestion.artist && suggestion.why).toBeTruthy();
      }
    });

    it('rejects a job that is still processing, and an unknown job', async () => {
      const client = new MockApiClient();
      await expectApiError(client.getMusicSuggestions(await startJob(client)), 400, 'validation_error');
      await expectApiError(client.getMusicSuggestions('missing'), 404, 'not_found');
    });
  });
});
