import { TASK, CASES } from '../corpus.js';
import { gradeOnce } from '../grader.js';
import { normalize } from '../normalizer.js';
import { runProvenance, totalUsage } from '../provenance.js';

function majorityVector(vectors) {
  // Runs with a schema violation have no vector to vote with — they don't
  // participate in the majority, but they still count against agreement
  // below since they can never match it.
  const present = vectors.filter(Boolean);
  if (present.length === 0) return null;
  const keys = ['C1', 'C2', 'C3', 'C4', 'C5'];
  const majority = {};
  for (const k of keys) {
    const ones = present.filter((v) => v[k] === 1).length;
    majority[k] = ones * 2 >= present.length ? 1 : 0;
  }
  return majority;
}

/**
 * Same byte-identical input, run N times in independent calls. Verdict
 * consistency and vector consistency are reported separately from
 * self-report consistency — the essay's central finding is that these three
 * can diverge even when the underlying vector doesn't change.
 */
export async function runRepeatability({ caseId = 'T1', n = 3 } = {}) {
  const fixture = CASES[caseId];
  if (!fixture) throw new Error(`Unknown case "${caseId}"`);

  const runs = [];
  const judgeRuns = [];
  for (let i = 0; i < n; i++) {
    const judgeRun = await gradeOnce({ task: TASK, output: fixture.text });
    judgeRuns.push(judgeRun);
    const result = normalize(judgeRun.text);
    runs.push({
      run: i + 1,
      verdict: result.verdict,
      vector: result.vector,
      total: result.total,
      selfReported: result.selfReported,
      selfReportMismatch: result.selfReportMismatch,
      schemaViolation: result.schemaViolation,
      rawText: result.schemaViolation ? result.rawText : undefined,
    });
  }

  const verdicts = runs.map((r) => r.verdict);
  const verdictConsistent = verdicts.every((v) => v === verdicts[0]);

  const majority = majorityVector(runs.map((r) => r.vector));
  const vectorMatchesMajority = runs.map(
    (r) => JSON.stringify(r.vector) === JSON.stringify(majority)
  );
  const vectorAgreementRate = vectorMatchesMajority.filter(Boolean).length / runs.length;

  const selfReportMismatchCount = runs.filter((r) => r.selfReportMismatch).length;

  return {
    suite: 'repeatability',
    case: caseId,
    n,
    runs,
    verdictConsistent,
    majorityVector: majority,
    vectorAgreementRate,
    selfReportMismatchCount,
    provenance: runProvenance(judgeRuns[0]),
    usage: totalUsage(judgeRuns),
  };
}
