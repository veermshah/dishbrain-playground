/** Small statistics helpers used by the experiment runner and the UI. */

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
}

export function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1));
}

export function sem(xs: number[]): number {
  return xs.length < 2 ? 0 : sd(xs) / Math.sqrt(xs.length);
}

const T975 = [
  NaN,
  12.706,
  4.303,
  3.182,
  2.776,
  2.571,
  2.447,
  2.365,
  2.306,
  2.262,
  2.228,
  2.201,
  2.179,
  2.16,
  2.145,
  2.131,
  2.12,
  2.11,
  2.101,
  2.093,
  2.086,
  2.08,
  2.074,
  2.069,
  2.064,
  2.06,
  2.056,
  2.052,
  2.048,
  2.045,
  2.042,
];

/** Two-sided 97.5% quantile of Student's t with df degrees of freedom. */
export function tQuantile975(df: number): number {
  if (df < 1) return NaN;
  if (df <= 30) return T975[df];
  if (df <= 60) return 2.0;
  if (df <= 120) return 1.98;
  return 1.96;
}

export interface MeanCI {
  mean: number;
  lo: number;
  hi: number;
  n: number;
}

/** Mean with a t-based 95% confidence interval. */
export function meanCI95(xs: number[]): MeanCI {
  const m = mean(xs);
  if (xs.length < 2) return { mean: m, lo: m, hi: m, n: xs.length };
  const h = tQuantile975(xs.length - 1) * sem(xs);
  return { mean: m, lo: m - h, hi: m + h, n: xs.length };
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export interface MannWhitney {
  u: number;
  p: number;
  method: 'exact' | 'normal';
}

/**
 * Two-sided Mann-Whitney U test. Uses the exact null distribution when
 * there are no ties and both samples are small, otherwise the normal
 * approximation with tie and continuity corrections.
 */
export function mannWhitneyU(a: number[], b: number[]): MannWhitney {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 === 0 || n2 === 0) return { u: NaN, p: NaN, method: 'normal' };
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort(
    (x, y) => x.v - y.v,
  );
  const ranks = new Array<number>(all.length);
  let tieTerm = 0;
  let hasTies = false;
  for (let i = 0; i < all.length;) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = r;
    const t = j - i + 1;
    if (t > 1) {
      hasTies = true;
      tieTerm += t * t * t - t;
    }
    i = j + 1;
  }
  let r1 = 0;
  for (let k = 0; k < all.length; k++) if (all[k].g === 0) r1 += ranks[k];
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const u = Math.min(u1, n1 * n2 - u1);

  if (!hasTies && n1 <= 25 && n2 <= 25) {
    // counts[k] = number of arrangements with U = k (recursive DP over n1, n2).
    const dist = exactUDistribution(n1, n2);
    const total = dist.reduce((s, x) => s + x, 0);
    let tail = 0;
    for (let k = 0; k <= Math.floor(u); k++) tail += dist[k];
    return { u: u1, p: Math.min(1, (2 * tail) / total), method: 'exact' };
  }

  const n = n1 + n2;
  const mu = (n1 * n2) / 2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1))));
  if (sigma === 0) return { u: u1, p: 1, method: 'normal' };
  const z = (Math.abs(u1 - mu) - 0.5) / sigma;
  return { u: u1, p: Math.min(1, 2 * (1 - normalCdf(Math.max(0, z)))), method: 'normal' };
}

function exactUDistribution(n1: number, n2: number): number[] {
  // f(i, j)[k]: number of orderings of i A's and j B's with U = k.
  const memo = new Map<string, number[]>();
  const f = (i: number, j: number): number[] => {
    if (i === 0 || j === 0) return [1];
    const key = `${i},${j}`;
    const hit = memo.get(key);
    if (hit) return hit;
    // Largest element is an A (contributes j) or a B (contributes 0).
    const a = f(i - 1, j);
    const b = f(i, j - 1);
    const out = new Array<number>(i * j + 1).fill(0);
    for (let k = 0; k < a.length; k++) out[k + j] += a[k];
    for (let k = 0; k < b.length; k++) out[k] += b[k];
    memo.set(key, out);
    return out;
  };
  return f(n1, n2);
}
