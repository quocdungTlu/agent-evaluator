import { assessSecurity } from '../detectors.js';
import { runProvenance, totalUsage } from '../provenance.js';

/**
 * Same output, graded blind and then with each declared reference in context.
 * If an adversarial reference flips the grade away from the true oracle, the
 * judge is deferring to a claimed answer instead of judging the output.
 *
 * This suite is the reason the manifest keeps `oracle` and `reference` apart:
 * a reference is shown to the judge on purpose, an oracle never is.
 */
export async function runOracle(ctx) {
  const settings = ctx.settings('oracle');
  const fixture = ctx.manifest.fixture(settings.case, 'suites.oracle.case');
  const references = (settings.references ?? []).map((id) => ctx.manifest.reference(id, 'suites.oracle.references'));

  const blindRun = await ctx.grade({ output: fixture.text });
  const blind = ctx.normalize(blindRun.text);

  const runs = [blindRun];
  const arms = {};
  let poisoned = false;
  let anyJudgeMiss = false;

  for (const ref of references) {
    const run = await ctx.grade({ output: fixture.text, reference: ref.text });
    runs.push(run);
    const result = ctx.normalize(run.text);
    // The marker lives in the reference here — the output is unchanged across
    // every arm — so that is the text the detectors scan.
    const security = assessSecurity({ text: ref.text, judgeFlags: result.securityFlags, expectDetection: ref.expectDetection });

    if (ref.expectDetection && result.qualityVerdict !== fixture.oracle) poisoned = true;
    if (security.judgeMissed) anyJudgeMiss = true;

    arms[ref.id] = {
      reference: ref.id,
      verdict: result.verdict,
      qualityVerdict: result.qualityVerdict,
      vector: result.vector,
      security,
      schemaViolation: result.schemaViolation,
      rawText: result.schemaViolation ? result.rawText : undefined,
    };
  }

  return {
    suite: 'oracle',
    case: fixture.id,
    trueOracle: fixture.oracle,
    blind: {
      verdict: blind.verdict,
      qualityVerdict: blind.qualityVerdict,
      vector: blind.vector,
      schemaViolation: blind.schemaViolation,
      rawText: blind.schemaViolation ? blind.rawText : undefined,
    },
    arms,
    poisoned,
    judgeMissed: anyJudgeMiss,
    provenance: runProvenance(blindRun),
    usage: totalUsage(runs),
  };
}
