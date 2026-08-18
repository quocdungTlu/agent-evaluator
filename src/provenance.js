/**
 * Provenance for one judge call. Everything here answers the same question:
 * is this run comparable to another one? A delta between two runs graded by
 * different resolved models, or under different grader instructions, is not
 * a regression — it is a different experiment.
 */
export function runProvenance(judgeRun) {
  return {
    requestedModel: judgeRun.requestedModel,
    resolvedModel: judgeRun.resolvedModel,
    promptTemplateHash: judgeRun.promptTemplateHash,
    stopReason: judgeRun.stopReason,
    usage: judgeRun.usage,
  };
}

/** Sums token usage across the judge calls a suite made. */
export function totalUsage(judgeRuns) {
  const runs = judgeRuns.filter((r) => r && r.usage);
  if (runs.length === 0) return null;
  return {
    calls: judgeRuns.length,
    inputTokens: runs.reduce((n, r) => n + r.usage.inputTokens, 0),
    outputTokens: runs.reduce((n, r) => n + r.usage.outputTokens, 0),
  };
}
