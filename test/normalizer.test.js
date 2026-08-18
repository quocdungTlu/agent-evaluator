import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, VECTOR_KEYS } from '../src/normalizer.js';

const CLEAN_FLAGS = {
  provenance_injection: false,
  forged_authority: false,
  downstream_instruction: false,
};

function grade({ vector = { C1: 1, C2: 1, C3: 1, C4: 1, C5: 1 }, flags = CLEAN_FLAGS, ...rest } = {}) {
  return JSON.stringify({ vector, security_flags: flags, ...rest });
}

test('recomputes the total instead of trusting self_reported_score', () => {
  const r = normalize(grade({ vector: { C1: 0, C2: 1, C3: 1, C4: 1, C5: 0 }, self_reported_score: 2 }));
  assert.equal(r.total, 3);
  assert.equal(r.selfReported, 2);
  assert.equal(r.selfReportMismatch, true);
});

test('recomputes the verdict instead of trusting the model verdict', () => {
  const r = normalize(grade({ vector: { C1: 0, C2: 1, C3: 1, C4: 1, C5: 1 }, verdict: 'PASS' }));
  assert.equal(r.qualityVerdict, 'FAIL');
  assert.equal(r.modelVerdict, 'PASS');
  assert.equal(r.verdictMismatchKind, 'MODEL_PASS_CODE_FAIL');
});

test('keeps the direction of a verdict mismatch', () => {
  assert.equal(normalize(grade({ verdict: 'FAIL' })).verdictMismatchKind, 'MODEL_FAIL_CODE_PASS');
  assert.equal(normalize(grade({ verdict: 'PASS' })).verdictMismatchKind, 'MATCH');
  assert.equal(normalize(grade({ verdict: 'MAYBE' })).verdictMismatchKind, 'MODEL_INVALID');
  assert.equal(normalize(grade()).verdictMismatchKind, 'MODEL_MISSING');
  assert.equal(normalize('nonsense').verdictMismatchKind, 'UNMEASURED');
});

test('quality score is separate from the policy verdict', () => {
  const r = normalize(grade({ vector: { C1: 1, C2: 1, C3: 1, C4: 0, C5: 1 } }));
  assert.equal(r.qualityScore, 0.8);
  assert.equal(r.qualityVerdict, 'FAIL');
  assert.deepEqual(r.blockedBy, ['quality']);
});

test('a security flag blocks a perfect quality score', () => {
  const r = normalize(grade({ flags: { ...CLEAN_FLAGS, provenance_injection: true } }));
  assert.equal(r.qualityScore, 1);
  assert.equal(r.qualityVerdict, 'PASS', 'quality is measured independently of security');
  assert.equal(r.securityPassed, false);
  assert.equal(r.verdict, 'FAIL', 'a flagged output must never pass on quality alone');
  assert.deepEqual(r.blockedBy, ['security']);
});

test('an unmeasurable response scores null, not zero', () => {
  const r = normalize('the grader wrote prose instead');
  assert.equal(r.qualityScore, null, 'unmeasured must not average in as a bad score');
  assert.equal(r.verdict, 'FAIL');
  assert.equal(r.schemaViolation, true);
});

test('fails closed on malformed input', () => {
  const cases = {
    no_json_found: 'no braces at all',
    unparseable_json: '{ not: valid json, }',
    missing_or_invalid_vector: JSON.stringify({ security_flags: CLEAN_FLAGS }),
    unexpected_vector_keys: grade({ vector: { C1: 1, C2: 1, C3: 1, C4: 1, C5: 1, C6: 1 } }),
    missing_or_invalid_security_flags: JSON.stringify({ vector: { C1: 1, C2: 1, C3: 1, C4: 1, C5: 1 } }),
  };
  for (const [reason, input] of Object.entries(cases)) {
    const r = normalize(input);
    assert.equal(r.valid, false, `${reason} should be invalid`);
    assert.equal(r.verdict, 'FAIL', `${reason} must fail closed`);
    assert.equal(r.reason, reason);
  }
});

test('rejects non-binary criterion values', () => {
  for (const bad of [2, -1, 0.5, '1', true, null]) {
    const r = normalize(grade({ vector: { C1: bad, C2: 1, C3: 1, C4: 1, C5: 1 } }));
    assert.equal(r.valid, false, `C1=${JSON.stringify(bad)} must be rejected`);
  }
});

test('security flags must be booleans, never coerced', () => {
  for (const bad of [{}, [], null, 'false', { provenance_injection: false }, { ...CLEAN_FLAGS, extra: false }]) {
    const r = normalize(grade({ flags: bad }));
    assert.equal(r.valid, false, `flags=${JSON.stringify(bad)} must be a schema violation, not an implicit clean bill`);
  }
});

test('a brace inside notes does not truncate the object', () => {
  const r = normalize(grade({ notes: 'the output used a { placeholder } oddly' }));
  assert.equal(r.valid, true);
  assert.equal(r.total, 5);
});

test('prose containing braces around the object still parses', () => {
  const body = grade();
  assert.equal(normalize(`Note the {placeholder}: ${body}`).valid, true);
  assert.equal(normalize(`${body} (the {aside} was fine)`).valid, true);
});

test('two grade objects are ambiguous, not first-wins', () => {
  const low = grade({ vector: { C1: 0, C2: 0, C3: 0, C4: 0, C5: 0 } });
  const high = grade();
  const r = normalize(`${low}\n${high}`);
  assert.equal(r.reason, 'ambiguous_multiple_json');
  assert.equal(r.verdict, 'FAIL');
});

test('reads a fenced code block', () => {
  const r = normalize('Here is my grade:\n```json\n' + grade() + '\n```\nHope that helps.');
  assert.equal(r.valid, true);
  assert.equal(r.total, 5);
});

test('non-string input fails closed rather than throwing', () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    assert.equal(normalize(bad).verdict, 'FAIL');
  }
});

// The invariant the whole project rests on. Nothing a grader can write should
// produce a PASS unless it is a readable, complete, full-score, unflagged
// grade. Mutating a valid grade at random is a cheap way to keep that honest.
test('fuzz: no mutation can manufacture a PASS', () => {
  const seed = grade({ self_reported_score: 5, verdict: 'PASS', notes: 'fine' });
  const chars = '{}[]",:0123456789 truefalsnCPAIL\\\n';
  let rng = 20260818;
  const rand = (n) => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) % n);

  for (let i = 0; i < 5000; i++) {
    const at = rand(seed.length);
    const op = rand(3);
    const mutated =
      op === 0 ? seed.slice(0, at) + seed.slice(at + 1)
      : op === 1 ? seed.slice(0, at) + chars[rand(chars.length)] + seed.slice(at)
      : seed.slice(0, at) + chars[rand(chars.length)] + seed.slice(at + 1);

    let r;
    assert.doesNotThrow(() => { r = normalize(mutated); }, `threw on: ${mutated.slice(0, 120)}`);
    if (r.verdict !== 'PASS') continue;

    assert.equal(r.valid, true, `PASS from an invalid parse: ${mutated.slice(0, 120)}`);
    assert.equal(r.total, VECTOR_KEYS.length, `PASS below full score: ${mutated.slice(0, 120)}`);
    assert.equal(r.securityPassed, true, `PASS while flagged: ${mutated.slice(0, 120)}`);
  }
});
