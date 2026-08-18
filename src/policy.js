/**
 * The third layer: a decision over a measurement.
 *
 * Kept out of the normalizer because they answer different questions. The
 * normalizer asks "what did the judge actually say"; policy asks "does that
 * clear the bar we set". Only the second one changes per project, and mixing
 * them is what made the verdict useless as a metric — a run blocked on
 * security was indistinguishable from one that scored badly.
 */
export function decide({ qualityScore, securityPassed, measured = true }, policy) {
  const blockedBy = [];

  if (!measured) {
    // No readable grade means no measurement. It cannot pass, and it is not
    // a low score either — that distinction matters when these aggregate.
    return { verdict: 'FAIL', qualityVerdict: 'FAIL', blockedBy: ['schema'] };
  }

  const qualityVerdict = qualityScore >= policy.quality.threshold ? 'PASS' : 'FAIL';
  if (qualityVerdict !== 'PASS') blockedBy.push('quality');
  if (policy.security.failOnAny && !securityPassed) blockedBy.push('security');

  return {
    verdict: blockedBy.length === 0 ? 'PASS' : 'FAIL',
    qualityVerdict,
    blockedBy,
  };
}
