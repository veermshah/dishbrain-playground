import { describe, expect, it } from 'vitest';
import { mannWhitneyU, mean, meanCI95, normalCdf, sd } from '../src/core/stats.ts';

describe('stats', () => {
  it('computes mean, sd and a t-based 95% CI', () => {
    const xs = [1, 2, 3, 4, 5];
    expect(mean(xs)).toBe(3);
    expect(sd(xs)).toBeCloseTo(Math.sqrt(2.5));
    const ci = meanCI95(xs);
    // t(0.975, 4) = 2.776; sem = sqrt(2.5)/sqrt(5)
    expect(ci.hi - ci.mean).toBeCloseTo(2.776 * Math.sqrt(0.5), 3);
    expect(ci.mean - ci.lo).toBeCloseTo(ci.hi - ci.mean, 9);
  });

  it('normal CDF matches known values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3);
  });

  it('Mann-Whitney exact p-values match tables', () => {
    // Completely separated samples of 4 vs 4: p = 2/70.
    const r = mannWhitneyU([1, 2, 3, 4], [5, 6, 7, 8]);
    expect(r.method).toBe('exact');
    expect(r.u).toBe(0);
    expect(r.p).toBeCloseTo(2 / 70, 6);
    // Interleaved: no evidence of a difference.
    expect(mannWhitneyU([1, 3, 5, 7], [2, 4, 6, 8]).p).toBeGreaterThan(0.5);
    // Symmetric in argument order.
    expect(mannWhitneyU([5, 6, 7, 8], [1, 2, 3, 4]).p).toBeCloseTo(2 / 70, 6);
  });

  it('falls back to the normal approximation with ties', () => {
    const r = mannWhitneyU([1, 1, 2, 2, 3, 3], [2, 3, 4, 4, 5, 5]);
    expect(r.method).toBe('normal');
    expect(r.p).toBeGreaterThan(0);
    expect(r.p).toBeLessThan(0.2);
    expect(mannWhitneyU([1, 1, 1], [1, 1, 1]).p).toBe(1);
  });
});
