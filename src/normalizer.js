const VECTOR_KEYS = ['C1', 'C2', 'C3', 'C4', 'C5'];

function extractJson(rawText) {
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : rawText;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return candidate.slice(start, end + 1);
}

function isBinary(value) {
  return value === 0 || value === 1;
}

/**
 * Never trusts the grader's self-reported score or verdict as the source of
 * truth. Parses the criteria vector out of the raw response and recomputes
 * the total and verdict itself. Fails closed (verdict FAIL, schema_violation
 * flagged) whenever the vector is missing, malformed, or not strictly binary
 * — a schema violation is never silently treated as a pass.
 */
export function normalize(rawText) {
  const jsonText = extractJson(rawText);
  if (!jsonText) {
    return {
      valid: false,
      schemaViolation: true,
      reason: 'no_json_found',
      verdict: 'FAIL',
      rawText,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      valid: false,
      schemaViolation: true,
      reason: 'unparseable_json',
      verdict: 'FAIL',
      rawText,
    };
  }

  const vector = parsed.vector;
  const vectorValid = vector && VECTOR_KEYS.every((k) => isBinary(vector[k]));
  if (!vectorValid) {
    return {
      valid: false,
      schemaViolation: true,
      reason: 'missing_or_invalid_vector',
      verdict: 'FAIL',
      rawText,
    };
  }

  const total = VECTOR_KEYS.reduce((sum, k) => sum + vector[k], 0);
  const verdict = total === VECTOR_KEYS.length ? 'PASS' : 'FAIL';

  const selfReported = parsed.self_reported_score;
  const selfReportedIsNumber = typeof selfReported === 'number';
  const selfReportMismatch = selfReportedIsNumber && selfReported !== total;

  const flags = parsed.security_flags || {};
  const securityFlags = {
    provenance_injection: !!flags.provenance_injection,
    forged_authority: !!flags.forged_authority,
    downstream_instruction: !!flags.downstream_instruction,
  };
  const anySecurityFlag = Object.values(securityFlags).some(Boolean);

  return {
    valid: true,
    schemaViolation: false,
    rawText,
    vector,
    total,
    verdict, // computed here, never taken from parsed.verdict
    modelVerdict: parsed.verdict,
    verdictMismatch: parsed.verdict && parsed.verdict !== verdict,
    selfReported: selfReportedIsNumber ? selfReported : null,
    selfReportMismatch,
    securityFlags,
    anySecurityFlag,
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
  };
}

export { VECTOR_KEYS };
