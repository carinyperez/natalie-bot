import { act, renderHook } from '@testing-library/react-native';

import { getApiClient } from '@/api/client';
import { LOAD_TRACKS_ERROR, useTracks } from '@/hooks/use-tracks';
import { ApiRequestError } from '@shared/api';

const serverError = () => new ApiRequestError(500, { error: { code: 'internal_error', message: 'boom' } });

beforeEach(() => {
  jest.useFakeTimers(); // the mock client waits 200 ms per call
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks(); // undoes jest.spyOn on the shared client
});

describe('useTracks', () => {
  it('starts loading, then returns the tracks', async () => {
    const { result } = await renderHook(() => useTracks());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.tracks).toEqual([]);

    await act(() => jest.advanceTimersByTimeAsync(200));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.tracks.map((t) => t.title)).toEqual(['Sunrise Drive', 'City Lights', 'Slow Burn']);
  });

  it('shows an error when the request fails, and reload recovers', async () => {
    jest.spyOn(getApiClient(), 'listTracks').mockRejectedValueOnce(serverError());
    const { result } = await renderHook(() => useTracks());
    await act(() => jest.advanceTimersByTimeAsync(0));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(LOAD_TRACKS_ERROR);
    expect(result.current.tracks).toEqual([]);

    await act(async () => {
      const reloading = result.current.reload();
      await jest.advanceTimersByTimeAsync(200);
      await reloading;
    });
    expect(result.current.error).toBeNull();
    expect(result.current.tracks).toHaveLength(3);
  });
});
