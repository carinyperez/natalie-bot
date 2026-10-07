import { createContext, use, useState, type ReactNode } from 'react';

import type { Track } from '@shared/api';

type SelectedTrackContextValue = {
  selectedTrack: Track | null;
  setSelectedTrack: (track: Track | null) => void;
};

const SelectedTrackContext = createContext<SelectedTrackContextValue | null>(null);

/** Holds the music track chosen for the reel, shared by the home screen and the track picker. */
export function SelectedTrackProvider({ children }: { children: ReactNode }) {
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  return <SelectedTrackContext value={{ selectedTrack, setSelectedTrack }}>{children}</SelectedTrackContext>;
}

export function useSelectedTrack() {
  const value = use(SelectedTrackContext);
  if (!value) throw new Error('useSelectedTrack must be used inside SelectedTrackProvider');
  return value;
}
