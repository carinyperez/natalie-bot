import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import Anthropic, { betaRefusalFallbackMiddleware } from '@anthropic-ai/sdk';
import type { PlanClient, PlanProvider } from './plan';

/** Tried when Claude Opus 5.5's safety classifiers decline a request on Bedrock, which has no server-side fallback. */
export const PLAN_FALLBACK_MODEL = 'anthropic.claude-opus-4-8';

/**
 * The client the planner uses.
 * - 'bedrock' (the app): Claude through Amazon Bedrock. No Anthropic key; access comes from AWS credentials
 *   (a profile or AWS_BEARER_TOKEN_BEDROCK locally, the Lambda's role when deployed) with access to both models.
 *   The region is AWS_REGION, else AWS_DEFAULT_REGION.
 * - 'anthropic' (local trials): Anthropic's API directly, with ANTHROPIC_API_KEY.
 */
export function createPlanClient(provider: PlanProvider = 'bedrock'): PlanClient {
  if (provider === 'anthropic') return new Anthropic();
  return new AnthropicBedrockMantle({
    middleware: [betaRefusalFallbackMiddleware([{ model: PLAN_FALLBACK_MODEL }])],
  });
}
