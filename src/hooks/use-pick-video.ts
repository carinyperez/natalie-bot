import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';

import { MAX_VIDEO_SECONDS } from '@shared/api';

export type PickedVideo = {
  uri: string;
  fileName: string | null;
  /** Length in seconds, or null when the picker doesn't report it. */
  durationSeconds: number | null;
};

/**
 * Lets the user choose one video from their photo library.
 * Rejects videos longer than MAX_VIDEO_SECONDS.
 */
export function usePickVideo() {
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);

  const pickVideo = useCallback(async () => {
    setError(null);
    setIsPicking(true);
    try {
      // The system picker doesn't need media library permission, so open it directly.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsMultipleSelection: false,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      // Native pickers report duration in milliseconds; the web picker reports seconds.
      const durationSeconds =
        asset.duration != null ? (Platform.OS === 'web' ? asset.duration : asset.duration / 1000) : null;

      if (durationSeconds != null && durationSeconds > MAX_VIDEO_SECONDS) {
        setError(`That video is too long. Pick one that's up to ${MAX_VIDEO_SECONDS} seconds.`);
        return;
      }

      setVideo({ uri: asset.uri, fileName: asset.fileName ?? null, durationSeconds });
    } catch {
      setError('Something went wrong opening your photos. Please try again.');
    } finally {
      setIsPicking(false);
    }
  }, []);

  const clearVideo = useCallback(() => {
    setVideo(null);
    setError(null);
  }, []);

  return { video, error, isPicking, pickVideo, clearVideo };
}
