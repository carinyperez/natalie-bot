import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import Anthropic from '@anthropic-ai/sdk';
import { createPlanClient } from './plan-client';

describe('createPlanClient', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env, AWS_REGION: 'us-east-1', ANTHROPIC_API_KEY: 'test-key' };
  });
  afterEach(() => {
    process.env = env;
  });

  it('builds a Bedrock client by default, in the AWS_REGION, without needing credentials up front', () => {
    const client = createPlanClient();

    expect(client).toBeInstanceOf(AnthropicBedrockMantle);
    expect((client as AnthropicBedrockMantle).awsRegion).toBe('us-east-1');
    expect((client as AnthropicBedrockMantle).baseURL).toContain('bedrock-mantle.us-east-1');
    expect(typeof client.beta.messages.create).toBe('function');
  });

  it("builds an Anthropic API client for 'anthropic'", () => {
    const client = createPlanClient('anthropic');

    expect(client).toBeInstanceOf(Anthropic);
    expect(client).not.toBeInstanceOf(AnthropicBedrockMantle);
    expect((client as Anthropic).baseURL).toContain('api.anthropic.com');
  });
});
