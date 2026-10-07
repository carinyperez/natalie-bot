import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Track } from '@shared/api';

/**
 * Plays track previews through one shared player, so only one track plays at a time.
 * Playback stops when the component using this hook unmounts.
 */
export function useTrackPreview() {
  const playerRef = useRef<AudioPlayer | null>(null);
  // Must come before useAudioPlayer: React runs unmount cleanups in order, so this pauses the
  // player before useAudioPlayer releases it. Pausing a released player throws.
  useEffect(
    () => () => {
      playerRef.current?.pause();
    },
    [],
  );

  // iOS mutes expo-audio when the silent switch is on, which would make every preview silent.
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  /** The track whose preview is playing (or about to, while it buffers). */
  const [playingId, setPlayingId] = useState<string | null>(null);
  /** The track loaded into the player, so pausing and playing again resumes instead of restarting. */
  const loadedId = useRef<string | null>(null);

  // A preview that plays to the end is no longer playing.
  useEffect(() => {
    if (status.didJustFinish) {
      setPlayingId(null);
      loadedId.current = null;
    }
  }, [status.didJustFinish]);

  const toggle = useCallback(
    (track: Track) => {
      if (playingId === track.id) {
        player.pause();
        setPlayingId(null);
        return;
      }
      // Replacing the source stops whatever was playing before.
      if (loadedId.current !== track.id) {
        player.replace(track.previewUrl);
        loadedId.current = track.id;
      }
      player.play();
      setPlayingId(track.id);
    },
    [player, playingId],
  );

  return { playingId, toggle };
}
