import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../src/manifest.js';
import { createContext } from '../src/context.js';
import { createJudge, availableProviders } from '../src/judge/index.js';
import { runCalibration } from '../src/suites/calibration.js';
import { runInjection } from '../src/suites/injection.js';
import { runOracle } from '../src/suites/oracle.js';
import { runRepeatability } from '../src/suites/repeatability.js';
import { runTrigger } from '../src/suites/trigger.js';
import { evaluateGate } from '../src/gate.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const TRIPNEST = path.join(ROOT, 'test/projects/tripnest/eval.yaml');

function sourceFiles(dir = SRC) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.js') ? [full] : [];
  });
}

/** Comments explain the boundary; only executable code can violate it. */
function code(file) {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const rel = (f) => path.relative(ROOT, f);

// ---------------------------------------------------------------------------
// Contract 1: a new project is data. No core file may know it exists.
// ---------------------------------------------------------------------------

test('a second project runs every suite without touching src/', async () => {
  const manifest = loadManifest(TRIPNEST);
  const ctx = createContext(manifest);

  const results = {
    calibration: await runCalibration(ctx),
    injection: await runInjection(ctx),
    oracle: await runOracle(ctx),
    repeatability: await runRepeatability(ctx),
    trigger: await runTrigger(ctx),
  };

  for (const [name, result] of Object.entries(results)) {
    assert.equal(result.suite, name);
    assert.doesNotThrow(() => evaluateGate(result), `${name} must produce a gate decision`);
  }

  // Its rubric is nothing like the reference project's: different ids,
  // different count, non-uniform weights, a lower threshold.
  const grounded = results.calibration.rows.find((r) => r.case === 'GROUNDED');
  assert.deepEqual(Object.keys(grounded.vector), ['PRICE_GROUNDED', 'NO_INVENTED_CONTACT', 'SCOPE', 'HONEST_UNCERTAINTY']);
  assert.equal(results.calibration.rows.find((r) => r.case === 'HOTLINE').qualityScore, 0.5);
});

test('no source file mentions any project-specific identifier', () => {
  const projectSpecific = [
    'PRICE_GROUNDED', 'NO_INVENTED_CONTACT', 'HONEST_UNCERTAINTY',
    'tripnest', 'Vinpearl', 'Bayesian',
    't1_fabricated', 'inj_c_control', 'oracle_adversarial',
    'GROUNDING', 'TASK FIT', 'CALIBRATION —',
  ];
  for (const file of sourceFiles()) {
    const body = code(file);
    for (const token of projectSpecific) {
      assert.ok(!body.includes(token), `${rel(file)} names "${token}" — that belongs in a manifest`);
    }
  }
});

test('no source file hardcodes a criterion or fixture id', () => {
  const CRITERION_LITERAL = /['"`](?:C[1-9]|T[1-9]|INJ_[A-Z]+)['"`]/;
  for (const file of sourceFiles()) {
    const m = code(file).match(CRITERION_LITERAL);
    assert.equal(m, null, `${rel(file)} hardcodes ${m?.[0]} — criteria and fixtures come from the manifest`);
  }
});

// ---------------------------------------------------------------------------
// Contract 2: a new judge provider is an adapter. Nothing else may change.
// ---------------------------------------------------------------------------

test('the SDK is imported in exactly one file', () => {
  const importers = sourceFiles().filter((f) => code(f).includes('@anthropic-ai/sdk'));
  assert.deepEqual(importers.map(rel), ['src/judge/anthropic.js']);
});

test('no suite, the normalizer, the policy or the gate reaches for a provider', () => {
  const core = sourceFiles().filter((f) => /suites|normalizer|policy|gate|detectors|protocol/.test(f));
  assert.ok(core.length >= 8, 'expected to be checking the whole core');
  for (const file of core) {
    const body = code(file);
    assert.ok(!/anthropic|openai|gemini/i.test(body), `${rel(file)} names a provider`);
    assert.ok(!body.includes("judge/"), `${rel(file)} imports a specific judge adapter`);
  }
});

test('a non-Anthropic judge drives the whole pipeline', async () => {
  const manifest = loadManifest(TRIPNEST);
  const ctx = createContext(manifest);
  assert.equal(ctx.judge.provider, 'mock');

  const result = await runCalibration(ctx);
  assert.ok(result.rows.every((r) => !r.schemaViolation), 'a scripted judge must parse like any other');
  assert.equal(result.provenance.requestedModel, 'mock-grader');
  assert.equal(result.provenance.resolvedModel, 'mock-grader-resolved', 'resolved is never assumed equal to requested');
});

test('an unknown provider fails loudly and lists what exists', () => {
  assert.throws(() => createJudge({ provider: 'not-a-provider' }), /Unknown judge provider/);
  assert.deepEqual(availableProviders(), ['anthropic', 'mock']);
});

// ---------------------------------------------------------------------------
// Contract 3: a new rubric is data. The prompt template is generated, not edited.
// ---------------------------------------------------------------------------

test('the grader prompt is generated from the rubric', () => {
  const reference = loadManifest(path.join(ROOT, 'eval.yaml'));
  const tripnest = loadManifest(TRIPNEST);

  for (const c of tripnest.rubric.criteria) {
    assert.ok(tripnest.systemPrompt.includes(c.id), `${c.id} missing from the generated prompt`);
    assert.ok(tripnest.systemPrompt.includes(c.description.trim()), `${c.id} description missing`);
  }
  for (const c of reference.rubric.criteria) {
    assert.ok(!tripnest.systemPrompt.includes(c.description.trim()), 'the other project leaked into this prompt');
  }
  assert.notEqual(reference.hashes.promptTemplate, tripnest.hashes.promptTemplate);
});

test('the threshold reaches the judge and the policy from one place', () => {
  const tripnest = loadManifest(TRIPNEST);
  assert.equal(tripnest.policy.quality.threshold, 0.75);
  // 0.75 of 8 total weight = 6, and the prompt says so in the judge's own terms.
  assert.match(tripnest.systemPrompt, /at least 6\.00 of the 8 total weight/);
});

test('a manifest mistake fails at load, not three suites later', () => {
  const bad = [
    ['unknown fixture in a suite', (m) => m.replace('cases: [GROUNDED, HOTLINE]', 'cases: [NOPE]')],
    ['duplicate criterion id', (m) => m.replace('id: SCOPE', 'id: PRICE_GROUNDED')],
    ['threshold out of range', (m) => m.replace('threshold: 0.75', 'threshold: 4')],
    ['non-binary scale', (m) => m.replace('scale: binary', 'scale: likert')],
  ];
  const source = readFileSync(TRIPNEST, 'utf8');
  for (const [label, mutate] of bad) {
    const file = path.join(ROOT, 'test/projects/tripnest', `.tmp-${label.replace(/\W+/g, '-')}.yaml`);
    writeFileSync(file, mutate(source));
    try {
      assert.throws(() => loadManifest(file), /Invalid manifest|invariant/, label);
    } finally {
      unlinkSync(file);
    }
  }
});
