import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet } from 'react-native';

import { Spacing } from '@/constants/theme';

type VideoPreviewProps = {
  uri: string;
};

/**
 * Plays a local video with native controls.
 * Give it a `key` of the uri so a new player is created when the video changes.
 */
export function VideoPreview({ uri }: VideoPreviewProps) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.play();
  });

  return (
    <VideoView
      player={player}
      style={styles.video}
      nativeControls
      contentFit="contain"
      fullscreenOptions={{ enable: true }}
    />
  );
}

const styles = StyleSheet.create({
  video: {
    width: '100%',
    aspectRatio: 9 / 16,
    maxHeight: 480,
    borderRadius: Spacing.four,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
});
