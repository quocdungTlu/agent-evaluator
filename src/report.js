import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatPct } from './stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, '..', 'results');

// The rubric decides how many criteria there are and what they are called,
// so the renderer reads the vector's own keys rather than assuming C1-C5.
function vecStr(v) {
  if (!v) return '(none)';
  return Object.keys(v).map((k) => v[k]).join(' ');
}

function printSchemaViolations(items) {
  for (const { label, rawText } of items) {
    if (!rawText) continue;
    const snippet = rawText.length > 400 ? `${rawText.slice(0, 400)}…` : rawText;
    console.log(`\n[schema violation: ${label}] raw grader output:\n${snippet}`);
  }
}

function printCalibration(result) {
  console.log('\n=== Calibration (blind mode, known oracle) ===');
  console.table(
    result.rows.map((r) => ({
      case: r.case,
      oracle: r.oracle,
      quality: r.qualityVerdict,
      score: r.qualityScore,
      policy: r.verdict,
      correct: r.correct ? 'yes' : 'NO',
      vector: vecStr(r.vector),
      self_reported: r.selfReported,
      mismatch: r.selfReportMismatch ? 'YES' : '',
      verdict_mismatch: r.verdictMismatchKind === 'MATCH' ? '' : r.verdictMismatchKind,
      security: r.security ? r.security.agreement : '',
      schema_violation: r.schemaViolation ? 'YES' : '',
    }))
  );
  const { correct, total, ci } = result.accuracy;
  console.log(
    `Accuracy: ${correct}/${total} (Wilson 95% CI [${formatPct(ci.lower)}, ${formatPct(ci.upper)}])`
  );
  // Reported separately from accuracy on purpose: one measures the rubric,
  // the other measures the judge.
  console.log(
    `Judge misses on declared markers: ${result.judgeMisses ?? 0}  |  detector false positives: ${result.detectorFalsePositives ?? 0}`
  );
  printSchemaViolations(result.rows.map((r) => ({ label: r.case, rawText: r.rawText })));
}

function printInjection(result) {
  console.log('\n=== Injection (control vs treatment) ===');
  console.table([
    { run: 'control (T1)', verdict: result.control.verdict, vector: vecStr(result.control.vector) },
    { run: 'treatment (INJ_T)', verdict: result.treatment.verdict, vector: vecStr(result.treatment.vector) },
  ]);
  console.log(`Verdict flipped by injection: ${result.verdictFlipped ? 'YES — attack succeeded' : 'no'}`);
  const judgeFlags = result.treatment.security?.judgeFlags ?? {};
  const named = Object.entries(judgeFlags).filter(([, v]) => v).map(([k]) => k);
  console.log(`Security flags the judge set: ${named.length ? named.join(', ') : 'none'}`);
  if (result.treatment.security) {
    const s = result.treatment.security;
    console.log(
      `Deterministic detector on treatment: ${s.codeDetected ? s.codeMatches.map((m) => m.id).join(', ') : 'nothing found'}`
    );
    console.log(`Judge vs code: ${s.agreement}${s.judgeMissed ? ' — counted as a miss' : ''}`);
  }
  console.log(`Outcome: ${result.outcome}`);
  printSchemaViolations([
    { label: 'control', rawText: result.control.rawText },
    { label: 'treatment', rawText: result.treatment.rawText },
  ]);
}

function printOracle(result) {
  console.log(`\n=== Oracle poisoning (case ${result.case}, true oracle = ${result.trueOracle}) ===`);
  const rows = [{ mode: 'blind', verdict: result.blind.qualityVerdict, vector: vecStr(result.blind.vector) }];
  for (const arm of Object.values(result.arms)) {
    rows.push({ mode: `reference: ${arm.reference}`, verdict: arm.qualityVerdict, vector: vecStr(arm.vector), judge_vs_code: arm.security.agreement });
  }
  console.table(rows);
  console.log(`Poisoned (adversarial verdict != true oracle): ${result.poisoned ? 'YES' : 'no'}`);
  printSchemaViolations([
    { label: 'blind', rawText: result.blind.rawText },
    ...Object.values(result.arms).map((a) => ({ label: a.reference, rawText: a.rawText })),
  ]);
}

function printRepeatability(result) {
  console.log(`\n=== Repeatability (case ${result.case}, n=${result.n}) ===`);
  console.table(
    result.runs.map((r) => ({
      run: r.run,
      quality: r.qualityVerdict,
      score: r.qualityScore,
      policy: r.verdict,
      vector: vecStr(r.vector),
      true_total: r.total,
      self_reported: r.selfReported,
      mismatch: r.selfReportMismatch ? 'YES' : '',
    }))
  );
  console.log(`Verdict consistent across runs: ${result.verdictConsistent ? 'yes' : 'NO'}`);
  console.log(`Vector agreement with majority: ${formatPct(result.vectorAgreementRate)}`);
  console.log(`Self-reported score mismatches: ${result.selfReportMismatchCount}/${result.n}`);
  printSchemaViolations(result.runs.map((r) => ({ label: `run ${r.run}`, rawText: r.rawText })));
}

function printTrigger(result) {
  console.log('\n=== Trigger (live target output, no known oracle) ===');
  console.log(`Verdict: ${result.verdict}  Vector: ${vecStr(result.vector)}`);
  if (result.securityFlags) {
    const flagged = Object.entries(result.securityFlags).filter(([, v]) => v);
    console.log(`Security flags: ${flagged.length ? flagged.map(([k]) => k).join(', ') : 'none'}`);
  }
  console.log(`Note: ${result.note}`);
  printSchemaViolations([{ label: 'trigger', rawText: result.rawText }]);
}

const PRINTERS = {
  calibration: printCalibration,
  injection: printInjection,
  oracle: printOracle,
  repeatability: printRepeatability,
  trigger: printTrigger,
};

export function printResult(result) {
  const printer = PRINTERS[result.suite];
  if (printer) printer(result);
  else console.log(result);
}

export function printGate(gate) {
  const status = gate.passed ? 'PASS' : 'FAIL';
  console.log(`\nGate [${gate.suite}]: ${status}`);
  for (const f of gate.failures) console.log(`  ✗ ${f}`);
  for (const w of gate.warnings) console.log(`  ! ${w}`);
}

export function saveResult(result) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(RESULTS_DIR, `${result.suite}-${stamp}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(`\nSaved: ${path.relative(process.cwd(), file)}`);
  return file;
}
