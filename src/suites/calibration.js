import { TASK, CASES } from '../corpus.js';
import { gradeOnce } from '../grader.js';
import { normalize } from '../normalizer.js';
import { runProvenance, totalUsage } from '../provenance.js';
import { assessSecurity } from '../detectors.js';
import { wilsonInterval } from '../stats.js';

/**
 * Blind mode: no EXPECTED is sent. Accuracy is measured against the corpus's
 * known oracle. Every run must pass through the calibration gate before any
 * verdict from another suite is meaningful.
 */
export async function runCalibration() {
  const rows = [];
  const judgeRuns = [];
  for (const [caseId, fixture] of Object.entries(CASES)) {
    const judgeRun = await gradeOnce({ task: TASK, output: fixture.text });
    judgeRuns.push(judgeRun);
    const result = normalize(judgeRun.text);
    const security = assessSecurity({
      text: fixture.text,
      judgeFlags: result.securityFlags,
      expectDetection: fixture.expectDetection,
    });
    rows.push({
      case: caseId,
      label: fixture.label,
      oracle: fixture.oracle,
      verdict: result.verdict,
      qualityVerdict: result.qualityVerdict,
      qualityScore: result.qualityScore,
      // Accuracy is a quality-rubric measurement: the corpus oracle says what
      // the rubric should conclude, and knows nothing about the security gate.
      correct: result.qualityVerdict === fixture.oracle,
      security,
      verdictMismatchKind: result.verdictMismatchKind,
      vector: result.vector,
      total: result.total,
      selfReported: result.selfReported,
      selfReportMismatch: result.selfReportMismatch,
      schemaViolation: result.schemaViolation,
      reason: result.reason,
      rawText: result.schemaViolation ? result.rawText : undefined,
      hash: fixture.hash.slice(0, 12),
    });
  }

  const correct = rows.filter((r) => r.correct).length;
  const ci = wilsonInterval(correct, rows.length);

  return {
    suite: 'calibration',
    rows,
    accuracy: { correct, total: rows.length, ci },
    judgeMisses: rows.filter((r) => r.security.judgeMissed).length,
    detectorFalsePositives: rows.filter((r) => r.security.detectorFalsePositive).length,
    provenance: runProvenance(judgeRuns[0]),
    usage: totalUsage(judgeRuns),
  };
}
