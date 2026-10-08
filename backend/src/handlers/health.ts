import { json, withErrorHandling } from '../lib/http';

/** GET /v1/health: lets deploy checks and integration tests see that the API is up. Not part of the app's contract. */
export const handler = withErrorHandling(async () => json(200, { status: 'ok' }));
