import type { ListTracksResponse } from '@shared/api';
import { json, withErrorHandling } from '../lib/http';
import { listTracks } from '../tracks/placeholder-tracks';

/** GET /v1/tracks */
export const handler = withErrorHandling(async () => {
  const body: ListTracksResponse = { tracks: await listTracks() };
  return json(200, body);
});
