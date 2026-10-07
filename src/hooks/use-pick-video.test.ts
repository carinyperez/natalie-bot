import { act, renderHook } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { usePickVideo } from '@/hooks/use-pick-video';

jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

const launchPicker = jest.mocked(ImagePicker.launchImageLibraryAsync);

/** Makes the picker return one video. `duration` is in the platform's unit: ms on native, seconds on web. */
function pickerReturns(duration: number | null) {
  launchPicker.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///clip.mov', fileName: 'clip.mov', duration } as ImagePicker.ImagePickerAsset],
  });
}

async function pick() {
  const { result } = await renderHook(() => usePickVideo());
  await act(() => result.current.pickVideo());
  return result.current;
}

afterEach(() => {
  launchPicker.mockReset();
  jest.restoreAllMocks(); // undoes jest.replaceProperty on Platform.OS
});

describe('usePickVideo', () => {
  it('accepts a 60-second video, converting native milliseconds to seconds', async () => {
    pickerReturns(60_000);
    const { video, error, isPicking } = await pick();
    expect(video).toEqual({ uri: 'file:///clip.mov', fileName: 'clip.mov', durationSeconds: 60 });
    expect(error).toBeNull();
    expect(isPicking).toBe(false);
  });

  it('accepts a video of exactly 90 seconds', async () => {
    pickerReturns(90_000);
    const { video } = await pick();
    expect(video?.durationSeconds).toBe(90);
  });

  it('rejects a video over 90 seconds', async () => {
    pickerReturns(91_000);
    const { video, error } = await pick();
    expect(video).toBeNull();
    expect(error).toBe("That video is too long. Pick one that's up to 90 seconds.");
  });

  it('reads the web picker duration as seconds', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    pickerReturns(91);
    const { video, error } = await pick();
    expect(video).toBeNull();
    expect(error).toMatch(/too long/);
  });

  it('accepts a video whose length is unknown', async () => {
    pickerReturns(null);
    const { video, error } = await pick();
    expect(video?.durationSeconds).toBeNull();
    expect(error).toBeNull();
  });

  it('does nothing when the picker is cancelled', async () => {
    launchPicker.mockResolvedValue({ canceled: true, assets: null });
    const { video, error, isPicking } = await pick();
    expect(video).toBeNull();
    expect(error).toBeNull();
    expect(isPicking).toBe(false);
  });

  it('shows an error when the picker fails', async () => {
    launchPicker.mockRejectedValue(new Error('boom'));
    const { video, error, isPicking } = await pick();
    expect(video).toBeNull();
    expect(error).toBe('Something went wrong opening your photos. Please try again.');
    expect(isPicking).toBe(false);
  });

  it('clears the video and error', async () => {
    pickerReturns(60_000);
    const { result } = await renderHook(() => usePickVideo());
    await act(() => result.current.pickVideo());
    await act(() => result.current.clearVideo());
    expect(result.current.video).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
