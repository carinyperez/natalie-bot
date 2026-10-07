/**
 * Stand-in for expo-audio in tests. Use it with:
 *
 *   jest.mock('expo-audio', () => require('@/test-utils/mock-expo-audio').expoAudioMock);
 *
 * Like the real useAudioPlayer, the mock releases its player on unmount, and a released player
 * throws when used, so tests catch code that touches the player too late.
 */
import { useEffect } from 'react';

let released = false;
function assertNotReleased() {
  if (released) throw new Error('Cannot use shared object that was already released');
}

export const mockPlayer = {
  play: jest.fn(assertNotReleased),
  pause: jest.fn(assertNotReleased),
  replace: jest.fn((_source: string) => assertNotReleased()),
  release: jest.fn(() => {
    released = true;
  }),
};

let status = { playing: false, didJustFinish: false };

/** Changes what useAudioPlayerStatus returns. Re-render to see it. */
export function setMockAudioStatus(next: Partial<typeof status>) {
  status = { ...status, ...next };
}

export function resetMockAudio() {
  released = false;
  status = { playing: false, didJustFinish: false };
  Object.values(mockPlayer).forEach((fn) => fn.mockClear());
}

export const expoAudioMock = {
  useAudioPlayer: () => {
    useEffect(() => () => mockPlayer.release(), []);
    return mockPlayer;
  },
  useAudioPlayerStatus: () => status,
};
