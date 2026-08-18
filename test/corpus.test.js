import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../src/manifest.js';
import { detectInjectionMarkers } from '../src/detectors.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = loadManifest(path.join(ROOT, 'eval.yaml'));

test('the declared corpus invariant holds', () => {
  // Enforced at load time; this asserts the manifest actually declares it.
  const identical = manifest.fixtures.find((f) => f.id === 'INJ_C');
  const source = manifest.fixtures.find((f) => f.id === 'T1');
  assert.equal(identical.hash, source.hash, 'otherwise the control is not a control');
});

test('every fixture declares an oracle the judge is never shown', () => {
  for (const f of manifest.fixtures) {
    assert.ok(['PASS', 'FAIL'].includes(f.oracle), `${f.id} needs a binary oracle`);
    assert.equal(typeof f.expectDetection, 'boolean', `${f.id} must declare expectDetection`);
  }
});

test('the generated prompt never contains an oracle', () => {
  // The whole point of keeping oracle and reference apart. If an oracle ever
  // reaches the judge, blind calibration silently stops being blind.
  for (const f of manifest.fixtures) {
    assert.ok(!manifest.systemPrompt.includes(f.text.trim()), `${f.id} text leaked into the prompt`);
  }
  assert.ok(!/\boracle\b/i.test(manifest.systemPrompt), 'the prompt should not mention oracles at all');
});

// The corpus and the detectors have to agree, or every JUDGE_MISS number
// downstream is measuring the wrong thing. This is the check that keeps a
// newly added fixture from silently poisoning the miss rate.
test('declared detection matches what the detectors actually find', () => {
  for (const fixture of [...manifest.fixtures, ...manifest.references]) {
    const found = detectInjectionMarkers(fixture.text).detected;
    assert.equal(
      found,
      fixture.expectDetection,
      `${fixture.id}: declared expectDetection=${fixture.expectDetection} but detectors ${found ? 'fired' : 'stayed silent'}`
    );
  }
});

test('the adversarial reference carries a marker and the neutral one does not', () => {
  assert.equal(manifest.references.find((r) => r.id === 'adversarial').expectDetection, true);
  assert.equal(manifest.references.find((r) => r.id === 'neutral').expectDetection, false);
});

test('every suite references fixtures that exist', () => {
  assert.doesNotThrow(() => {
    manifest.suites.calibration.cases.forEach((id) => manifest.fixture(id));
    manifest.fixture(manifest.suites.injection.control);
    manifest.fixture(manifest.suites.injection.treatment);
    manifest.fixture(manifest.suites.oracle.case);
    manifest.suites.oracle.references.forEach((id) => manifest.reference(id));
    manifest.fixture(manifest.suites.repeatability.case);
  });
});
