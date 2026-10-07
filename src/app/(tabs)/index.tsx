import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { VideoPreview } from '@/components/video-preview';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { usePickVideo } from '@/hooks/use-pick-video';
import { useSelectedTrack } from '@/hooks/use-selected-track';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration } from '@/utils/format-duration';
import { MAX_VIDEO_SECONDS } from '@shared/api';

export default function HomeScreen() {
  const theme = useTheme();
  const { video, error, isPicking, pickVideo, clearVideo } = usePickVideo();
  const { selectedTrack, setSelectedTrack } = useSelectedTrack();

  /** Starts over: drops the video and the music chosen for it. Picking a different video keeps the music. */
  function startOver() {
    clearVideo();
    setSelectedTrack(null);
  }

  return (
    <ThemedView className="flex-1 flex-row justify-center">
      <SafeAreaView style={{ flex: 1, maxWidth: MaxContentWidth }}>
        <ScrollView
          contentContainerClassName="grow gap-6 px-6 pt-8"
          contentContainerStyle={{ paddingBottom: BottomTabInset + Spacing.four }}>
          <ThemedView className="gap-2">
            <ThemedText type="subtitle">Natalie Bot</ThemedText>
            <ThemedText themeColor="textSecondary">
              Pick a video and we&apos;ll turn it into a reel with music.
            </ThemedText>
          </ThemedView>

          {video ? (
            <ThemedView className="items-center gap-2">
              <VideoPreview key={video.uri} uri={video.uri} />
              <ThemedText type="small" themeColor="textSecondary">
                {video.fileName ?? 'Selected video'}
                {video.durationSeconds != null ? ` · ${formatDuration(video.durationSeconds)}` : ''}
              </ThemedText>
            </ThemedView>
          ) : (
            <ThemedView
              type="backgroundElement"
              className="items-center justify-center gap-1 rounded-3xl py-16">
              <ThemedText>No video selected yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Up to {MAX_VIDEO_SECONDS} seconds
              </ThemedText>
            </ThemedView>
          )}

          {video && (
            <ThemedView
              type="backgroundElement"
              className="flex-row items-center gap-3 rounded-3xl py-3 pl-5 pr-3">
              <ThemedView type="backgroundElement" className="flex-1 gap-0.5">
                <ThemedText type="small" themeColor="textSecondary">
                  Music
                </ThemedText>
                <ThemedText>
                  {selectedTrack ? `${selectedTrack.title} · ${selectedTrack.artist}` : 'None chosen yet'}
                </ThemedText>
              </ThemedView>
              <Pressable
                onPress={() => router.push('/choose-track')}
                accessibilityRole="button"
                accessibilityLabel={selectedTrack ? 'Change music' : undefined}
                className="min-h-[44px] items-center justify-center rounded-full px-4 active:opacity-70"
                style={{ backgroundColor: theme.text }}>
                <ThemedText type="small" style={{ color: theme.background }}>
                  {selectedTrack ? 'Change' : 'Choose music'}
                </ThemedText>
              </Pressable>
              {selectedTrack && (
                <Pressable
                  onPress={() => setSelectedTrack(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Remove music"
                  className="min-h-[44px] items-center justify-center px-2 active:opacity-70">
                  <ThemedText type="small" themeColor="textSecondary">
                    Remove
                  </ThemedText>
                </Pressable>
              )}
            </ThemedView>
          )}

          {error && (
            <ThemedText type="small" themeColor="error" accessibilityRole="alert">
              {error}
            </ThemedText>
          )}

          <Pressable
            onPress={pickVideo}
            disabled={isPicking}
            accessibilityRole="button"
            accessibilityLabel={isPicking ? 'Opening your photos' : undefined}
            accessibilityState={{ disabled: isPicking, busy: isPicking }}
            className={`min-h-[52px] items-center justify-center rounded-full px-6 active:opacity-70 ${isPicking ? 'opacity-70' : ''}`}
            style={{ backgroundColor: theme.text }}>
            {isPicking ? (
              <ActivityIndicator color={theme.background} />
            ) : (
              <ThemedText style={{ color: theme.background }}>
                {video ? 'Choose a different video' : 'Choose a video'}
              </ThemedText>
            )}
          </Pressable>

          {video && (
            <Pressable onPress={startOver} accessibilityRole="button" className="self-center p-2">
              <ThemedText type="small" themeColor="textSecondary">
                Clear
              </ThemedText>
            </Pressable>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}
