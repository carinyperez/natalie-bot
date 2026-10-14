import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import type { Analysis } from './analyze';
import { AutocutError } from './errors';
import { buildPlanRequest, normalizePlan, planEdit, type PlanClient } from './plan';

/** A 40 s landscape video with a scene cut at 10 s and 25.2 s. `sheets` is filled in by tests that send them. */
const analysis: Analysis = {
  durationSeconds: 40,
  width: 1920,
  height: 1080,
  sheets: [],
  loudness: [],
  loudPeaks: [
    { second: 14, lufs: -8.1 },
    { second: 31, lufs: -12.4 },
  ],
  sceneCuts: [10, 25.2],
};

const seg = (startSeconds: number, endSeconds: number, cropCenterX = 0.5) => ({ startSeconds, endSeconds, cropCenterX });
const goodPlan = { segments: [seg(12, 18, 0.3), seg(28, 36, 0.6)], message: 'Kept the takedown and the escape, 14 s.' };

describe('normalizePlan', () => {
  it('accepts a valid plan as is', () => {
    expect(normalizePlan(goodPlan, analysis)).toEqual(goodPlan);
  });

  it('snaps cut points within 0.5 s onto a scene cut, and leaves others alone', () => {
    const { segments } = normalizePlan({ segments: [seg(10.3, 18), seg(25.6, 36.9)], message: 'm' }, analysis);
    expect(segments).toEqual([seg(10, 18), seg(25.2, 36.9)]);
  });

  it('pulls an end just past the video back to its last frame', () => {
    const { segments } = normalizePlan({ segments: [seg(27, 40.4)], message: 'm' }, analysis);
    expect(segments[0].endSeconds).toBe(40);
  });

  it.each([
    ['no segments', { segments: [], message: 'm' }, /no segments/],
    ['a missing message', { segments: [seg(12, 24)], message: '  ' }, /no message/],
    ['a segment well past the end', { segments: [seg(30, 45)], message: 'm' }, /ends after the video/],
    ['overlapping segments', { segments: [seg(12, 20), seg(18, 26)], message: 'm' }, /overlap/],
    ['a crop outside the frame', { segments: [seg(12, 24, 1.2)], message: 'm' }, /cropCenterX/],
    ['a segment under 1.5 s', { segments: [seg(12, 13), seg(20, 31)], message: 'm' }, /shorter than 1.5/],
    ['a reel under 10 s', { segments: [seg(12, 18)], message: 'm' }, /at least 10/],
    ['a segment that is not an object', { segments: [null], message: 'm' }, /not an object/],
    ['something that is not a plan', 'sorry', /no list of segments/],
  ])('rejects %s', (_name, raw, reason) => {
    expect(() => normalizePlan(raw, analysis)).toThrow(reason);
  });

  it('rejects a reel over 60 s', () => {
    const longVideo = { ...analysis, durationSeconds: 300 };
    expect(() => normalizePlan({ segments: [seg(0, 70)], message: 'm' }, longVideo)).toThrow(/at most 60/);
  });

  it('lets a video shorter than 10 s be used whole', () => {
    const short = { ...analysis, durationSeconds: 6, sceneCuts: [] };
    expect(normalizePlan({ segments: [seg(0, 6)], message: 'm' }, short).segments).toEqual([seg(0, 6)]);
  });
});

/** Two fake contact sheets on disk, so the request has images to read. */
async function analysisWithSheets(): Promise<Analysis> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'autocut-plan-test-'));
  const sheets = [
    { path: path.join(dir, 'sheet-001.jpg'), startSeconds: 0, endSeconds: 16 },
    { path: path.join(dir, 'sheet-002.jpg'), startSeconds: 16, endSeconds: 40 },
  ];
  await writeFile(sheets[0].path, 'first-sheet');
  await writeFile(sheets[1].path, 'second-sheet');
  return { ...analysis, sheets };
}

const textOf = (params: Anthropic.Beta.MessageCreateParamsNonStreaming) =>
  JSON.stringify(params.messages.map((m) => m.content));

describe('buildPlanRequest', () => {
  it('sends each sheet as a JPEG right after the seconds it covers', async () => {
    const params = await buildPlanRequest({ analysis: await analysisWithSheets(), prompt: 'just the takedowns' });
    const content = params.messages[0].content as Anthropic.Beta.BetaContentBlockParam[];

    expect(content[0]).toMatchObject({ type: 'text', text: expect.stringMatching(/^Sheet 1 of 2: seconds 0 to 15\./) });
    expect(content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('first-sheet').toString('base64') },
    });
    expect(content[2]).toMatchObject({ type: 'text', text: expect.stringMatching(/^Sheet 2 of 2: seconds 16 to 39\./) });
    expect(content[3]).toMatchObject({ type: 'image' });
  });

  it('gives the signals and the request, with the default prompt when empty', async () => {
    const withPrompt = textOf(await buildPlanRequest({ analysis, prompt: 'just the takedowns' }));
    expect(withPrompt).toContain('40.0 seconds long, 1920x1080');
    expect(withPrompt).toContain('14 s (-8.1 LUFS), 31 s (-12.4 LUFS)');
    expect(withPrompt).toContain('Scene cuts at: 10 s, 25.2 s');
    expect(withPrompt).toContain("The user's request: just the takedowns");

    expect(textOf(await buildPlanRequest({ analysis, prompt: '  ' }))).toContain("The user's request: AutoCut");
  });

  it('includes the current plan only on a refine', async () => {
    expect(textOf(await buildPlanRequest({ analysis, prompt: 'shorter' }))).not.toContain('current plan');
    const refine = textOf(await buildPlanRequest({ analysis, prompt: 'shorter', previousPlan: goodPlan }));
    expect(refine).toContain('12-18 s (cropCenterX 0.3), 28-36 s (cropCenterX 0.6)');
    expect(refine).toContain('Kept the takedown and the escape, 14 s.');
  });

  it('asks Opus 5.5 on Bedrock at medium effort for JSON matching the plan schema', async () => {
    const params = await buildPlanRequest({ analysis, prompt: 'AutoCut' });
    expect(params).toMatchObject({
      model: 'anthropic.claude-opus-5-5',
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
    });
    // Bedrock rejects the server-side fallback fields; refusals are handled by the client's middleware.
    expect(params).not.toHaveProperty('fallbacks');
    expect(params).not.toHaveProperty('betas');
  });

  it("uses Anthropic's model id and server-side refusal fallback for the 'anthropic' provider", async () => {
    const params = await buildPlanRequest({ analysis, prompt: 'AutoCut' }, 'anthropic');
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
    });
    const { schema } = params.output_config!.format as unknown as { schema: { required: string[] } };
    expect(schema.required).toEqual(['segments', 'message']);
  });
});

type Reply = { stop_reason?: string; text?: string };

/** A fake Claude that returns the given replies in order and records what it was sent. */
function fakeClient(replies: Reply[]) {
  // Snapshots, because planEdit appends to the same messages array for a retry.
  const calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const create = jest.fn(async (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => {
    calls.push(structuredClone(params));
    const reply = replies[calls.length - 1];
    return {
      stop_reason: reply.stop_reason ?? 'end_turn',
      content: reply.text === undefined ? [] : [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: reply.text }],
      usage: { input_tokens: 1000, output_tokens: 50 },
    };
  });
  return { client: { beta: { messages: { create } } } as unknown as PlanClient, calls };
}

describe('planEdit', () => {
  it('returns the plan from one call, with its token usage', async () => {
    const { client, calls } = fakeClient([{ text: JSON.stringify(goodPlan) }]);
    const result = await planEdit(client, { analysis, prompt: 'AutoCut' });

    expect(result).toEqual({ ...goodPlan, usage: { attempts: 1, inputTokens: 1000, outputTokens: 50 } });
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe('anthropic.claude-opus-5-5');
  });

  it('sends the request for the provider it is given', async () => {
    const { client, calls } = fakeClient([{ text: JSON.stringify(goodPlan) }]);
    await planEdit(client, { analysis, prompt: 'AutoCut' }, 'anthropic');
    expect(calls[0]).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default' });
  });

  it('retries once with the reason when the plan breaks a rule, and uses the corrected plan', async () => {
    const tooShort = { segments: [seg(12, 18)], message: 'Kept the takedown, 6 s.' };
    const { client, calls } = fakeClient([{ text: JSON.stringify(tooShort) }, { text: JSON.stringify(goodPlan) }]);
    const result = await planEdit(client, { analysis, prompt: 'AutoCut' });

    expect(result.segments).toEqual(goodPlan.segments);
    expect(result.usage).toEqual({ attempts: 2, inputTokens: 2000, outputTokens: 100 });
    // The retry carries the first reply back unchanged, then the reason.
    const retry = calls[1].messages;
    expect(retry).toHaveLength(3);
    expect(retry[1]).toMatchObject({ role: 'assistant', content: [{ type: 'thinking' }, { type: 'text' }] });
    expect(retry[2]).toMatchObject({ role: 'user', content: expect.stringMatching(/at least 10/) });
  });

  it('fails with plan_failed when the retry is still unusable', async () => {
    const { client, calls } = fakeClient([{ text: 'not json' }, { text: JSON.stringify({ segments: [], message: 'm' }) }]);
    const failure = planEdit(client, { analysis, prompt: 'AutoCut' });

    await expect(failure).rejects.toBeInstanceOf(AutocutError);
    await expect(failure).rejects.toMatchObject({ code: 'plan_failed', message: expect.stringMatching(/no segments/) });
    expect(calls).toHaveLength(2);
  });

  it('fails with plan_failed, without retrying, when the request is declined', async () => {
    const { client, calls } = fakeClient([{ stop_reason: 'refusal' }]);
    await expect(planEdit(client, { analysis, prompt: 'AutoCut' })).rejects.toMatchObject({ code: 'plan_failed' });
    expect(calls).toHaveLength(1);
  });

  it('treats a cut-off reply as a problem to retry', async () => {
    const { client, calls } = fakeClient([{ stop_reason: 'max_tokens', text: '{"segments": [' }, { text: JSON.stringify(goodPlan) }]);
    await expect(planEdit(client, { analysis, prompt: 'AutoCut' })).resolves.toMatchObject({ message: goodPlan.message });
    expect(calls).toHaveLength(2);
  });

  it('lets an API error through unchanged', async () => {
    const boom = new Error('rate limited');
    const client = { beta: { messages: { create: jest.fn().mockRejectedValue(boom) } } } as unknown as PlanClient;
    await expect(planEdit(client, { analysis, prompt: 'AutoCut' })).rejects.toBe(boom);
  });
});
