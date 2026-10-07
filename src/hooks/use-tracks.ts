import { useCallback, useEffect, useRef, useState } from 'react';

import { getApiClient } from '@/api/client';
import type { Track } from '@shared/api';

export const LOAD_TRACKS_ERROR = "We couldn't load the music. Check your connection and try again.";

/** Loads the music tracks on mount. `reload` tries again after a failure. */
export function useTracks() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Only the latest request may set state, so a slow earlier one can't overwrite it or update after unmount.
  const latestRequest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++latestRequest.current;
    setIsLoading(true);
    setError(null);
    try {
      const { tracks } = await getApiClient().listTracks();
      if (request === latestRequest.current) setTracks(tracks);
    } catch {
      if (request === latestRequest.current) setError(LOAD_TRACKS_ERROR);
    } finally {
      if (request === latestRequest.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    return () => {
      latestRequest.current++;
    };
  }, [reload]);

  return { tracks, error, isLoading, reload };
}
