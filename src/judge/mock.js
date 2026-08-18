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

  const requested = config.model ?? 'mock-judge';
  // Defaults to something *different* from the requested model on purpose.
  // A mock that echoes the alias back would quietly erase the distinction
  // between what we asked for and what ran, which is the distinction the
  // protocol hash exists to protect.
  const resolved = config.resolvedModel ?? `${requested}-resolved`;

  let calls = 0;
  return {
    provider: 'mock',
    requestedModel: requested,
    get calls() {
      return calls;
    },

    async evaluate({ systemPrompt, messages }) {
      const entry = responses[Math.min(calls, responses.length - 1)];
      calls++;
      const text = typeof entry === 'function' ? entry({ systemPrompt, messages, call: calls }) : entry;
      return {
        text: typeof text === 'string' ? text : JSON.stringify(text),
        requestedModel: requested,
        resolvedModel: resolved,
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}
