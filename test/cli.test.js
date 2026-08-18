import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');

async function cli(args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { env: { ...process.env, ANTHROPIC_API_KEY: '' } });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('--help exits 0 and documents the exit codes', async () => {
  const r = await cli(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Exit codes/);
});

test('an unknown suite exits 2, not 1', async () => {
  const r = await cli(['not-a-suite']);
  assert.equal(r.code, 2, 'a broken invocation is not a failed gate');
  assert.match(r.stderr, /Unknown suite/);
});

test('a missing API key is an operational error, not a gate failure', async () => {
  const r = await cli(['calibration']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /ANTHROPIC_API_KEY/);
});
