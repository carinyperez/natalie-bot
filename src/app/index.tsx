import { ActivityIndicator, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { VideoPreview } from '@/components/video-preview';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { usePickVideo } from '@/hooks/use-pick-video';
import { useTheme } from '@/hooks/use-theme';
import { MAX_VIDEO_SECONDS } from '@shared/api';

function formatDuration(seconds: number) {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function HomeScreen() {
  const theme = useTheme();
  const { video, error, isPicking, pickVideo, clearVideo } = usePickVideo();

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
            <Pressable onPress={clearVideo} accessibilityRole="button" className="self-center p-2">
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
