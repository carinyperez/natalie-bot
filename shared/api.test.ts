import { MAX_VIDEO_SECONDS } from '@shared/api';

describe('API contract', () => {
  it('limits videos to 5 minutes, per the AutoCut design', () => {
    expect(MAX_VIDEO_SECONDS).toBe(300);
  });
});
