import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { buildSystemPrompt, rubricHash, hashText } from './rubric.js';

/**
 * Loads and validates an evaluation manifest.
 *
 * The manifest is trusted input — the operator writes it — which is why a
 * YAML parser is acceptable here and would not be acceptable on the judge's
 * response. Validation is still strict: a manifest mistake should surface as
 * a load error, not as a silently wrong measurement three suites later.
 */

function fail(msg) {
  throw new Error(`Invalid manifest: ${msg}`);
}

function requireArray(value, what) {
  if (!Array.isArray(value) || value.length === 0) fail(`${what} must be a non-empty list`);
  return value;
}

function validateRubric(rubric) {
  if (!rubric) fail('missing "rubric"');
  requireArray(rubric.criteria, 'rubric.criteria');
  const ids = new Set();
  for (const c of rubric.criteria) {
    if (!c.id) fail('every criterion needs an id');
    if (ids.has(c.id)) fail(`duplicate criterion id "${c.id}"`);
    ids.add(c.id);
    if (typeof c.description !== 'string' || !c.description.trim()) fail(`criterion ${c.id} needs a description`);
    if (typeof c.weight !== 'number' || !(c.weight > 0)) fail(`criterion ${c.id} needs a positive weight`);
    if (!c.name) c.name = c.id;
  }
  requireArray(rubric.securityFlags, 'rubric.securityFlags');
  for (const f of rubric.securityFlags) {
    if (!f.id) fail('every security flag needs an id');
    if (typeof f.description !== 'string' || !f.description.trim()) fail(`security flag ${f.id} needs a description`);
  }
  if (rubric.scale && rubric.scale !== 'binary') {
    // Weights belong in code; asking the judge for a graded 0-5 buys apparent
    // precision at the cost of repeatability, which is the one thing this
    // corpus exists to measure.
    fail(`unsupported rubric.scale "${rubric.scale}" — only "binary" is supported`);
  }
  if (!rubric.graderName) rubric.graderName = 'Grader';
  return rubric;
}

function validatePolicy(policy) {
  if (!policy) fail('missing "policy"');
  const threshold = policy.quality?.threshold;
  if (typeof threshold !== 'number' || threshold <= 0 || threshold > 1) {
    fail('policy.quality.threshold must be a number in (0, 1]');
  }
  if (typeof policy.security?.failOnAny !== 'boolean') fail('policy.security.failOnAny must be a boolean');
  return policy;
}

function loadFixture(dir, entry, what) {
  if (!entry.id) fail(`every ${what} needs an id`);
  if (!entry.file) fail(`${what} ${entry.id} needs a file`);
  const text = readFileSync(path.join(dir, entry.file), 'utf8');
  return {
    ...entry,
    text,
    hash: hashText(text),
    expectDetection: !!entry.expectDetection,
  };
}

function checkInvariants(invariants, byId) {
  for (const inv of invariants ?? []) {
    if (inv.type !== 'identical') fail(`unknown invariant type "${inv.type}"`);
    const [a, b] = requireArray(inv.fixtures, 'invariant.fixtures').map((id) => {
      const f = byId.get(id);
      if (!f) fail(`invariant references unknown fixture "${id}"`);
      return f;
    });
    if (a.hash !== b.hash) {
      throw new Error(
        `Corpus invariant broken: ${a.id} (${a.hash.slice(0, 12)}) is not identical to ${b.id} (${b.hash.slice(0, 12)})` +
          (inv.because ? ` — ${inv.because}` : '')
      );
    }
  }
}

export function loadManifest(manifestPath) {
  const resolved = path.resolve(manifestPath);
  const dir = path.dirname(resolved);
  const raw = parse(readFileSync(resolved, 'utf8'));
  if (!raw || typeof raw !== 'object') fail('file did not parse into an object');
  if (raw.version !== 1) fail(`unsupported version ${raw.version} (expected 1)`);
  if (typeof raw.task !== 'string' || !raw.task.trim()) fail('missing "task"');

  const rubric = validateRubric(raw.rubric);
  const policy = validatePolicy(raw.policy);

  const fixturesDir = path.join(dir, raw.fixturesDir ?? 'fixtures');
  const fixtures = requireArray(raw.fixtures, 'fixtures').map((f) => loadFixture(fixturesDir, f, 'fixture'));
  const references = (raw.references ?? []).map((r) => loadFixture(fixturesDir, r, 'reference'));

  const byId = new Map(fixtures.map((f) => [f.id, f]));
  const refById = new Map(references.map((r) => [r.id, r]));
  for (const f of fixtures) {
    if (f.oracle && !['PASS', 'FAIL'].includes(f.oracle)) fail(`fixture ${f.id} has a non-binary oracle "${f.oracle}"`);
  }
  checkInvariants(raw.invariants, byId);

  const suites = raw.suites ?? {};
  const resolveCase = (id, where) => {
    const f = byId.get(id);
    if (!f) fail(`${where} references unknown fixture "${id}"`);
    return f;
  };
  const resolveRef = (id, where) => {
    const r = refById.get(id);
    if (!r) fail(`${where} references unknown reference "${id}"`);
    return r;
  };

  const systemPrompt = buildSystemPrompt(rubric, policy);

  return {
    path: resolved,
    name: raw.name ?? path.basename(dir),
    task: raw.task.trim(),
    rubric,
    policy,
    judge: raw.judge ?? { provider: 'anthropic' },
    target: raw.target ?? { provider: 'anthropic' },
    sampling: { runs: 1, ...(raw.sampling ?? {}) },
    fixtures,
    references,
    fixture: (id, where = 'suite') => resolveCase(id, where),
    reference: (id, where = 'suite') => resolveRef(id, where),
    suites,
    systemPrompt,
    hashes: {
      rubric: rubricHash(rubric),
      promptTemplate: hashText(systemPrompt),
      task: hashText(raw.task.trim()),
      corpus: hashText(
        [...fixtures, ...references]
          .map((f) => `${f.id}:${f.hash}:${f.expectDetection}:${f.oracle ?? ''}`)
          .sort()
          .join('\n')
      ),
      policy: hashText(JSON.stringify(policy)),
    },
  };
}
