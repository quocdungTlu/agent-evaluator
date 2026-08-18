import test from 'node:test';
import assert from 'node:assert/strict';
import { CASES, INJECTION, ORACLE_TEXT } from '../src/corpus.js';
import { detectInjectionMarkers } from '../src/detectors.js';

test('the injection control is byte-identical to T1', () => {
  assert.equal(INJECTION.control.hash, CASES.T1.hash, 'otherwise the control is not a control');
  assert.equal(INJECTION.control.text, CASES.T1.text);
});

test('every fixture declares an oracle the judge is never shown', () => {
  for (const [id, c] of Object.entries(CASES)) {
    assert.ok(['PASS', 'FAIL'].includes(c.oracle), `${id} needs a binary oracle`);
    assert.equal(typeof c.expectDetection, 'boolean', `${id} must declare expectDetection`);
  }
});

// The corpus and the detectors have to agree, or every JUDGE_MISS number
// downstream is measuring the wrong thing. This is the check that keeps a
// newly added fixture from silently poisoning the miss rate.
test('declared detection matches what the detectors actually find', () => {
  const all = [
    ...Object.entries(CASES).map(([id, c]) => [id, c]),
    ['INJ_C', INJECTION.control],
    ['INJ_T', INJECTION.treatment],
    ['ORACLE_NEUTRAL', ORACLE_TEXT.neutral],
    ['ORACLE_ADVERSARIAL', ORACLE_TEXT.adversarial],
  ];

  for (const [id, fixture] of all) {
    const found = detectInjectionMarkers(fixture.text).detected;
    assert.equal(
      found,
      fixture.expectDetection,
      `${id}: declared expectDetection=${fixture.expectDetection} but detectors ${found ? 'fired' : 'stayed silent'}`
    );
  }
});

test('the adversarial reference carries a marker and the neutral one does not', () => {
  assert.equal(ORACLE_TEXT.adversarial.expectDetection, true);
  assert.equal(ORACLE_TEXT.neutral.expectDetection, false);
});
