import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { VideoPreview } from '@/components/video-preview';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { MAX_VIDEO_SECONDS, usePickVideo } from '@/hooks/use-pick-video';
import { useTheme } from '@/hooks/use-theme';

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
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedView style={styles.header}>
            <ThemedText type="subtitle">Natalie Bot</ThemedText>
            <ThemedText themeColor="textSecondary">
              Pick a video and we&apos;ll turn it into a reel with music.
            </ThemedText>
          </ThemedView>

          {video ? (
            <ThemedView style={styles.previewSection}>
              <VideoPreview key={video.uri} uri={video.uri} />
              <ThemedText type="small" themeColor="textSecondary">
                {video.fileName ?? 'Selected video'}
                {video.durationSeconds != null ? ` · ${formatDuration(video.durationSeconds)}` : ''}
              </ThemedText>
            </ThemedView>
          ) : (
            <ThemedView type="backgroundElement" style={styles.emptyState}>
              <ThemedText>No video selected yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Up to {MAX_VIDEO_SECONDS} seconds
              </ThemedText>
            </ThemedView>
          )}

          {error && (
            <ThemedText type="small" style={styles.error} accessibilityRole="alert">
              {error}
            </ThemedText>
          )}

          <Pressable
            onPress={pickVideo}
            disabled={isPicking}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.text, opacity: pressed || isPicking ? 0.7 : 1 },
            ]}>
            {isPicking ? (
              <ActivityIndicator color={theme.background} />
            ) : (
              <ThemedText style={{ color: theme.background }}>
                {video ? 'Choose a different video' : 'Choose a video'}
              </ThemedText>
            )}
          </Pressable>

          {video && (
            <Pressable onPress={clearVideo} accessibilityRole="button" style={styles.secondaryButton}>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.four,
  },
  header: {
    gap: Spacing.two,
  },
  previewSection: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.six,
    borderRadius: Spacing.four,
  },
  error: {
    color: '#D93025',
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    borderRadius: 26,
    paddingHorizontal: Spacing.four,
  },
  secondaryButton: {
    alignSelf: 'center',
    padding: Spacing.two,
  },
});
