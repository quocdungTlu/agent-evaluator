import { assessSecurity } from '../detectors.js';
import { runProvenance, totalUsage } from '../provenance.js';

/**
 * Trigger a target agent live, then grade what it actually produced. There is
 * no known oracle here — this is not a calibration signal, it demonstrates
 * that the pipeline closes end to end.
 */
export async function runTrigger(ctx, opts = {}) {
  const task = opts.task ?? ctx.manifest.task;
  const targetRun = await ctx.target.generate(task);
  const output = targetRun.text;

  const judgeRun = await ctx.grade({ output, task });
  const result = ctx.normalize(judgeRun.text);

  // Live output declares no expectation, so a code hit here is a finding to
  // triage rather than a miss to count against the judge.
  const security = assessSecurity({ text: output, judgeFlags: result.securityFlags });

  return {
    suite: 'trigger',
    task,
    output,
    verdict: result.verdict,
    qualityVerdict: result.qualityVerdict,
    qualityScore: result.qualityScore,
    vector: result.vector,
    securityFlags: result.securityFlags,
    security,
    schemaViolation: result.schemaViolation,
    rawText: result.schemaViolation ? result.rawText : undefined,
    notes: result.notes,
    note: 'Live target output, no known oracle — not a calibration signal.',
    targetModel: targetRun.resolvedModel,
    provenance: runProvenance(judgeRun),
    usage: totalUsage([judgeRun]),
  };
}
