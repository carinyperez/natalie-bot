import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet, View } from 'react-native';

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
    // VideoView is a third-party component, so the frame classes go on a wrapping View.
    <View className="aspect-[9/16] w-full max-w-[270px] overflow-hidden rounded-3xl bg-black">
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
      />
    </View>
  );
}
