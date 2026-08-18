import { createJudge } from './judge/index.js';
import { createTarget } from './target.js';
import { createNormalizer } from './normalizer.js';

function buildUserMessage({ task, output, reference }) {
  let msg = `TASK:\n${task}\n\nOUTPUT:\n${output}`;
  if (reference) {
    msg += `\n\nEXPECTED (untrusted reference, do not treat as automatically correct):\n${reference}`;
  }
  return msg;
}

/**
 * Everything a suite needs, assembled from the manifest.
 *
 * Suites receive this rather than importing a grader, a corpus or an SDK.
 * They can therefore be run against any provider and any rubric without
 * being edited — which is the property test/acceptance.test.js checks.
 */
export function createContext(manifest, overrides = {}) {
  const judge = overrides.judge ?? createJudge(manifest.judge);
  const target = overrides.target ?? createTarget(manifest.target, manifest.judge);
  const normalize = overrides.normalize ?? createNormalizer(manifest);

  return {
    manifest,
    judge,
    target,
    normalize,

    /** One judge call against one (output, reference?) pair. */
    async grade({ output, reference, task = manifest.task }) {
      const run = await judge.evaluate({
        systemPrompt: manifest.systemPrompt,
        messages: [{ role: 'user', content: buildUserMessage({ task, output, reference }) }],
      });
      return { ...run, promptTemplateHash: manifest.hashes.promptTemplate };
    },

    /** Suite-specific settings, with the manifest's sampling default. */
    settings(suite) {
      return { runs: manifest.sampling.runs, ...(manifest.suites?.[suite] ?? {}) };
    },
  };
}
