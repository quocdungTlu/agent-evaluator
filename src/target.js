import { createJudge } from './judge/index.js';

/**
 * The target agent — the system under test. It runs through the same provider
 * registry as the judge, so pointing the two at different models (the only
 * way to avoid grading a model with itself) is a manifest change.
 */
export function createTarget(config = {}, judgeConfig = {}) {
  const merged = {
    ...config,
    provider: config.provider ?? judgeConfig.provider ?? 'anthropic',
    model: config.model ?? process.env.TARGET_MODEL ?? judgeConfig.model,
  };
  const agent = createJudge(merged);

  return {
    provider: agent.provider,
    async generate(task) {
      return agent.evaluate({ systemPrompt: null, messages: [{ role: 'user', content: task }] });
    },
  };
}
