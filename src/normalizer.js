import { decide } from './policy.js';
import { criterionIds, securityFlagIds, totalWeight } from './rubric.js';

/**
 * Scans for every balanced top-level `{...}` region, tracking string literals
 * and escapes so a brace inside "notes" cannot end the object.
 *
 * The previous indexOf('{')..lastIndexOf('}') slice survived a brace inside
 * "notes", but broke whenever prose *around* the object carried one — a
 * leading "note the {placeholder}:" or a trailing aside both made the slice
 * unparseable, which failed closed as a schema violation. Safe, but it turns
 * a well-formed grade into a spurious FAIL, and a spurious FAIL is
 * indistinguishable from real judge instability in the repeatability suite.
 * A parser bug that corrupts the measurement is worse here than elsewhere.
 */
function balancedObjectRegions(text) {
  const regions = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth === 0) continue; // stray closer, no opener to match
      depth--;
      if (depth === 0) regions.push(text.slice(start, i + 1));
    }
  }
  return regions;
}

/**
 * Returns { object } on exactly one parseable JSON object, or { reason } on
 * none or several. Several is not a "take the first" situation: a response
 * carrying two grade objects has no single answer, and picking one lets
 * whichever object an attacker controls decide the outcome.
 */
function extractJsonObject(rawText) {
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : rawText;
  const regions = balancedObjectRegions(candidate);
  if (regions.length === 0) return { reason: 'no_json_found' };

  const parsed = [];
  for (const region of regions) {
    try {
      const value = JSON.parse(region);
      // Arrays and primitives cannot be a grade object; brace-balanced prose
      // like "{the} answer" lands here too and is correctly discarded.
      if (value && typeof value === 'object' && !Array.isArray(value)) parsed.push(value);
    } catch {
      /* not JSON — ignore this region */
    }
  }

  if (parsed.length === 0) return { reason: 'unparseable_json' };
  if (parsed.length > 1) return { reason: 'ambiguous_multiple_json' };
  return { object: parsed[0] };
}

function isBinary(value) {
  return value === 0 || value === 1;
}

function violation(reason, rawText, policy) {
  return {
    valid: false,
    schemaViolation: true,
    reason,
    // A response we could not read yields no quality measurement at all.
    // null, not 0 — "unmeasured" must not average in as a bad score.
    qualityScore: null,
    securityPassed: false,
    verdictMismatchKind: 'UNMEASURED',
    rawText,
    ...decide({ measured: false }, policy),
  };
}

/**
 * Classifies the model's own verdict against the recomputed one, keeping the
 * direction. A boolean loses the distinction that matters: a grader claiming
 * PASS over a vector that sums to FAIL is trying to loosen the gate, while
 * the reverse is a grader under-reporting its own scoring. They are different
 * failure modes and aggregate differently over many runs.
 *
 * Compared against the quality verdict, not the policy verdict — the grader
 * scores the rubric and is never told about the security gate, so holding it
 * to a decision it could not see would manufacture mismatches.
 */
function classifyVerdictMismatch(modelVerdict, qualityVerdict) {
  if (typeof modelVerdict !== 'string') return 'MODEL_MISSING';
  if (modelVerdict !== 'PASS' && modelVerdict !== 'FAIL') return 'MODEL_INVALID';
  if (modelVerdict === qualityVerdict) return 'MATCH';
  return modelVerdict === 'PASS' ? 'MODEL_PASS_CODE_FAIL' : 'MODEL_FAIL_CODE_PASS';
}

/**
 * Validates the criteria vector. Unknown keys are rejected rather than
 * ignored: a grader that invented a C6 is not running the rubric this build
 * hashed, and silently dropping it would let the two diverge unnoticed.
 */
function validateVector(vector, vectorKeys) {
  if (!vector || typeof vector !== 'object' || Array.isArray(vector)) return 'missing_or_invalid_vector';
  const keys = Object.keys(vector);
  if (keys.some((k) => !vectorKeys.includes(k))) return 'unexpected_vector_keys';
  if (!vectorKeys.every((k) => isBinary(vector[k]))) return 'missing_or_invalid_vector';
  return null;
}

/**
 * Validates the security flag block. Absent or wrong-typed flags are a schema
 * violation, not an implicit false.
 *
 * This used to coerce with `!!flags.provenance_injection`, which made the
 * whole block fail *open* — the one direction the rest of the normalizer
 * refuses to fail. A grader that omits the block is a grader whose security
 * opinion we did not receive, which is not the same as a grader reporting
 * that the output is clean.
 */
function validateSecurityFlags(flags, securityKeys) {
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) return 'missing_or_invalid_security_flags';
  const keys = Object.keys(flags);
  if (keys.some((k) => !securityKeys.includes(k))) return 'unexpected_security_flag_keys';
  if (!securityKeys.every((k) => typeof flags[k] === 'boolean')) return 'missing_or_invalid_security_flags';
  return null;
}

/**
 * Builds a normalizer bound to one rubric and policy.
 *
 * It knows how many criteria there are and what they weigh, and nothing about
 * what any of them mean. That is the whole point of the split: swapping in a
 * different project's rubric is a manifest change, not a code change.
 *
 * It still never trusts the grader's self-reported score or verdict. The
 * vector is parsed out of the raw response and the score recomputed here;
 * anything missing, malformed, or outside the declared shape fails closed.
 */
export function createNormalizer({ rubric, policy }) {
  const vectorKeys = criterionIds(rubric);
  const securityKeys = securityFlagIds(rubric);
  const weights = Object.fromEntries(rubric.criteria.map((c) => [c.id, c.weight]));
  const maxWeight = totalWeight(rubric);

  return function normalize(rawText) {
    const text = typeof rawText === 'string' ? rawText : '';
    const extracted = extractJsonObject(text);
    if (extracted.reason) return violation(extracted.reason, text, policy);

    const parsed = extracted.object;

    const vectorProblem = validateVector(parsed.vector, vectorKeys);
    if (vectorProblem) return violation(vectorProblem, text, policy);

    const flagProblem = validateSecurityFlags(parsed.security_flags, securityKeys);
    if (flagProblem) return violation(flagProblem, text, policy);

    const vector = parsed.vector;

    // Three layers, deliberately separate: the raw vector is the observation,
    // the quality score is the deterministic aggregate of it, and the verdict
    // is a policy decision over that score plus the security gate.
    const total = vectorKeys.reduce((sum, k) => sum + vector[k], 0);
    const earned = vectorKeys.reduce((sum, k) => sum + weights[k] * vector[k], 0);
    const qualityScore = earned / maxWeight;

    const selfReported = parsed.self_reported_score;
    const selfReportedIsNumber = typeof selfReported === 'number';
    // The grader is asked for a plain count of criteria scored 1, never a
    // weighted score — counting is the thing we want to catch it getting wrong.
    const selfReportMismatch = selfReportedIsNumber && selfReported !== total;

    const securityFlags = {};
    for (const k of securityKeys) securityFlags[k] = parsed.security_flags[k];
    const anySecurityFlag = Object.values(securityFlags).some(Boolean);
    const securityPassed = !anySecurityFlag;

    const decision = decide({ qualityScore, securityPassed }, policy);

    return {
      valid: true,
      schemaViolation: false,
      rawText: text,
      vector,
      total,
      maxTotal: vectorKeys.length,
      qualityScore,
      securityPassed,
      ...decision, // verdict, qualityVerdict, blockedBy
      modelVerdict: typeof parsed.verdict === 'string' ? parsed.verdict : null,
      verdictMismatchKind: classifyVerdictMismatch(parsed.verdict, decision.qualityVerdict),
      selfReported: selfReportedIsNumber ? selfReported : null,
      selfReportMismatch,
      securityFlags,
      anySecurityFlag,
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    };
  };
}
