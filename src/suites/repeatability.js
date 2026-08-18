import { runProvenance, totalUsage } from '../provenance.js';
import { criterionIds } from '../rubric.js';

function majorityVector(vectors, keys) {
  // Runs with a schema violation have no vector to vote with — they don't
  // participate in the majority, but they still count against agreement
  // below since they can never match it.
  const present = vectors.filter(Boolean);
  if (present.length === 0) return null;
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
export async function runRepeatability(ctx, opts = {}) {
  const settings = ctx.settings('repeatability');
  const caseId = opts.caseId ?? settings.case;
  const n = opts.n ?? settings.runs ?? 3;
  const fixture = ctx.manifest.fixture(caseId, 'suites.repeatability.case');
  const keys = criterionIds(ctx.manifest.rubric);

  const runs = [];
  const judgeRuns = [];
  for (let i = 0; i < n; i++) {
    const judgeRun = await ctx.grade({ output: fixture.text });
    judgeRuns.push(judgeRun);
    const result = ctx.normalize(judgeRun.text);
    runs.push({
      run: i + 1,
      verdict: result.verdict,
      qualityVerdict: result.qualityVerdict,
      qualityScore: result.qualityScore,
      verdictMismatchKind: result.verdictMismatchKind,
      vector: result.vector,
      total: result.total,
      selfReported: result.selfReported,
      selfReportMismatch: result.selfReportMismatch,
      schemaViolation: result.schemaViolation,
      rawText: result.schemaViolation ? result.rawText : undefined,
    });
  }

  const verdicts = runs.map((r) => r.verdict);
  const majority = majorityVector(runs.map((r) => r.vector), keys);
  const vectorAgreementRate =
    runs.filter((r) => JSON.stringify(r.vector) === JSON.stringify(majority)).length / runs.length;

  return {
    suite: 'repeatability',
    case: caseId,
    n,
    runs,
    verdictConsistent: verdicts.every((v) => v === verdicts[0]),
    majorityVector: majority,
    vectorAgreementRate,
    selfReportMismatchCount: runs.filter((r) => r.selfReportMismatch).length,
    provenance: runProvenance(judgeRuns[0]),
    usage: totalUsage(judgeRuns),
  };
}
