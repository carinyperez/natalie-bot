/**
 * Stand-in for expo-audio in tests. Use it with:
 *
 *   jest.mock('expo-audio', () => require('@/test-utils/mock-expo-audio').expoAudioMock);
 *
 * Like the real useAudioPlayer, each mount gets its own player, released on unmount, and a released
 * player throws when used, so tests catch code that touches the player too late.
 */
import { useEffect, useState } from 'react';

function createFakePlayer() {
  let released = false;
  const assertNotReleased = () => {
    if (released) throw new Error('Cannot use shared object that was already released');
  };
  return {
    play: jest.fn(assertNotReleased),
    pause: jest.fn(assertNotReleased),
    replace: jest.fn((_source: string) => assertNotReleased()),
    release: jest.fn(() => {
      released = true;
    }),
  };
}

export type FakePlayer = ReturnType<typeof createFakePlayer>;

let players: FakePlayer[] = [];

/** The player created by the most recent useAudioPlayer mount. */
export function latestPlayer() {
  const player = players.at(-1);
  if (!player) throw new Error('useAudioPlayer has not been called');
  return player;
}

let status = { playing: false, didJustFinish: false };

/** Changes what useAudioPlayerStatus returns. Re-render to see it. */
export function setMockAudioStatus(next: Partial<typeof status>) {
  status = { ...status, ...next };
}

const setAudioModeAsync = jest.fn((_mode: object) => Promise.resolve());

/** The mocked setAudioModeAsync, to check the audio mode a hook asked for. */
export function mockSetAudioModeAsync() {
  return setAudioModeAsync;
}

export function resetMockAudio() {
  players = [];
  setAudioModeAsync.mockClear();
  status = { playing: false, didJustFinish: false };
}

export const expoAudioMock = {
  useAudioPlayer: () => {
    const [player] = useState(() => {
      const p = createFakePlayer();
      players.push(p);
      return p;
    });
    useEffect(() => () => player.release(), [player]);
    return player;
  },
  useAudioPlayerStatus: () => status,
  setAudioModeAsync,
};
