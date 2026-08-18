#!/usr/bin/env node
/**
 * One minimal judge call, with every failure mode named.
 *
 * Provider setup fails in ways that all look identical from a suite run --
 * a missing key, a key for the wrong org, a model the account cannot reach,
 * an exhausted quota and a blocked network all surface as "it didn't work".
 * This makes one request and says which one it was.
 *
 * It never prints the key. Length and prefix are enough to tell a truncated
 * paste from a missing export, which is the common case.
 */
import { loadManifest } from './manifest.js';
import { createJudge } from './judge/index.js';
import { createNormalizer } from './normalizer.js';

const KEY_ENV = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', mock: null };

function describeKey(name) {
  if (!name) return 'not required';
  const value = process.env[name];
  if (value === undefined) return `${name} is NOT SET in this process`;
  if (value === '') return `${name} is set but EMPTY`;
  const trimmed = value.trim();
  const notes = [];
  if (trimmed !== value) notes.push('has leading/trailing whitespace');
  if (/\s/.test(trimmed)) notes.push('CONTAINS WHITESPACE — a line-wrapped paste will corrupt it');
  return `${name} present: ${trimmed.length} chars, starts "${trimmed.slice(0, 8)}…", ends "…${trimmed.slice(-4)}"${
    notes.length ? ` — ${notes.join('; ')}` : ''
  }`;
}

async function main() {
  const manifestPath = process.argv[2] ?? 'eval.yaml';
  const manifest = loadManifest(manifestPath);
  const provider = manifest.judge.provider ?? 'anthropic';

  console.log(`Manifest:  ${manifest.path}`);
  console.log(`Provider:  ${provider}`);
  console.log(`Model:     ${manifest.judge.model ?? '(adapter default)'}`);
  console.log(`Key:       ${describeKey(KEY_ENV[provider])}`);
  console.log(`Node:      ${process.version}`);
  console.log('');

  const judge = createJudge(manifest.judge);
  const normalize = createNormalizer(manifest);
  const fixture = manifest.fixtures[0];

  console.log(`Sending one grade request for fixture "${fixture.id}"…`);
  const started = Date.now();

  let run;
  try {
    run = await judge.evaluate({
      systemPrompt: manifest.systemPrompt,
      messages: [{ role: 'user', content: `TASK:\n${manifest.task}\n\nOUTPUT:\n${fixture.text}` }],
    });
  } catch (err) {
    console.log(`\nFAILED after ${Date.now() - started}ms`);
    console.log(`  ${err.message}`);
    const m = err.message;
    if (/401|invalid_api_key|Incorrect API key/i.test(m)) console.log('\n  -> The key was rejected. Wrong key, revoked, or wrong organisation.');
    else if (/404|model_not_found|does not exist/i.test(m)) console.log('\n  -> The account cannot reach that model. Try another in the manifest.');
    else if (/429|quota|rate.?limit/i.test(m)) console.log('\n  -> Rate limited or out of credit. This is billing, not code.');
    else if (/fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|timeout/i.test(m)) console.log('\n  -> Network never reached the provider. Proxy or firewall.');
    else if (/is not set/i.test(m)) console.log('\n  -> Export the key in the SAME command as the run; it does not persist between shells.');
    process.exit(2);
  }

  const elapsed = Date.now() - started;
  console.log(`\nOK in ${elapsed}ms`);
  console.log(`  requestedModel: ${run.requestedModel}`);
  console.log(`  resolvedModel:  ${run.resolvedModel}${run.resolvedModel === run.requestedModel ? '  (identical — alias not pinned by this provider)' : '  (differs — this is why we never trust the alias)'}`);
  console.log(`  stopReason:     ${run.stopReason}`);
  console.log(`  usage:          ${run.usage ? `${run.usage.inputTokens} in / ${run.usage.outputTokens} out` : 'NOT REPORTED'}`);

  const result = normalize(run.text);
  console.log('');
  if (result.schemaViolation) {
    console.log(`  Grade UNREADABLE: ${result.reason}`);
    console.log('  Raw response:');
    console.log(run.text.slice(0, 600).split('\n').map((l) => `    ${l}`).join('\n'));
    console.log('\n  -> The adapter works; this provider formats its answer differently.');
    process.exit(1);
  }

  console.log(`  Grade parsed:   vector ${JSON.stringify(result.vector)}`);
  console.log(`  qualityScore:   ${result.qualityScore}  (${result.qualityVerdict})`);
  console.log(`  verdict:        ${result.verdict}  blockedBy=[${result.blockedBy.join(', ')}]`);
  console.log(`  selfReported:   ${result.selfReported}${result.selfReportMismatch ? '  MISMATCH — it miscounted its own vector' : ''}`);
  console.log(`  verdict match:  ${result.verdictMismatchKind}`);
  console.log('\nProvider verified end to end.');
}

main().catch((err) => {
  console.error(`\nUnexpected: ${err.stack}`);
  process.exit(2);
});
