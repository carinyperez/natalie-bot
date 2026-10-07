import { act, renderHook } from '@testing-library/react-native';

import { useTrackPreview } from '@/hooks/use-track-preview';
import { latestPlayer, mockSetAudioModeAsync, resetMockAudio, setMockAudioStatus } from '@/test-utils/mock-expo-audio';
import type { Track } from '@shared/api';

jest.mock('expo-audio', () => require('@/test-utils/mock-expo-audio').expoAudioMock);

const track = (id: string): Track => ({
  id,
  title: `Track ${id}`,
  artist: 'Artist',
  durationSeconds: 60,
  previewUrl: `https://example.com/${id}.mp3`,
});
const one = track('1');
const two = track('2');

afterEach(() => {
  resetMockAudio();
});

describe('useTrackPreview', () => {
  it('plays previews even when the iPhone silent switch is on', async () => {
    await renderHook(() => useTrackPreview());
    expect(mockSetAudioModeAsync()).toHaveBeenCalledWith(expect.objectContaining({ playsInSilentMode: true }));
  });

  it('plays a track preview', async () => {
    const { result } = await renderHook(() => useTrackPreview());
    await act(() => result.current.toggle(one));
    expect(latestPlayer().replace).toHaveBeenCalledWith(one.previewUrl);
    expect(latestPlayer().play).toHaveBeenCalledTimes(1);
    expect(result.current.playingId).toBe('1');
  });

  it('pauses the playing track, and resumes it without reloading', async () => {
    const { result } = await renderHook(() => useTrackPreview());
    await act(() => result.current.toggle(one));
    await act(() => result.current.toggle(one));
    expect(latestPlayer().pause).toHaveBeenCalledTimes(1);
    expect(result.current.playingId).toBeNull();

    await act(() => result.current.toggle(one));
    expect(latestPlayer().replace).toHaveBeenCalledTimes(1);
    expect(latestPlayer().play).toHaveBeenCalledTimes(2);
    expect(result.current.playingId).toBe('1');
  });

  it('plays only one track at a time, switching the shared player to the new one', async () => {
    const { result } = await renderHook(() => useTrackPreview());
    await act(() => result.current.toggle(one));
    await act(() => result.current.toggle(two));
    expect(latestPlayer().replace).toHaveBeenLastCalledWith(two.previewUrl);
    expect(result.current.playingId).toBe('2');
  });

  it('marks nothing as playing when the preview ends', async () => {
    const { result, rerender } = await renderHook(() => useTrackPreview());
    await act(() => result.current.toggle(one));
    setMockAudioStatus({ didJustFinish: true });
    await rerender({});
    expect(result.current.playingId).toBeNull();
  });

  it('stops playback on unmount, before the player is released', async () => {
    const { result, unmount } = await renderHook(() => useTrackPreview());
    await act(() => result.current.toggle(one));
    await unmount();
    expect(latestPlayer().pause).toHaveBeenCalledTimes(1);
    expect(latestPlayer().pause.mock.invocationCallOrder[0]).toBeLessThan(
      latestPlayer().release.mock.invocationCallOrder[0],
    );
  });
});
