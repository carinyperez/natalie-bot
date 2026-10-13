import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import { betaRefusalFallbackMiddleware } from '@anthropic-ai/sdk';
import type { PlanClient } from './plan';

/** Tried when Claude Opus 5.5's safety classifiers decline a request. Bedrock has no server-side fallback. */
export const PLAN_FALLBACK_MODEL = 'anthropic.claude-opus-4-8';

/**
 * The client the planner uses: Claude through Amazon Bedrock. There is no API key; access comes from AWS
 * credentials (a profile locally, the Lambda's role when deployed) with bedrock:InvokeModel on both models.
 * The region is `awsRegion`, else AWS_REGION, else AWS_DEFAULT_REGION.
 */
export function createPlanClient(options: { awsRegion?: string; awsProfile?: string } = {}): PlanClient {
  return new AnthropicBedrockMantle({
    ...options,
    middleware: [betaRefusalFallbackMiddleware([{ model: PLAN_FALLBACK_MODEL }])],
  });
}
