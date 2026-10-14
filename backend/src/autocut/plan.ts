import { readFile } from 'node:fs/promises';
import type Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_PROMPT, type EditSegment } from '@shared/api';
import { SHEET_COLUMNS, SHEET_ROWS, type Analysis } from './analyze';
import { AutocutError } from './errors';
import { validateSegments } from './render';

/**
 * Where the planner reaches Claude Opus 5.5. The app uses Bedrock (no API key, AWS permissions only).
 * 'anthropic' calls Anthropic's API directly with ANTHROPIC_API_KEY, for trying the planner locally.
 */
export type PlanProvider = 'bedrock' | 'anthropic';

const PROVIDERS: Record<PlanProvider, Pick<MessageParams, 'model' | 'betas' | 'fallbacks'>> = {
  // Bedrock has no server-side refusal fallback; plan-client.ts registers the SDK's fallback middleware instead.
  bedrock: { model: 'anthropic.claude-opus-5-5' },
  // A request the safety classifiers decline is retried on another model, server-side.
  anthropic: { model: 'claude-opus-5-5', betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
};
/** Enough for picking moments from a few dozen frames; tune on real videos before changing the model. */
export const PLAN_EFFORT = 'medium';
const PLAN_MAX_TOKENS = 16_000;

/** A reel is this long unless the video itself is shorter. */
export const MIN_REEL_SECONDS = 10;
export const MAX_REEL_SECONDS = 60;
/** Shorter pieces read as glitches in a reel. */
export const MIN_PLAN_SEGMENT_SECONDS = 1.5;
/** A cut this close to a scene change moves onto it, so the reel never shows a sliver of the next shot. */
export const SNAP_SECONDS = 0.5;
const MAX_MESSAGE_CHARS = 200;

export type EditPlan = { segments: EditSegment[]; message: string };

export type PlanInput = {
  analysis: Analysis;
  /** What the user asked for. Empty means DEFAULT_PROMPT. */
  prompt: string;
  /** On a refine: the plan being adjusted. */
  previousPlan?: EditPlan;
};

export type PlanUsage = { attempts: number; inputTokens: number; outputTokens: number };

/** The part of the client planEdit uses (the Bedrock client has the same shape), so tests can pass a fake. */
export type PlanClient = { beta: { messages: Pick<Anthropic['beta']['messages'], 'create'> } };

type MessageParams = Anthropic.Beta.MessageCreateParamsNonStreaming;

const SYSTEM_PROMPT = `You are the editor inside AutoCut, an app that turns a raw video of up to 5 minutes into a short vertical reel for Instagram Reels and TikTok. You choose which parts of the video to keep. A renderer then cuts exactly those parts out, crops each to 9:16 and joins them in the order you list them.

What you are given:
- Contact sheets of the whole video: one frame per second, 16 frames per sheet in a 4x4 grid, read left to right and then top to bottom. The text before each sheet says which seconds it covers; the first tile is the first of those seconds and each next tile is one second later. Nothing is written on the frames themselves.
- The loudest seconds of the audio. In sports and events these are often reactions: a crowd, a shout, a whistle.
- The times where the picture cuts abruptly to a different shot.
- What the user asked for. "${DEFAULT_PROMPT}" means: make the best reel you can from this video.

How to choose:
- Aim for a reel of 15 to 30 seconds unless the user asks for a different length. Never go under ${MIN_REEL_SECONDS} or over ${MAX_REEL_SECONDS} seconds in total, except that a video shorter than ${MIN_REEL_SECONDS} seconds can be used whole.
- Keep the moments a viewer would rewatch: the action, its build-up and the reaction to it. Leave out waiting, setup and dead time. Open on something that earns attention in the first second.
- Each segment needs room to read: at least ${MIN_PLAN_SEGMENT_SECONDS} seconds, and usually 3 seconds or more. Start a moment a beat before it happens and end it a beat after. Segments must not overlap.
- List segments in the order they should play. Use the video's own order unless the user asks otherwise, for example "start with the best moment".
- Times are seconds from the start of the video and can be fractional. Do not go past the video's length.
- cropCenterX says where the middle of the 9:16 window sits across the frame, from 0 (left edge) to 1 (right edge). Put it on the subject of that segment so the action is not cut off; use 0.5 when the subject is centred or fills the frame. It is ignored when the video is already vertical.
- When the user is adjusting an earlier plan, change what they asked to change and keep the rest.

Also write "message": one short, plain sentence telling the user what you kept, ending with the reel's length, for example "Kept the two takedowns and the submission attempt, 24 s." If the user asked for something the video does not contain, make the closest good reel and say so in the message.`;

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          startSeconds: { type: 'number' },
          endSeconds: { type: 'number' },
          cropCenterX: { type: 'number' },
        },
        required: ['startSeconds', 'endSeconds', 'cropCenterX'],
        additionalProperties: false,
      },
    },
    message: { type: 'string' },
  },
  required: ['segments', 'message'],
  additionalProperties: false,
} as const;

/**
 * Asks Claude for an edit plan and checks it. A plan that breaks a rule gets one retry with the reason;
 * after that, or if the request is declined (by the model and its fallback, see plan-client.ts), throws
 * AutocutError 'plan_failed'.
 */
export async function planEdit(
  client: PlanClient,
  input: PlanInput,
  provider: PlanProvider = 'bedrock',
): Promise<EditPlan & { usage: PlanUsage }> {
  const params = await buildPlanRequest(input, provider);
  const usage: PlanUsage = { attempts: 0, inputTokens: 0, outputTokens: 0 };
  let problem = '';

  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await client.beta.messages.create(params);
    usage.attempts = attempt;
    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;

    if (response.stop_reason === 'refusal') {
      throw new AutocutError('plan_failed', 'The edit request was declined.');
    }
    try {
      if (response.stop_reason === 'max_tokens') throw new PlanProblem('The reply was cut off before the plan was complete.');
      return { ...normalizePlan(parsePlanText(response), input.analysis), usage };
    } catch (err) {
      if (!(err instanceof PlanProblem)) throw err;
      problem = err.message;
      // The reply goes back unchanged (thinking blocks included) so the model sees its own plan next to the problem.
      params.messages.push(
        { role: 'assistant', content: response.content as Anthropic.Beta.BetaContentBlockParam[] },
        { role: 'user', content: `That plan can't be used: ${problem} Send a corrected plan.` },
      );
    }
  }
  throw new AutocutError('plan_failed', `No usable plan after a retry: ${problem}`);
}

/** The request for one plan: the contact sheets with their seconds, the measured signals, and what the user asked. */
export async function buildPlanRequest(
  { analysis, prompt, previousPlan }: PlanInput,
  provider: PlanProvider = 'bedrock',
): Promise<MessageParams> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const [index, sheet] of analysis.sheets.entries()) {
    const lastSecond = Math.max(sheet.startSeconds, Math.ceil(sheet.endSeconds) - 1);
    content.push(
      {
        type: 'text',
        text:
          `Sheet ${index + 1} of ${analysis.sheets.length}: seconds ${sheet.startSeconds} to ${lastSecond}. ` +
          `${SHEET_COLUMNS} columns by ${SHEET_ROWS} rows, one frame per second, left to right then top to bottom.`,
      },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: (await readFile(sheet.path)).toString('base64') },
      },
    );
  }

  const peaks = analysis.loudPeaks.map((p) => `${p.second} s (${p.lufs} LUFS)`).join(', ');
  const lines = [
    `Video: ${analysis.durationSeconds.toFixed(1)} seconds long, ${analysis.width}x${analysis.height}.`,
    `Loudest seconds, loudest first: ${peaks || 'none (no audio track)'}.`,
    `Scene cuts at: ${analysis.sceneCuts.map((t) => `${t} s`).join(', ') || 'none'}.`,
  ];
  if (previousPlan) {
    const previous = previousPlan.segments
      .map((s) => `${s.startSeconds}-${s.endSeconds} s (cropCenterX ${s.cropCenterX})`)
      .join(', ');
    lines.push(`The current plan, which the user wants adjusted: ${previous}. It was described as: "${previousPlan.message}"`);
  }
  lines.push(`The user's request: ${prompt.trim() || DEFAULT_PROMPT}`);
  content.push({ type: 'text', text: lines.join('\n') });

  return {
    ...PROVIDERS[provider],
    max_tokens: PLAN_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    output_config: { effort: PLAN_EFFORT, format: { type: 'json_schema', schema: PLAN_SCHEMA } },
    messages: [{ role: 'user', content }],
  };
}

/** A plan the model can fix if told why. */
class PlanProblem extends Error {}

function parsePlanText(response: Anthropic.Beta.BetaMessage): unknown {
  const text = response.content.find((block) => block.type === 'text');
  if (!text || text.type !== 'text') throw new PlanProblem('The reply had no plan in it.');
  try {
    return JSON.parse(text.text);
  } catch {
    throw new PlanProblem('The reply was not valid JSON.');
  }
}

/**
 * Checks a plan against the video and the reel rules, and returns it with cut points snapped to nearby scene
 * cuts. Throws a PlanProblem (as an Error with a message the model can act on) when a rule is broken.
 */
export function normalizePlan(raw: unknown, analysis: Analysis): EditPlan {
  const plan = raw as Partial<EditPlan> | null;
  if (!plan || !Array.isArray(plan.segments)) throw new PlanProblem('It has no list of segments.');
  if (typeof plan.message !== 'string' || !plan.message.trim()) throw new PlanProblem('It has no message.');

  const duration = analysis.durationSeconds;
  const segments = plan.segments.map((s: Partial<EditSegment> | null, i) => {
    if (!s || typeof s !== 'object') throw new PlanProblem(`Segment ${i + 1} is not an object.`);
    const end = snap(s.endSeconds as number, analysis.sceneCuts);
    return {
      startSeconds: snap(s.startSeconds as number, analysis.sceneCuts),
      // A plan may round the last second up past a video that ends on a fraction: pull that back to the end.
      endSeconds: end > duration && end - duration <= SNAP_SECONDS ? duration : end,
      cropCenterX: s.cropCenterX as number,
    };
  });

  try {
    validateSegments(segments, duration);
  } catch (err) {
    if (err instanceof AutocutError && err.code === 'invalid_plan') throw new PlanProblem(err.message);
    throw err;
  }

  segments.forEach((s, i) => {
    if (s.endSeconds - s.startSeconds < MIN_PLAN_SEGMENT_SECONDS) {
      throw new PlanProblem(`Segment ${i + 1} is shorter than ${MIN_PLAN_SEGMENT_SECONDS} seconds.`);
    }
  });
  const total = segments.reduce((sum, s) => sum + (s.endSeconds - s.startSeconds), 0);
  const minimum = Math.min(MIN_REEL_SECONDS, duration);
  if (total < minimum - 1e-3) throw new PlanProblem(`The reel is ${total.toFixed(1)} seconds; it must be at least ${minimum.toFixed(1)}.`);
  if (total > MAX_REEL_SECONDS + 1e-3) throw new PlanProblem(`The reel is ${total.toFixed(1)} seconds; it must be at most ${MAX_REEL_SECONDS}.`);

  return { segments, message: plan.message.trim().slice(0, MAX_MESSAGE_CHARS) };
}

/** Moves `time` onto a scene cut within SNAP_SECONDS; leaves anything else, including non-numbers, alone. */
function snap(time: number, sceneCuts: number[]): number {
  if (!Number.isFinite(time)) return time;
  let nearest = time;
  let best = SNAP_SECONDS;
  for (const cut of sceneCuts) {
    const distance = Math.abs(cut - time);
    if (distance <= best) {
      best = distance;
      nearest = cut;
    }
  }
  return nearest;
}
