import { createHash } from 'node:crypto';
import { DETECTORS } from './detectors.js';

/**
 * The evaluation protocol: everything that changes what a number means.
 *
 * Two runs are comparable only if all of it matches. This is the guard against
 * the most common way an eval system lies to its owner — someone edits a
 * criterion, the score goes up, and the dashboard reports an improvement.
 * A reworded rubric is a different measurement, not a better result.
 *
 * The resolved judge model is part of it deliberately. Requesting the same
 * alias proves nothing: an alias can be repointed server-side, and a delta
 * measured across that change is noise wearing a trend's clothing.
 */

export function detectorsHash() {
  const canonical = JSON.stringify(
    DETECTORS.map((d) => ({ id: d.id, class: d.class, pattern: d.pattern.source, flags: d.pattern.flags })).sort((a, b) => a.id.localeCompare(b.id))
  );
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

const COMPONENTS = ['rubric', 'promptTemplate', 'task', 'corpus', 'policy', 'detectors', 'judgeModel'];

/** Derives the protocol hash from its components. Never read from storage. */
export function protocolHashOf(components) {
  const canonical = COMPONENTS.map((k) => `${k}=${components?.[k] ?? 'unknown'}`).join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Component hashes for one run, plus the single hash derived from them. */
export function evaluationProtocol(manifest, { resolvedModel } = {}) {
  const components = {
    rubric: manifest.hashes.rubric,
    promptTemplate: manifest.hashes.promptTemplate,
    task: manifest.hashes.task,
    corpus: manifest.hashes.corpus,
    policy: manifest.hashes.policy,
    detectors: detectorsHash(),
    // Unknown until a call returns. Recorded as such rather than filled in
    // from config, which would be recording the question as the answer.
    judgeModel: resolvedModel ? createHash('sha256').update(resolvedModel, 'utf8').digest('hex') : null,
  };

  return {
    components,
    resolvedModel: resolvedModel ?? null,
    hash: protocolHashOf(components),
  };
}

/**
 * Decides whether two runs may be compared at all.
 *
 * Returns NOT_COMPARABLE with the components that differ, rather than a
 * direction. A delta across a changed protocol is not a smaller or larger
 * number — it is not a number about the same thing.
 */
export function compareProtocols(baseline, candidate) {
  if (!baseline || !candidate) {
    return { comparable: false, status: 'NOT_COMPARABLE', reason: 'missing protocol on one side', differences: [] };
  }
  // Recomputed from the components, never taken from the stored `hash`. An
  // artifact's protocol hash is a self-reported aggregate, and this project
  // does not accept those anywhere else either — a hand-edited or truncated
  // result file must not be able to assert its own comparability.
  const baselineHash = protocolHashOf(baseline.components);
  const candidateHash = protocolHashOf(candidate.components);
  if (baselineHash === candidateHash) {
    return { comparable: true, status: 'COMPARABLE', differences: [] };
  }

  const differences = COMPONENTS.filter((k) => baseline.components[k] !== candidate.components[k]).map((k) => ({
    component: k,
    baseline: baseline.components[k],
    candidate: candidate.components[k],
  }));

  const unknown = differences.some((d) => d.baseline === null || d.candidate === null);
  return {
    comparable: false,
    status: 'NOT_COMPARABLE',
    reason: unknown
      ? 'a protocol component was never resolved'
      : `protocol changed: ${differences.map((d) => d.component).join(', ')}`,
    differences,
  };
}

export { COMPONENTS as PROTOCOL_COMPONENTS };
