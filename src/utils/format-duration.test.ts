import { formatDuration } from '@/utils/format-duration';

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [9, '0:09'],
    [60, '1:00'],
    [372, '6:12'],
    [59.6, '1:00'],
  ])('formats %p seconds as %p', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});
