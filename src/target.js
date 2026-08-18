import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.TARGET_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

let _client;
function client() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set. Export it before running the evaluator.');
    }
    _client = new Anthropic();
  }
  return _client;
}

/**
 * The "trigger & collect" stage the essay designed but never ran, because it
 * needed a real workspace API key. Here the target agent is just Claude
 * answering the task plainly — no oracle, no known-good answer. Output from
 * this path is live and non-deterministic; it belongs in the trigger suite,
 * never in the calibration corpus.
 */
export async function generateTargetOutput(task) {
  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: { type: 'disabled' },
    messages: [{ role: 'user', content: task }],
  });
  const block = response.content.find((b) => b.type === 'text');
  return {
    text: block ? block.text : '',
    requestedModel: MODEL,
    resolvedModel: response.model,
    stopReason: response.stop_reason,
    usage: response.usage
      ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
      : null,
  };
}
