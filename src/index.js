#!/usr/bin/env node
import { runCalibration } from './suites/calibration.js';
import { runInjection } from './suites/injection.js';
import { runOracle } from './suites/oracle.js';
import { runRepeatability } from './suites/repeatability.js';
import { runTrigger } from './suites/trigger.js';
import { printResult, printGate, saveResult } from './report.js';
import { evaluateGate, EXIT } from './gate.js';

const USAGE = `Usage: npm run eval -- <suite> [options]

Suites:
  calibration              blind-mode accuracy against the known-oracle corpus (T1-T4)
  injection                control/treatment prompt-injection test (T1 vs INJ_T)
  oracle                   blind vs oracle-neutral vs oracle-adversarial on T1
  repeatability [--case T1] [--n 3]
                            same case, N independent runs
  trigger [--task "..."]   live target agent -> grader, no known oracle
  all                      runs every suite above in order

Options:
  --no-fail                report gate failures but still exit 0

Exit codes:
  0  every gate passed
  1  a gate failed
  2  the run could not complete

Requires ANTHROPIC_API_KEY in the environment.`;

function parseArgs(argv) {
  const [suite, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--case') opts.caseId = rest[++i];
    else if (rest[i] === '--n') opts.n = Number(rest[++i]);
    else if (rest[i] === '--task') opts.task = rest[++i];
    else if (rest[i] === '--no-fail') opts.noFail = true;
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

  const gates = [];
  for (const s of suites) {
    const result = await runSuite(s, opts);
    const gate = evaluateGate(result);
    gates.push(gate);
    printResult(result);
    printGate(gate);
    // The gate travels with the artifact: a stored result should carry the
    // decision that was made from it, not just the numbers behind it.
    saveResult({ ...result, gate });
  }

  const failed = gates.filter((g) => !g.passed);
  if (failed.length === 0) return EXIT.OK;

  console.error(`\nGate failed: ${failed.map((g) => g.suite).join(', ')}`);
  if (opts.noFail) {
    console.error('--no-fail set, exiting 0 anyway.');
    return EXIT.OK;
  }
  return EXIT.GATE_FAILED;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\nError: ${err.message}`);
    process.exit(EXIT.ERROR);
  });
