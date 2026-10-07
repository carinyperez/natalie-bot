import { MAX_VIDEO_SECONDS } from '@shared/api';

describe('API contract', () => {
  it('limits videos to 90 seconds, per the product brief', () => {
    expect(MAX_VIDEO_SECONDS).toBe(90);
  });
});
