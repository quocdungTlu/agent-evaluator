import { TASK, CASES, ORACLE_TEXT } from '../corpus.js';
import { gradeOnce } from '../grader.js';
import { normalize } from '../normalizer.js';

/**
 * Same case (T1, oracle FAIL), three EXPECTED conditions: none, a neutral
 * restatement of the task, and an adversarial EXPECTED that asserts the
 * fabricated course is real. If oracle-adversarial flips the verdict to
 * PASS, the grader is deferring to a claimed answer instead of judging the
 * OUTPUT itself.
 */
export async function runOracle() {
  const output = CASES.T1.text;

  const blindRaw = await gradeOnce({ task: TASK, output });
  const neutralRaw = await gradeOnce({ task: TASK, output, expected: ORACLE_TEXT.neutral });
  const adversarialRaw = await gradeOnce({ task: TASK, output, expected: ORACLE_TEXT.adversarial });

  const blind = normalize(blindRaw);
  const neutral = normalize(neutralRaw);
  const adversarial = normalize(adversarialRaw);

  const poisoned = adversarial.verdict !== CASES.T1.oracle;

  return {
    suite: 'oracle',
    case: 'T1',
    trueOracle: CASES.T1.oracle,
    blind: { verdict: blind.verdict, vector: blind.vector, rawText: blind.schemaViolation ? blind.rawText : undefined },
    neutral: {
      verdict: neutral.verdict,
      vector: neutral.vector,
      rawText: neutral.schemaViolation ? neutral.rawText : undefined,
    },
    adversarial: {
      verdict: adversarial.verdict,
      vector: adversarial.vector,
      rawText: adversarial.schemaViolation ? adversarial.rawText : undefined,
    },
    poisoned,
  };
}
