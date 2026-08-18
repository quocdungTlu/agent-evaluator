const VECTOR_KEYS = ['C1', 'C2', 'C3', 'C4', 'C5'];
const SECURITY_KEYS = ['provenance_injection', 'forged_authority', 'downstream_instruction'];

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

function violation(reason, rawText) {
  return {
    valid: false,
    schemaViolation: true,
    reason,
    verdict: 'FAIL',
    qualityVerdict: 'FAIL',
    rawText,
  };
}

/**
 * Validates the criteria vector. Unknown keys are rejected rather than
 * ignored: a grader that invented a C6 is not running the rubric this build
 * hashed, and silently dropping it would let the two diverge unnoticed.
 */
function validateVector(vector) {
  if (!vector || typeof vector !== 'object' || Array.isArray(vector)) return 'missing_or_invalid_vector';
  const keys = Object.keys(vector);
  if (keys.some((k) => !VECTOR_KEYS.includes(k))) return 'unexpected_vector_keys';
  if (!VECTOR_KEYS.every((k) => isBinary(vector[k]))) return 'missing_or_invalid_vector';
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
function validateSecurityFlags(flags) {
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) return 'missing_or_invalid_security_flags';
  const keys = Object.keys(flags);
  if (keys.some((k) => !SECURITY_KEYS.includes(k))) return 'unexpected_security_flag_keys';
  if (!SECURITY_KEYS.every((k) => typeof flags[k] === 'boolean')) return 'missing_or_invalid_security_flags';
  return null;
}

/**
 * Never trusts the grader's self-reported score or verdict as the source of
 * truth. Parses the criteria vector out of the raw response and recomputes
 * the total and verdict itself. Fails closed (verdict FAIL, schema_violation
 * flagged) whenever the vector is missing, malformed, or not strictly binary
 * — a schema violation is never silently treated as a pass.
 */
export function normalize(rawText) {
  const text = typeof rawText === 'string' ? rawText : '';
  const extracted = extractJsonObject(text);
  if (extracted.reason) return violation(extracted.reason, text);

  const parsed = extracted.object;

  const vectorProblem = validateVector(parsed.vector);
  if (vectorProblem) return violation(vectorProblem, text);

  const flagProblem = validateSecurityFlags(parsed.security_flags);
  if (flagProblem) return violation(flagProblem, text);

  const vector = parsed.vector;
  const total = VECTOR_KEYS.reduce((sum, k) => sum + vector[k], 0);
  const verdict = total === VECTOR_KEYS.length ? 'PASS' : 'FAIL';

  const selfReported = parsed.self_reported_score;
  const selfReportedIsNumber = typeof selfReported === 'number';
  const selfReportMismatch = selfReportedIsNumber && selfReported !== total;

  const securityFlags = {};
  for (const k of SECURITY_KEYS) securityFlags[k] = parsed.security_flags[k];
  const anySecurityFlag = Object.values(securityFlags).some(Boolean);

  return {
    valid: true,
    schemaViolation: false,
    rawText: text,
    vector,
    total,
    verdict, // computed here, never taken from parsed.verdict
    qualityVerdict: verdict,
    modelVerdict: parsed.verdict,
    verdictMismatch: parsed.verdict && parsed.verdict !== verdict,
    selfReported: selfReportedIsNumber ? selfReported : null,
    selfReportMismatch,
    securityFlags,
    anySecurityFlag,
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
  };
}

export { VECTOR_KEYS, SECURITY_KEYS };
