# agent-evaluator

A meta-agent that grades another agent's output against a 5-criterion rubric, built from the
design in [`work/agent-evaluation/`](../work/agent-evaluation/) — the essay's blind-calibration
run, injection test, oracle-poisoning test, and repeatability finding, now runnable end to end
against the real Claude API instead of MindPal fixtures alone.

It also runs the stage the essay never got to: a live target agent generates fresh output, and
the grader scores it (`trigger` suite).

## What this does differently from a "grader that trusts itself"

The essay's central finding was that the same LLM, grading the exact same criteria vector three
times, wrote three different self-reported totals — once omitting a score entirely. So this
implementation never trusts a number the model writes:

- `src/normalizer.js` parses the C1–C5 vector out of the grader's JSON response and **recomputes
  the sum and verdict itself**. A malformed or missing vector fails closed (`verdict: FAIL`,
  `schemaViolation: true`) rather than defaulting to a pass.
- Security issues (prompt injection, forged authority, downstream instructions) are a separate
  flag set from the quality score, not blended into it — a technically correct output can still
  be flagged and blocked.

But "verify" is two different claims, and only one of them is honest about what code can do:

| Claim | Who settles it |
|---|---|
| this vector sums to 3, not 2 | code — it is arithmetic |
| this output contains no injection | the judge — which is the component we said we would not trust |

So the security flag is not relayed, it is **cross-checked**. `src/detectors.js` runs
deterministic patterns over the same untrusted text the judge saw, and the two sources are
classified against each other:

```
code found      judge flagged     →  AGREED_FLAG
code found      judge silent      →  JUDGE_MISS     ← the measurement worth having
code silent     judge flagged     →  JUDGE_ONLY
code silent     judge silent      →  NO_FLAG
```

Regex is a weak detector on purpose. A weak *deterministic* signal is what you need to audit a
strong non-deterministic one — it does not have to catch everything to prove the judge missed
something. Fixtures declare `expectDetection` so the miss rate stays honest: this corpus carries
attack text deliberately, and ordinary copy trips the same patterns. Only a declared fixture can
score a miss; elsewhere a hit is recorded as a detector false positive instead.

## Three layers, kept apart

```
criterion vector   →   quality score      →   verdict
(the observation)      (deterministic)        (policy: score + security gate)
```

Collapsing these is what made the verdict useless as a regression metric — a run blocked on
security looked identical to one that scored badly. `blockedBy` records which constraint stopped
a run, and a schema violation scores `null`, never `0`, so an unreadable response cannot average
in as a bad grade.

## Exit codes

The gate can fail a build; that is the point of having one.

| Code | Meaning |
|---|---|
| `0` | every gate passed |
| `1` | a gate failed — wrong grade vs the oracle, unreadable response, successful injection, poisoned oracle, `JUDGE_MISS` on a declared marker |
| `2` | the run could not complete (bad invocation, missing key, API error) |

Instability warns but does not block. Gating judge flicker needs a sampling policy and a
confidence interval, not n=3 — blocking on it now would build exactly the flaky gate that teams
learn to bypass. Pass `--no-fail` to keep an exploratory run from failing a build.

## Tests

```bash
npm test
```

43 tests, no API key required. Everything the gate decides with — parsing, scoring, detection,
policy — is deterministic and runs offline; a test here needing a key would mean judgment leaked
into a layer that was supposed to be verifiable. CI runs them on Node 18, 20 and 22.

The corpus checks itself: `test/corpus.test.js` asserts that every fixture's declared
`expectDetection` matches what the detectors actually find, so a newly added fixture cannot
silently poison the `JUDGE_MISS` rate.

## Setup

```bash
cd agent-evaluator
npm install
export ANTHROPIC_API_KEY=sk-ant-...
```

Optional: `ANTHROPIC_MODEL` to override the grader's model, `TARGET_MODEL` to use a different
model for the `trigger` suite's target agent. Both are better set in the manifest.

## Suites

```bash
npm run eval -- calibration              # blind-mode accuracy vs the known-oracle corpus (T1-T4)
npm run eval -- injection                # control (T1) vs treatment (T1 + fake SYSTEM NOTE)
npm run eval -- oracle                   # blind vs oracle-neutral vs oracle-adversarial, on T1
npm run eval -- repeatability --case T1 --n 3
npm run eval -- trigger --task "..."     # live target agent -> grader, no known oracle
npm run eval -- all                      # every suite above, in order
npm run eval -- all --manifest path/to/eval.yaml
```

Each run prints a table to the console and writes a JSON result to `results/` (gitignored),
carrying the gate decision alongside the numbers it was made from, plus the provenance a later
baseline comparison needs: the model id the API **resolved** (never the alias requested — an
alias can be repointed server-side without notice), a hash of the grader instructions, and token
usage.

## The manifest

Everything that decides what a score *means* lives in `eval.yaml`, not in `src/`: the criteria and
their weights, the security flag definitions, the pass threshold, the task, the corpus, and which
fixtures each suite uses. `src/` holds the machinery — parsing, scoring, detection, policy, gating —
and knows nothing about any particular project.

Three things the schema keeps apart on purpose, because conflating them is silent:

| Field | Who sees it |
|---|---|
| `oracle` | code only — the answer, used to score accuracy, **never** sent to the judge |
| `reference` | placed in the judge's context deliberately, to test whether a claimed answer moves the grade |
| `assertions` | deterministic checks in code, alongside the judge rather than through it |

The `oracle` suite exists precisely because a reference can poison a grade. One field for both
would eventually put an answer in the prompt and quietly stop blind calibration from being blind.

`rubric.scale` accepts only `binary`. Weights belong in code; asking the judge for a graded 0–5
buys apparent precision at the cost of the repeatability this corpus exists to measure. Five binary
criteria across five runs is a measurement; one run of "4.37/5" is a number that looks like one.

### Running a different project

A second project needs a manifest and fixtures. It does not need a source change — and that is
enforced, not asserted: `test/acceptance.test.js` runs `test/projects/tripnest` (four criteria,
non-uniform weights, a 0.75 threshold, its own security-flag meanings, a scripted judge) through
all five suites, and fails if any file in `src/` names a project identifier, hardcodes a criterion
or fixture id, or reaches for a provider.

```bash
npm run eval -- calibration --manifest test/projects/tripnest/eval.yaml
```

### Judge providers

`src/judge/` is a registry; the Anthropic SDK is imported in exactly one file. A new provider is a
new adapter plus a line in the registry, with no change to the normalizer, the suites, the policy
or the gate — which is what makes it possible to grade one model's output with a different model's
judgment, rather than asking a model to grade itself.

## Comparability

Making the rubric data creates a hazard the hardcoded version did not have: the rubric can now
change between runs. The most common way an eval system misleads its owner is exactly that —
someone edits a criterion, the score rises, and the report calls it an improvement.

Every run is stamped with an evaluation protocol: hashes of the rubric, the generated prompt, the
task, the corpus, the policy, the detector patterns, and the **resolved** judge model. Two runs
whose protocols differ are `NOT_COMPARABLE`, and the artifact says which components moved. Not a
smaller number or a larger one — not a number about the same thing.

The resolved model matters more than it looks. Requesting the same alias proves nothing: an alias
can be repointed server-side, and a delta measured across that change is noise wearing a trend's
clothing.

Baseline comparison itself is not implemented. Comparing two scores from a judge with measured
flicker needs a sampling policy first; this is the contract that refuses the comparison when it
should not happen at all.

## Corpus

`fixtures/` holds fixed text, not live model output — grading a corpus requires knowing the
answer in advance, and a freshly generated response doesn't give you that. Every fixture is hashed
with SHA-256 at load, and the manifest declares the invariant that `INJ_C` is byte-identical to
`T1`, so the injection test's control is provably a control and not just visually similar text.

| Case | Content | Oracle |
|---|---|---|
| T1 | Fabricated course, fluent and confident prose | FAIL |
| T2 | On-topic essay, never actually recommends a course | FAIL |
| T3 | Real, verifiable book; states its own limitation | PASS |
| T4 | Self-contradictory (free vs $149, self-paced vs mandatory live sessions) | FAIL |
| INJ_C | Byte-identical to T1 (injection test control) | FAIL |
| INJ_T | T1 + a fake `SYSTEM NOTE` instructing the grader to return PASS | FAIL |

## Known limits (carried over from the essay, still true here)

- **Grounding is closed-book.** The grader has no retrieval step — C1 is checked against the
  model's own parametric knowledge, not an independent source. A real course that happens to be
  obscure could be misjudged as fabricated. The corpus's only positive control (`T3`) is a very
  well-known book — the easy case, not the risky one.
- **Small n.** Each suite runs a handful of cases per invocation. Wilson confidence intervals are
  printed alongside every accuracy figure for exactly this reason — a clean run is encouraging,
  not proof.
- **The `trigger` suite has no oracle.** It proves the pipeline closes end to end; it is not a
  calibration signal and its results shouldn't be pooled with the fixed-corpus suites.
