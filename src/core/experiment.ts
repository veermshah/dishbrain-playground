import { ClosedLoop, defaultConfig, type FeedbackMode, type SimConfig } from './closedLoop.ts';
import { mannWhitneyU, mean, meanCI95, type MannWhitney, type MeanCI } from './stats.ts';

export interface RunSpec {
  mode: FeedbackMode;
  seed: number;
  durationMs: number;
  binMs: number;
  /** Config overrides; the mode is taken from `mode`. */
  config?: SimConfig;
}

export interface RunResult {
  mode: FeedbackMode;
  seed: number;
  durationMs: number;
  binMs: number;
  /** Mean rally length (hits per rally) of rallies ending in each bin; null if none ended. */
  binRally: (number | null)[];
  /** Hit rate hits / (hits + misses) per bin; null if no ball reached the paddle. */
  binHitRate: (number | null)[];
  hits: number;
  misses: number;
  meanRally: number;
  /** Mean rally length in the first and last third of the session. */
  earlyRally: number;
  lateRally: number;
}

/**
 * Run one headless session. Pure and deterministic given the spec, so
 * the browser, Node workers and tests all produce identical numbers.
 */
export function runSession(spec: RunSpec, onProgress?: (fraction: number) => void): RunResult {
  const cfg: SimConfig = { ...(spec.config ?? defaultConfig()), mode: spec.mode };
  const sim = new ClosedLoop(cfg, spec.seed);
  const nBins = Math.max(1, Math.ceil(spec.durationMs / spec.binMs));
  const binHits = new Array<number>(nBins).fill(0);
  const binMisses = new Array<number>(nBins).fill(0);
  const chunk = 5000;
  for (let t = 0; t < spec.durationMs; t++) {
    sim.step();
    const ev = sim.lastEvent;
    if (ev) {
      const b = Math.min(nBins - 1, Math.floor(t / spec.binMs));
      if (ev === 'hit') binHits[b]++;
      else binMisses[b]++;
    }
    if (onProgress && t % chunk === 0) onProgress(t / spec.durationMs);
  }
  onProgress?.(1);

  const rallyBins: number[][] = Array.from({ length: nBins }, () => []);
  for (const r of sim.rallies) {
    rallyBins[Math.min(nBins - 1, Math.floor(r.t / spec.binMs))].push(r.hits);
  }
  const third = spec.durationMs / 3;
  const early = sim.rallies.filter((r) => r.t < third).map((r) => r.hits);
  const late = sim.rallies.filter((r) => r.t >= 2 * third).map((r) => r.hits);
  const orZero = (x: number) => (Number.isFinite(x) ? x : 0);
  return {
    mode: spec.mode,
    seed: spec.seed,
    durationMs: spec.durationMs,
    binMs: spec.binMs,
    binRally: rallyBins.map((b) => (b.length ? mean(b) : null)),
    binHitRate: binHits.map((h, i) => (h + binMisses[i] ? h / (h + binMisses[i]) : null)),
    hits: sim.hits,
    misses: sim.misses,
    meanRally: orZero(mean(sim.rallies.map((r) => r.hits))),
    earlyRally: orZero(mean(early)),
    lateRally: orZero(mean(late)),
  };
}

export interface ConditionSummary {
  mode: FeedbackMode;
  seeds: number;
  /** Per-bin mean rally length across seeds with 95% CI. */
  curve: MeanCI[];
  meanRally: MeanCI;
  earlyRally: MeanCI;
  lateRally: MeanCI;
  /** Late minus early, per seed. */
  improvement: MeanCI;
}

export interface Comparison {
  a: FeedbackMode;
  b: FeedbackMode;
  metric: 'lateRally' | 'meanRally' | 'improvement';
  test: MannWhitney;
}

export interface ExperimentSummary {
  conditions: ConditionSummary[];
  comparisons: Comparison[];
}

export function summarize(results: RunResult[]): ExperimentSummary {
  const modes = [...new Set(results.map((r) => r.mode))];
  const conditions: ConditionSummary[] = modes.map((mode) => {
    const rs = results.filter((r) => r.mode === mode);
    const nBins = Math.max(...rs.map((r) => r.binRally.length));
    const curve: MeanCI[] = [];
    for (let b = 0; b < nBins; b++) {
      const vals = rs.map((r) => r.binRally[b]).filter((v): v is number => v !== null);
      curve.push(meanCI95(vals));
    }
    return {
      mode,
      seeds: rs.length,
      curve,
      meanRally: meanCI95(rs.map((r) => r.meanRally)),
      earlyRally: meanCI95(rs.map((r) => r.earlyRally)),
      lateRally: meanCI95(rs.map((r) => r.lateRally)),
      improvement: meanCI95(rs.map((r) => r.lateRally - r.earlyRally)),
    };
  });
  const comparisons: Comparison[] = [];
  const pick = (mode: FeedbackMode, f: (r: RunResult) => number) =>
    results.filter((r) => r.mode === mode).map(f);
  for (let i = 0; i < modes.length; i++) {
    for (let j = i + 1; j < modes.length; j++) {
      const a = modes[i];
      const b = modes[j];
      comparisons.push({
        a,
        b,
        metric: 'lateRally',
        test: mannWhitneyU(
          pick(a, (r) => r.lateRally),
          pick(b, (r) => r.lateRally),
        ),
      });
      comparisons.push({
        a,
        b,
        metric: 'improvement',
        test: mannWhitneyU(
          pick(a, (r) => r.lateRally - r.earlyRally),
          pick(b, (r) => r.lateRally - r.earlyRally),
        ),
      });
    }
  }
  return { conditions, comparisons };
}

/** Flatten results into CSV (one row per run per bin). */
export function resultsToCsv(results: RunResult[]): string {
  const rows = ['mode,seed,bin,bin_start_s,mean_rally,hit_rate'];
  for (const r of results) {
    r.binRally.forEach((v, b) => {
      const hr = r.binHitRate[b];
      rows.push(
        [
          r.mode,
          r.seed,
          b,
          (b * r.binMs) / 1000,
          v === null ? '' : v.toFixed(4),
          hr === null ? '' : hr.toFixed(4),
        ].join(','),
      );
    });
  }
  return rows.join('\n') + '\n';
}
