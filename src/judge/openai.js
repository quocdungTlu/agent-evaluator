/**
 * OpenAI adapter.
 *
 * Uses fetch directly rather than the SDK: the whole adapter is one request
 * and one response shape, and a provider registry whose cost of entry is a
 * new dependency per provider is not much of a registry.
 *
 * The point of this adapter is not OpenAI specifically. It is that a judge
 * from a different vendor can grade output from Claude, which is the only way
 * to separate "the output was bad" from "the model preferred its own work".
 */
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export function createOpenAIJudge(config) {
  const model = config.model || process.env.OPENAI_MODEL || 'gpt-4.1-mini';

  return {
    provider: 'openai',
    requestedModel: model,

    async evaluate({ systemPrompt, messages }) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY is not set. Export it before running the evaluator.');

      const body = {
        model,
        messages: [...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []), ...messages],
        // Newer models reject max_tokens; older ones reject max_completion_tokens.
        // Send the current name and fall back once rather than guessing from
        // the model string, which would need editing every time one ships.
        max_completion_tokens: config.maxTokens ?? 1024,
      };

      let response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });

      if (response.status === 400) {
        const detail = await response.clone().text();
        if (detail.includes('max_completion_tokens')) {
          const { max_completion_tokens, ...rest } = body;
          response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ ...rest, max_tokens: max_completion_tokens }),
          });
        }
      }

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`OpenAI request failed (${response.status}): ${detail.slice(0, 300)}`);
      }

      const data = await response.json();
      const choice = data.choices?.[0];

      return {
        text: choice?.message?.content ?? '',
        requestedModel: model,
        // The API reports the concrete model it ran, which is not always the
        // alias asked for. Same reason as the Anthropic adapter: a baseline
        // compared across a silently repointed alias is not a baseline.
        resolvedModel: data.model,
        stopReason: choice?.finish_reason,
        usage: data.usage
          ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
          : null,
      };
    },
  };
}
