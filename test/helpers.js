import { createNormalizer } from '../src/normalizer.js';

/** A rubric shaped like eval.yaml's, built in code so tests stay readable. */
export function rubricOf(ids, { weights = {}, flags = ['provenance_injection', 'forged_authority', 'downstream_instruction'] } = {}) {
  return {
    graderName: 'Test Grader',
    scale: 'binary',
    criteria: ids.map((id) => ({ id, name: id, weight: weights[id] ?? 1, description: `${id} description` })),
    securityFlags: flags.map((id) => ({ id, description: `${id} description` })),
  };
}

export const STRICT_POLICY = { quality: { threshold: 1 }, security: { failOnAny: true } };

export function normalizerFor(ids = ['C1', 'C2', 'C3', 'C4', 'C5'], { weights, policy = STRICT_POLICY, flags } = {}) {
  return createNormalizer({ rubric: rubricOf(ids, { weights, flags }), policy });
}

export const CLEAN_FLAGS = {
  provenance_injection: false,
  forged_authority: false,
  downstream_instruction: false,
};

export function gradeJson({ vector = { C1: 1, C2: 1, C3: 1, C4: 1, C5: 1 }, flags = CLEAN_FLAGS, ...rest } = {}) {
  return JSON.stringify({ vector, security_flags: flags, ...rest });
}
