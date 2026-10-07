import type { ListTracksResponse } from '@shared/api';
import { handler } from './list-tracks';
import * as placeholderTracks from '../tracks/placeholder-tracks';

describe('GET /v1/tracks', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns 200 with a JSON content-type', async () => {
    const res = await handler({});

    expect(res.statusCode).toBe(200);
    expect(res.headers?.['content-type']).toMatch(/^application\/json/);
  });

  it('returns a body shaped like ListTracksResponse', async () => {
    const res = await handler({});
    const body: ListTracksResponse = JSON.parse(res.body as string);

    expect(Object.keys(body)).toEqual(['tracks']);
    expect(body.tracks.length).toBeGreaterThan(0);
    for (const track of body.tracks) {
      expect(Object.keys(track).sort()).toEqual(['artist', 'durationSeconds', 'id', 'previewUrl', 'title']);
      expect(track).toEqual({
        id: expect.any(String),
        title: expect.any(String),
        artist: expect.any(String),
        durationSeconds: expect.any(Number),
        previewUrl: expect.stringMatching(/^https:\/\//),
      });
    }
    expect(new Set(body.tracks.map((t) => t.id)).size).toBe(body.tracks.length);
  });

  it('returns a 500 ApiError when loading tracks fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(placeholderTracks, 'listTracks').mockRejectedValue(new Error('db down'));

    const res = await handler({});

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body as string)).toEqual({
      error: { code: 'internal_error', message: expect.any(String) },
    });
  });
});
