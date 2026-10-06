import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';

/** Longest video v1 accepts, per the product brief. */
export const MAX_VIDEO_SECONDS = 90;

export type PickedVideo = {
  uri: string;
  fileName: string | null;
  /** Length in seconds, or null when the picker doesn't report it. */
  durationSeconds: number | null;
};

/**
 * Lets the user choose one video from their photo library.
 * Handles the permission prompt and rejects videos longer than MAX_VIDEO_SECONDS.
 */
export function usePickVideo() {
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);

  const pickVideo = useCallback(async () => {
    setError(null);
    setIsPicking(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Natalie Bot needs access to your photos to pick a video. You can allow it in Settings.');
        return;
      }

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
        setError(
          `That video is ${Math.ceil(durationSeconds)} seconds. Pick one that's ${MAX_VIDEO_SECONDS} seconds or shorter.`,
        );
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
