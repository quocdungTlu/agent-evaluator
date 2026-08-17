import { TASK, CASES } from '../corpus.js';
import { gradeOnce } from '../grader.js';
import { normalize } from '../normalizer.js';
import { wilsonInterval } from '../stats.js';

/**
 * Blind mode: no EXPECTED is sent. Accuracy is measured against the corpus's
 * known oracle. Every run must pass through the calibration gate before any
 * verdict from another suite is meaningful.
 */
export async function runCalibration() {
  const rows = [];
  for (const [caseId, fixture] of Object.entries(CASES)) {
    const raw = await gradeOnce({ task: TASK, output: fixture.text });
    const result = normalize(raw);
    rows.push({
      case: caseId,
      label: fixture.label,
      oracle: fixture.oracle,
      verdict: result.verdict,
      correct: result.verdict === fixture.oracle,
      vector: result.vector,
      total: result.total,
      selfReported: result.selfReported,
      selfReportMismatch: result.selfReportMismatch,
      schemaViolation: result.schemaViolation,
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
  };
}
