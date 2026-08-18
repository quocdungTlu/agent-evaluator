import { createAnthropicJudge } from './anthropic.js';
import { createMockJudge } from './mock.js';
import { createOpenAIJudge } from './openai.js';

/**
 * Provider registry. Adding a provider is a new file plus a line here — no
 * change to the normalizer, the suites, the policy or the gate. That is the
 * architectural claim this indirection exists to make good on, and
 * test/acceptance.test.js asserts it.
 */
const PROVIDERS = {
  anthropic: createAnthropicJudge,
  openai: createOpenAIJudge,
  mock: createMockJudge,
};

export function createJudge(config = {}) {
  const provider = config.provider ?? 'anthropic';
  const factory = PROVIDERS[provider];
  if (!factory) {
    throw new Error(`Unknown judge provider "${provider}". Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return factory(config);
}

export function availableProviders() {
  return Object.keys(PROVIDERS);
}
