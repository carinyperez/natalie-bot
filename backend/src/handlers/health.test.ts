import { handler } from './health';

describe('GET /v1/health', () => {
  it('returns 200 with status ok as JSON', async () => {
    const res = await handler({});

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['content-type']).toMatch(/^application\/json/);
    expect(JSON.parse(res.body as string)).toEqual({ status: 'ok' });
  });
});
