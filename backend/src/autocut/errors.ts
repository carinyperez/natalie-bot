import type { JobErrorCode } from '@shared/api';

/**
 * Why an AutoCut step failed. The first two are also JobErrorCodes and go to the user as is.
 * - invalid_plan: the segments handed to render() break a rule (the processing handler maps this to plan_failed).
 * - ffmpeg_failed: ffmpeg itself failed on input it should handle (maps to processing_failed).
 */
export type AutocutErrorCode = Extract<JobErrorCode, 'video_too_long' | 'unsupported_format'> | 'invalid_plan' | 'ffmpeg_failed';

export class AutocutError extends Error {
  readonly code: AutocutErrorCode;

  constructor(code: AutocutErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AutocutError';
    this.code = code;
  }
}
