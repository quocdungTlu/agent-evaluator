/**
 * Scripted adapter. Exists so the full pipeline — suites, gate, report,
 * artifacts — can be exercised end to end with no API key and no network.
 *
 * That matters beyond convenience: the acceptance tests need to prove a
 * second project runs through this engine without editing core files, and a
 * test that needs a live judge to prove it would be measuring the judge.
 */
export function createMockJudge(config) {
  const responses = config.responses ?? [];
  if (responses.length === 0) throw new Error('mock judge needs a non-empty "responses" list');

  let calls = 0;
  return {
    provider: 'mock',
    requestedModel: config.model ?? 'mock-judge',
    get calls() {
      return calls;
    },

    async evaluate({ systemPrompt, messages }) {
      const entry = responses[Math.min(calls, responses.length - 1)];
      calls++;
      const text = typeof entry === 'function' ? entry({ systemPrompt, messages, call: calls }) : entry;
      return {
        text: typeof text === 'string' ? text : JSON.stringify(text),
        requestedModel: config.model ?? 'mock-judge',
        resolvedModel: config.resolvedModel ?? config.model ?? 'mock-judge-v0',
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}
