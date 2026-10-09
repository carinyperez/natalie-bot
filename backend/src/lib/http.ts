import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { ApiError, ApiErrorCode } from '@shared/api';

/** Status code for each error code. Every ApiErrorCode must have one. */
const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  validation_error: 400,
  prompt_too_long: 400,
  unauthorized: 401,
  not_found: 404,
  file_too_large: 413,
  video_too_long: 422,
  internal_error: 500,
};

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/** A JSON response for API Gateway's HTTP API (payload format 2.0). */
export function json<T>(statusCode: number, body: T): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

/** A non-2xx response in the ApiError envelope, with the status code that matches `code`. */
export function errorResponse(code: ApiErrorCode, message: string): APIGatewayProxyStructuredResultV2 {
  const body: ApiError = { error: { code, message } };
  return json(STATUS_BY_CODE[code], body);
}

/**
 * Runs a handler and turns anything it throws into a 500 internal_error, so callers never see a stack
 * trace or an API Gateway default error body. The real error goes to the logs.
 */
export function withErrorHandling<E>(
  handler: (event: E) => Promise<APIGatewayProxyStructuredResultV2>,
): (event: E) => Promise<APIGatewayProxyStructuredResultV2> {
  return async (event) => {
    try {
      return await handler(event);
    } catch (err) {
      console.error('Unhandled error', err);
      return errorResponse('internal_error', 'Something went wrong. Please try again.');
    }
  };
}
