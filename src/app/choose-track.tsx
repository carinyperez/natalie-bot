import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth } from '@/constants/theme';
import { useSelectedTrack } from '@/hooks/use-selected-track';
import { useTheme } from '@/hooks/use-theme';
import { useTrackPreview } from '@/hooks/use-track-preview';
import { useTracks } from '@/hooks/use-tracks';
import { formatDuration } from '@/utils/format-duration';
import type { Track } from '@shared/api';

export default function ChooseTrackScreen() {
  const theme = useTheme();
  const { tracks, error, isLoading, reload } = useTracks();
  const { playingId, toggle } = useTrackPreview();
  const { selectedTrack, setSelectedTrack } = useSelectedTrack();
  // Starts on the track already chosen, so changing it shows the current pick.
  const [selectedId, setSelectedId] = useState(selectedTrack?.id ?? null);
  const selected = tracks.find((t) => t.id === selectedId) ?? null;

  function confirmTrack() {
    if (!selected) return;
    setSelectedTrack(selected);
    router.back();
  }

  return (
    <ThemedView className="flex-1 flex-row justify-center">
      <SafeAreaView style={{ flex: 1, maxWidth: MaxContentWidth }}>
        <ThemedView className="gap-2 px-6 pb-4 pt-8">
          <ThemedText type="subtitle">Choose music</ThemedText>
          <ThemedText themeColor="textSecondary">Tap a track to pick it. Play to hear a preview.</ThemedText>
        </ThemedView>

        {isLoading ? (
          <ThemedView className="flex-1 items-center justify-center">
            <ActivityIndicator color={theme.text} accessibilityLabel="Loading tracks" />
          </ThemedView>
        ) : error ? (
          <ThemedView className="flex-1 items-center justify-center gap-4 px-6">
            <ThemedText themeColor="error" accessibilityRole="alert" className="text-center">
              {error}
            </ThemedText>
            <Pressable
              onPress={reload}
              accessibilityRole="button"
              className="min-h-[44px] items-center justify-center rounded-full px-6 active:opacity-70"
              style={{ backgroundColor: theme.backgroundElement }}>
              <ThemedText>Try again</ThemedText>
            </Pressable>
          </ThemedView>
        ) : (
          <FlatList
            data={tracks}
            keyExtractor={(track) => track.id}
            contentContainerClassName="gap-3 px-6 pb-4"
            renderItem={({ item }) => (
              <TrackRow
                track={item}
                isSelected={item.id === selectedId}
                isPlaying={item.id === playingId}
                onSelect={() => setSelectedId(item.id)}
                onTogglePreview={() => toggle(item)}
              />
            )}
          />
        )}

        <ThemedView className="px-6 pb-4 pt-2">
          <Pressable
            onPress={confirmTrack}
            disabled={!selected}
            accessibilityRole="button"
            accessibilityState={{ disabled: !selected }}
            className={`min-h-[52px] items-center justify-center rounded-full px-6 active:opacity-70 ${selected ? '' : 'opacity-40'}`}
            style={{ backgroundColor: theme.text }}>
            <ThemedText style={{ color: theme.background }}>Use this track</ThemedText>
          </Pressable>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

type TrackRowProps = {
  track: Track;
  isSelected: boolean;
  isPlaying: boolean;
  onSelect: () => void;
  onTogglePreview: () => void;
};

function TrackRow({ track, isSelected, isPlaying, onSelect, onTogglePreview }: TrackRowProps) {
  const theme = useTheme();
  const length = formatDuration(track.durationSeconds);

  return (
    <ThemedView
      type={isSelected ? 'backgroundSelected' : 'backgroundElement'}
      className="flex-row items-center gap-3 rounded-3xl border-2 py-2 pl-4 pr-2"
      style={{ borderColor: isSelected ? theme.text : 'transparent' }}>
      {/* The play button is a sibling, not a child, so screen readers can reach both. */}
      <Pressable
        onPress={onSelect}
        accessibilityRole="button"
        accessibilityLabel={`${track.title} by ${track.artist}, ${length}`}
        accessibilityState={{ selected: isSelected }}
        className="flex-1 gap-0.5 py-2 active:opacity-70">
        <ThemedText type={isSelected ? 'smallBold' : 'small'}>{track.title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {track.artist} · {length}
        </ThemedText>
      </Pressable>
      <Pressable
        onPress={onTogglePreview}
        accessibilityRole="button"
        accessibilityLabel={`${isPlaying ? 'Pause' : 'Play'} preview of ${track.title}`}
        className="min-h-[44px] min-w-[72px] items-center justify-center rounded-full px-4 active:opacity-70"
        style={{ backgroundColor: theme.background }}>
        <ThemedText type="small">{isPlaying ? 'Pause' : 'Play'}</ThemedText>
      </Pressable>
    </ThemedView>
  );
}
