// Screen tests live outside src/app, because every file in src/app is a route.
import { userEvent } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack } from 'expo-router';
import { act, renderRouter, screen } from 'expo-router/testing-library';

import { getApiClient } from '@/api/client';
import HomeScreen from '@/app/(tabs)/index';
import ChooseTrackScreen from '@/app/choose-track';
import { SelectedTrackProvider } from '@/hooks/use-selected-track';
import { latestPlayer, resetMockAudio } from '@/test-utils/mock-expo-audio';
import { ApiRequestError, type Track } from '@shared/api';

jest.mock('expo-audio', () => require('@/test-utils/mock-expo-audio').expoAudioMock);
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/components/video-preview', () => ({ VideoPreview: () => null }));

const TRACKS: Track[] = [
  { id: 'a', title: 'Sunrise Drive', artist: 'SoundHelix', durationSeconds: 372, previewUrl: 'https://x.test/a.mp3' },
  { id: 'b', title: 'City Lights', artist: 'Helix Two', durationSeconds: 65, previewUrl: 'https://x.test/b.mp3' },
];

function RootLayout() {
  return (
    <SelectedTrackProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </SelectedTrackProvider>
  );
}

let listTracks: jest.SpyInstance;

beforeEach(() => {
  listTracks = jest.spyOn(getApiClient(), 'listTracks').mockResolvedValue({ tracks: TRACKS });
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///clip.mov', fileName: 'clip.mov', duration: 30_000 } as ImagePicker.ImagePickerAsset],
  });
});

afterEach(() => {
  resetMockAudio();
  jest.restoreAllMocks(); // undoes jest.spyOn on the shared client
});

let app: ReturnType<typeof renderRouter>;

/** Renders the app on the home screen. */
async function renderApp() {
  // renderRouter attaches getPathname() to the promise RNTL v14's async render returns, and its
  // toHavePathname matcher looks for it on `screen`, where it isn't. So keep the promise and ask it.
  app = renderRouter({ _layout: RootLayout, index: HomeScreen, 'choose-track': ChooseTrackScreen });
  await app;
}

/** Renders the app on the home screen with a video already picked. */
async function renderHomeWithVideo() {
  await renderApp();
  await userEvent.press(screen.getByRole('button', { name: 'Choose a video' }));
  await screen.findByRole('button', { name: 'Choose a different video' });
}

/** Opens the track picker from home and waits for the tracks. */
async function openPicker() {
  await renderHomeWithVideo();
  await userEvent.press(screen.getByRole('button', { name: 'Choose music' }));
  await screen.findByText('Sunrise Drive');
}

const row = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title} by`) });

describe('ChooseTrackScreen', () => {
  it('shows a loading indicator, then each track with its title, artist and length', async () => {
    let resolve!: (value: { tracks: Track[] }) => void;
    listTracks.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await renderHomeWithVideo();
    await userEvent.press(screen.getByRole('button', { name: 'Choose music' }));
    expect(app.getPathname()).toBe('/choose-track');
    expect(screen.getByLabelText('Loading tracks')).toBeOnTheScreen();

    await act(async () => resolve({ tracks: TRACKS }));
    expect(screen.queryByLabelText('Loading tracks')).not.toBeOnTheScreen();
    expect(screen.getByText('Sunrise Drive')).toBeOnTheScreen();
    expect(screen.getByText('SoundHelix · 6:12')).toBeOnTheScreen();
    expect(screen.getByText('City Lights')).toBeOnTheScreen();
    expect(screen.getByText('Helix Two · 1:05')).toBeOnTheScreen();
  });

  it('shows an error when the tracks fail to load, and Try again recovers', async () => {
    listTracks.mockRejectedValueOnce(new ApiRequestError(500, { error: { code: 'internal_error', message: 'boom' } }));
    await renderHomeWithVideo();
    await userEvent.press(screen.getByRole('button', { name: 'Choose music' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load the music/);
    expect(screen.queryByText('Sunrise Drive')).not.toBeOnTheScreen();

    await userEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Sunrise Drive')).toBeOnTheScreen();
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
    expect(listTracks).toHaveBeenCalledTimes(2);
  });

  it('selects the tapped track, one at a time', async () => {
    await openPicker();
    const useButton = screen.getByRole('button', { name: 'Use this track' });
    expect(useButton).toBeDisabled();
    expect(row('Sunrise Drive')).not.toBeSelected();

    await userEvent.press(row('Sunrise Drive'));
    expect(row('Sunrise Drive')).toBeSelected();
    expect(useButton).toBeEnabled();

    await userEvent.press(row('City Lights'));
    expect(row('City Lights')).toBeSelected();
    expect(row('Sunrise Drive')).not.toBeSelected();
  });

  it('plays and pauses a preview, and playing another track switches to it', async () => {
    await openPicker();

    await userEvent.press(screen.getByRole('button', { name: 'Play preview of Sunrise Drive' }));
    expect(latestPlayer().replace).toHaveBeenLastCalledWith('https://x.test/a.mp3');
    expect(latestPlayer().play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Pause preview of Sunrise Drive' })).toBeOnTheScreen();

    await userEvent.press(screen.getByRole('button', { name: 'Play preview of City Lights' }));
    expect(latestPlayer().replace).toHaveBeenLastCalledWith('https://x.test/b.mp3');
    expect(screen.getByRole('button', { name: 'Pause preview of City Lights' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Play preview of Sunrise Drive' })).toBeOnTheScreen();

    await userEvent.press(screen.getByRole('button', { name: 'Pause preview of City Lights' }));
    expect(latestPlayer().pause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Play preview of City Lights' })).toBeOnTheScreen();
  });

  it('stops the preview when the user leaves the screen', async () => {
    await openPicker();
    await userEvent.press(screen.getByRole('button', { name: 'Play preview of Sunrise Drive' }));

    await act(() => router.back());
    expect(app.getPathname()).toBe('/');
    expect(latestPlayer().pause).toHaveBeenCalledTimes(1);
  });

  it('returns the chosen track to home with "Use this track", and preselects it when changing', async () => {
    await openPicker();
    await userEvent.press(row('City Lights'));
    await userEvent.press(screen.getByRole('button', { name: 'Use this track' }));

    expect(app.getPathname()).toBe('/');
    expect(screen.getByText('City Lights · Helix Two')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Choose music' })).not.toBeOnTheScreen();

    await userEvent.press(screen.getByRole('button', { name: 'Change music' }));
    await screen.findByText('Sunrise Drive');
    expect(row('City Lights')).toBeSelected();
  });
});

describe('HomeScreen music button', () => {
  it('appears only once a video is picked', async () => {
    await renderApp();
    expect(screen.queryByRole('button', { name: 'Choose music' })).not.toBeOnTheScreen();

    await userEvent.press(screen.getByRole('button', { name: 'Choose a video' }));
    expect(await screen.findByRole('button', { name: 'Choose music' })).toBeOnTheScreen();
  });
});
