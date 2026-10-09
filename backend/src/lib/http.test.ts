import type { ApiError } from '@shared/api';
import { errorResponse, json, withErrorHandling } from './http';

describe('json', () => {
  it('serializes the body and sets a JSON content-type', () => {
    const res = json(200, { ok: true });

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['content-type']).toMatch(/^application\/json/);
    expect(JSON.parse(res.body as string)).toEqual({ ok: true });
  });
});

describe('errorResponse', () => {
  it('returns 400 with the ApiError envelope for validation_error', () => {
    const res = errorResponse('validation_error', 'prompt is required');

    expect(res.statusCode).toBe(400);
    expect(res.headers?.['content-type']).toMatch(/^application\/json/);
    const body: ApiError = JSON.parse(res.body as string);
    expect(body).toEqual({ error: { code: 'validation_error', message: 'prompt is required' } });
  });

  it('returns 500 for internal_error', () => {
    const res = errorResponse('internal_error', 'boom');

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({ error: { code: 'internal_error', message: 'boom' } });
  });
});

describe('withErrorHandling', () => {
  it('passes a successful response through untouched', async () => {
    const ok = json(200, { ok: true });
    const handler = withErrorHandling(async () => ok);

    await expect(handler({})).resolves.toBe(ok);
  });

  it('turns a thrown error into a 500 internal_error without leaking the message', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const handler = withErrorHandling(async () => {
      throw new Error('db password is hunter2');
    });

    const res = await handler({});

    expect(res.statusCode).toBe(500);
    const body: ApiError = JSON.parse(res.body as string);
    expect(body.error.code).toBe('internal_error');
    expect(res.body).not.toContain('hunter2');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
