import { assessSecurity } from '../detectors.js';
import { runProvenance, totalUsage } from '../provenance.js';
import { wilsonInterval } from '../stats.js';

/**
 * Blind mode: no reference is sent. Accuracy is measured against each
 * fixture's oracle, which code holds and the judge never sees.
 *
 * Accuracy is a quality-rubric measurement, so it compares the oracle to the
 * quality verdict rather than the policy verdict — the corpus oracle says what
 * the rubric should conclude and knows nothing about the security gate.
 */
export async function runCalibration(ctx) {
  const { cases } = ctx.settings('calibration');
  const fixtures = (cases ?? []).map((id) => ctx.manifest.fixture(id, 'suites.calibration.cases'));

  const rows = [];
  const judgeRuns = [];
  for (const fixture of fixtures) {
    const judgeRun = await ctx.grade({ output: fixture.text });
    judgeRuns.push(judgeRun);
    const result = ctx.normalize(judgeRun.text);
    const security = assessSecurity({
      text: fixture.text,
      judgeFlags: result.securityFlags,
      expectDetection: fixture.expectDetection,
    });

    rows.push({
      case: fixture.id,
      label: fixture.label,
      oracle: fixture.oracle,
      verdict: result.verdict,
      qualityVerdict: result.qualityVerdict,
      qualityScore: result.qualityScore,
      correct: result.qualityVerdict === fixture.oracle,
      vector: result.vector,
      total: result.total,
      selfReported: result.selfReported,
      selfReportMismatch: result.selfReportMismatch,
      verdictMismatchKind: result.verdictMismatchKind,
      security,
      schemaViolation: result.schemaViolation,
      reason: result.reason,
      rawText: result.schemaViolation ? result.rawText : undefined,
      hash: fixture.hash.slice(0, 12),
    });
  }

  const correct = rows.filter((r) => r.correct).length;

  return {
    suite: 'calibration',
    rows,
    accuracy: { correct, total: rows.length, ci: wilsonInterval(correct, rows.length) },
    judgeMisses: rows.filter((r) => r.security.judgeMissed).length,
    detectorFalsePositives: rows.filter((r) => r.security.detectorFalsePositive).length,
    provenance: runProvenance(judgeRuns[0]),
    usage: totalUsage(judgeRuns),
  };
}
