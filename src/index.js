#!/usr/bin/env node
import { runCalibration } from './suites/calibration.js';
import { runInjection } from './suites/injection.js';
import { runOracle } from './suites/oracle.js';
import { runRepeatability } from './suites/repeatability.js';
import { runTrigger } from './suites/trigger.js';
import { printResult, saveResult } from './report.js';

const USAGE = `Usage: npm run eval -- <suite> [options]

Suites:
  calibration              blind-mode accuracy against the known-oracle corpus (T1-T4)
  injection                control/treatment prompt-injection test (T1 vs INJ_T)
  oracle                   blind vs oracle-neutral vs oracle-adversarial on T1
  repeatability [--case T1] [--n 3]
                            same case, N independent runs
  trigger [--task "..."]   live target agent -> grader, no known oracle
  all                      runs every suite above in order

Requires ANTHROPIC_API_KEY in the environment.`;

function parseArgs(argv) {
  const [suite, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--case') opts.caseId = rest[++i];
    else if (rest[i] === '--n') opts.n = Number(rest[++i]);
    else if (rest[i] === '--task') opts.task = rest[++i];
  }
  return { suite, opts };
}

async function runSuite(suite, opts) {
  switch (suite) {
    case 'calibration':
      return runCalibration();
    case 'injection':
      return runInjection();
    case 'oracle':
      return runOracle();
    case 'repeatability':
      return runRepeatability({ caseId: opts.caseId ?? 'T1', n: opts.n ?? 3 });
    case 'trigger':
      return runTrigger(opts.task ? { task: opts.task } : {});
    default:
      throw new Error(`Unknown suite "${suite}"`);
  }
}

async function main() {
  const { suite, opts } = parseArgs(process.argv.slice(2));

  if (!suite || suite === '--help' || suite === '-h') {
    console.log(USAGE);
    process.exit(suite ? 0 : 1);
  }

  const suites = suite === 'all' ? ['calibration', 'injection', 'oracle', 'repeatability', 'trigger'] : [suite];

  for (const s of suites) {
    const result = await runSuite(s, opts);
    printResult(result);
    saveResult(result);
  }
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exit(1);
});
