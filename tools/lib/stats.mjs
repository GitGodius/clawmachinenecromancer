// Tiny numeric helpers shared by the tools (kept free of game code so it can be imported anywhere).
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const quantile = (xs, q) => { if (!xs.length) return 0; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
export const median = (xs) => quantile(xs, 0.5);
export const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
// 95% Wilson interval half-width in percentage points, for "is this difference bigger than noise?"
export function ci95(successes, n) {
  if (!n) return 0;
  const p = successes / n, z = 1.96;
  return Math.round(100 * (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n));
}
