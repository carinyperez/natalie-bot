import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import { createPlanClient } from './plan-client';

describe('createPlanClient', () => {
  it('builds a Bedrock client in the given region, without needing credentials up front', () => {
    const client = createPlanClient({ awsRegion: 'us-east-1' });

    expect(client).toBeInstanceOf(AnthropicBedrockMantle);
    expect((client as AnthropicBedrockMantle).awsRegion).toBe('us-east-1');
    expect((client as AnthropicBedrockMantle).baseURL).toContain('bedrock-mantle.us-east-1');
    expect(typeof client.beta.messages.create).toBe('function');
  });
});
