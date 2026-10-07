import type { Track } from '@shared/api';

/**
 * PLACEHOLDER until the "Royalty-free music library" task: that task replaces this module with a
 * database query and real presigned preview URLs. Nothing else should read this list directly; go
 * through listTracks() so the swap only touches this file.
 */
const PLACEHOLDER_TRACKS: readonly Track[] = [
  {
    id: 'placeholder-sunny-day',
    title: 'Sunny Day',
    artist: 'Placeholder Artist',
    durationSeconds: 92,
    previewUrl: 'https://example.com/previews/placeholder-sunny-day.mp3',
  },
  {
    id: 'placeholder-night-drive',
    title: 'Night Drive',
    artist: 'Placeholder Artist',
    durationSeconds: 118,
    previewUrl: 'https://example.com/previews/placeholder-night-drive.mp3',
  },
  {
    id: 'placeholder-good-vibes',
    title: 'Good Vibes',
    artist: 'Placeholder Artist',
    durationSeconds: 75,
    previewUrl: 'https://example.com/previews/placeholder-good-vibes.mp3',
  },
];

/** Every track a user can pick. Async because the real version will query the database. */
export async function listTracks(): Promise<Track[]> {
  return PLACEHOLDER_TRACKS.map((track) => ({ ...track }));
}
