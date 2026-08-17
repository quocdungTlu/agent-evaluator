// Wilson score interval — the same interval the essay cites for small-n
// accuracy claims (e.g. 4/4 calibration -> [51.0%, 100%]). Safer than a
// normal approximation at small n, which is the regime these suites run in.
export function wilsonInterval(successes, total, z = 1.96) {
  if (total === 0) return { lower: 0, upper: 1 };
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return {
    lower: Math.max(0, (center - margin) / denom),
    upper: Math.min(1, (center + margin) / denom),
  };
}

export function formatPct(x) {
  return `${(x * 100).toFixed(1)}%`;
}
