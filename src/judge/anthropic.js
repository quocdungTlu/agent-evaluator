import Anthropic from '@anthropic-ai/sdk';

/**
 * Anthropic adapter. The only file in the project that imports the SDK —
 * suites, the normalizer and the policy have no idea which provider ran.
 */
export function createAnthropicJudge(config) {
  const model = config.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  let client;

  return {
    provider: 'anthropic',
    requestedModel: model,

    async evaluate({ systemPrompt, messages }) {
      if (!client) {
        if (!process.env.ANTHROPIC_API_KEY) {
          throw new Error('ANTHROPIC_API_KEY is not set. Export it before running the evaluator.');
        }
        client = new Anthropic();
      }

      const response = await client.messages.create({
        model,
        max_tokens: config.maxTokens ?? 1024,
        // A fixed-shape verdict is not open-ended reasoning; extended thinking
        // otherwise consumes the whole token budget before any visible text.
        thinking: { type: config.thinking === 'enabled' ? 'enabled' : 'disabled' },
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages,
      });

      const block = response.content.find((b) => b.type === 'text');
      return {
        text: block ? block.text : '',
        requestedModel: model,
        // Never the alias we asked for: an alias can be repointed server-side
        // without notice, and a baseline compared across that is meaningless.
        resolvedModel: response.model,
        stopReason: response.stop_reason,
        usage: response.usage
          ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
          : null,
      };
    },
  };
}
