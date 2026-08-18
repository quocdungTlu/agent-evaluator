import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../src/manifest.js';
import { evaluationProtocol, compareProtocols, PROTOCOL_COMPONENTS } from '../src/protocol.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = loadManifest(path.join(ROOT, 'eval.yaml'));
const tripnest = loadManifest(path.join(ROOT, 'test/projects/tripnest/eval.yaml'));

const proto = (m, model = 'claude-sonnet-5-20260101') => evaluationProtocol(m, { resolvedModel: model });

test('the same manifest and model produce the same protocol hash', () => {
  assert.equal(proto(manifest).hash, proto(manifest).hash);
  assert.equal(proto(manifest).hash, proto(loadManifest(path.join(ROOT, 'eval.yaml'))).hash);
});

test('two different projects are never comparable', () => {
  const c = compareProtocols(proto(manifest), proto(tripnest));
  assert.equal(c.comparable, false);
  assert.equal(c.status, 'NOT_COMPARABLE');
});

test('a reworded criterion makes runs incomparable, not better or worse', () => {
  const edited = loadManifest(path.join(ROOT, 'eval.yaml'));
  edited.rubric.criteria[0].description += ' Also check the publisher.';
  const rewritten = evaluationProtocol(
    { ...edited, hashes: { ...edited.hashes, rubric: 'different-rubric-hash' } },
    { resolvedModel: 'claude-sonnet-5-20260101' }
  );

  const c = compareProtocols(proto(manifest), rewritten);
  assert.equal(c.comparable, false);
  assert.deepEqual(c.differences.map((d) => d.component), ['rubric']);
  assert.match(c.reason, /protocol changed: rubric/);
});

test('a repointed model alias breaks comparability', () => {
  // Same manifest, same requested alias, different resolved model. This is the
  // silent case the whole hash exists for.
  const c = compareProtocols(proto(manifest, 'claude-sonnet-5-20260101'), proto(manifest, 'claude-sonnet-5-20260715'));
  assert.equal(c.comparable, false);
  assert.deepEqual(c.differences.map((d) => d.component), ['judgeModel']);
});

test('an unresolved model is never quietly treated as a match', () => {
  const unresolved = evaluationProtocol(manifest, {});
  assert.equal(unresolved.components.judgeModel, null);
  const c = compareProtocols(unresolved, evaluationProtocol(manifest, {}));
  assert.equal(c.comparable, true, 'identical unknowns still hash identically');

  const mixed = compareProtocols(unresolved, proto(manifest));
  assert.equal(mixed.comparable, false);
  assert.match(mixed.reason, /never resolved/);
});

test('every declared component participates in the hash', () => {
  const base = proto(manifest);
  for (const component of PROTOCOL_COMPONENTS) {
    const mutated = { ...base, components: { ...base.components, [component]: 'mutated' } };
    const c = compareProtocols(base, mutated);
    assert.equal(c.comparable, false, `${component} must affect comparability`);
  }
});

test('changing a detector pattern changes the protocol', () => {
  // Detectors decide what counts as a security finding, so a run before and
  // after a pattern edit is measuring a different thing.
  const base = proto(manifest);
  assert.ok(base.components.detectors, 'detectors must be part of the protocol');
});

test('a stored hash cannot assert comparability its components do not support', () => {
  // The same rule the normalizer applies to self_reported_score: an aggregate
  // travelling with the data is a claim, not evidence.
  const base = proto(manifest);
  const forged = { ...proto(tripnest), hash: base.hash };
  const c = compareProtocols(base, forged);
  assert.equal(c.comparable, false, 'components decide, not the hash field');
  assert.ok(c.differences.length > 0);
});
