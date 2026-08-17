import { TASK } from '../corpus.js';
import { generateTargetOutput } from '../target.js';
import { gradeOnce } from '../grader.js';
import { normalize } from '../normalizer.js';

/**
 * The stage the essay's "Chưa chạy" (not run) column marks as designed but
 * unverified: trigger a target agent live, then grade what it actually
 * produced. There is no known oracle here — this is not a calibration
 * signal, it's a demonstration that the pipeline closes end to end.
 */
export async function runTrigger({ task = TASK } = {}) {
  const output = await generateTargetOutput(task);
  const raw = await gradeOnce({ task, output });
  const result = normalize(raw);

  return {
    suite: 'trigger',
    task,
    output,
    verdict: result.verdict,
    vector: result.vector,
    securityFlags: result.securityFlags,
    schemaViolation: result.schemaViolation,
    rawText: result.schemaViolation ? result.rawText : undefined,
    notes: result.notes,
    note: 'Live target output, no known oracle — not a calibration signal.',
  };
}
