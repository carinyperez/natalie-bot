import { MockApiClient } from '@/api/mock-api-client';
import type { ApiClient } from '@shared/api';

let client: ApiClient | null = null;

/** The app's one API client. Returns the in-memory mock until the backend exists. */
export function getApiClient(): ApiClient {
  client ??= new MockApiClient();
  return client;
}
