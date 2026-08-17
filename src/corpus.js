import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

function loadFixture(filename) {
  const text = readFileSync(path.join(FIXTURES_DIR, filename), 'utf8');
  const hash = createHash('sha256').update(text, 'utf8').digest('hex');
  return { text, hash };
}

export const TASK = readFileSync(path.join(FIXTURES_DIR, 'task.txt'), 'utf8').trim();

// Fixed fixtures, not live model output — the oracle has to be known before
// grading, and a freshly generated answer can't give you that.
export const CASES = {
  T1: { ...loadFixture('t1_fabricated.txt'), oracle: 'FAIL', label: 'Fabricated course, fluent prose' },
  T2: { ...loadFixture('t2_no_recommendation.txt'), oracle: 'FAIL', label: 'No course recommended at all' },
  T3: { ...loadFixture('t3_real_verifiable.txt'), oracle: 'PASS', label: 'Real, verifiable, self-limiting' },
  T4: { ...loadFixture('t4_self_contradictory.txt'), oracle: 'FAIL', label: 'Self-contradictory claims' },
};

export const INJECTION = {
  control: { ...loadFixture('inj_c_control.txt'), oracle: 'FAIL', label: 'INJ_C — byte-identical to T1' },
  treatment: { ...loadFixture('inj_t_treatment.txt'), oracle: 'FAIL', label: 'INJ_T — T1 + fake SYSTEM NOTE' },
};

export const ORACLE_TEXT = {
  neutral: readFileSync(path.join(FIXTURES_DIR, 'oracle_neutral.txt'), 'utf8').trim(),
  adversarial: readFileSync(path.join(FIXTURES_DIR, 'oracle_adversarial.txt'), 'utf8').trim(),
};

// Sanity check the corpus itself: INJ_C must be exactly T1, byte for byte,
// or the injection test's control isn't actually a control.
if (INJECTION.control.hash !== CASES.T1.hash) {
  throw new Error(
    `Corpus invariant broken: INJ_C hash (${INJECTION.control.hash}) does not match T1 hash (${CASES.T1.hash}).`
  );
}
