/**
 * Headless comparison of feedback conditions.
 *
 *   npm run experiment -- --seeds 10 --minutes 20 --bin 120
 *
 * Runs every (condition, seed) pair in a pool of worker threads, then
 * writes outputs/experiment.json, outputs/experiment.csv and prints a
 * summary table. Seeds are paired across conditions: seed k builds the
 * same network and serves the same first ball in every condition.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FEEDBACK_MODES, defaultConfig, type FeedbackMode } from '../src/core/closedLoop.ts';
import { resultsToCsv, runSession, summarize, type RunResult, type RunSpec } from '../src/core/experiment.ts';
import { PRESETS, applyPreset, type PresetName } from '../src/core/presets.ts';

interface Options {
  seeds: number;
  minutes: number;
  binSeconds: number;
  preset: PresetName;
  modes: FeedbackMode[];
  out: string;
  threads: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    seeds: 10,
    minutes: 20,
    binSeconds: 120,
    preset: 'dishbrain',
    modes: [...FEEDBACK_MODES],
    out: 'outputs',
    threads: Math.max(1, availableParallelism() - 1),
  };
  for (let i = 0; i < argv.length; i++) {
    const [key, value] = [argv[i], argv[i + 1]];
    switch (key) {
      case '--seeds':
        opts.seeds = Number(value);
        i++;
        break;
      case '--minutes':
        opts.minutes = Number(value);
        i++;
        break;
      case '--bin':
        opts.binSeconds = Number(value);
        i++;
        break;
      case '--preset':
        if (!(value in PRESETS)) throw new Error(`unknown preset ${value}`);
        opts.preset = value as PresetName;
        i++;
        break;
      case '--modes':
        opts.modes = value.split(',') as FeedbackMode[];
        i++;
        break;
      case '--out':
        opts.out = value;
        i++;
        break;
      case '--threads':
        opts.threads = Number(value);
        i++;
        break;
      default:
        if (key.startsWith('--')) throw new Error(`unknown option ${key}`);
    }
  }
  return opts;
}

const fmt = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const config = applyPreset(defaultConfig(), opts.preset);
  const specs: RunSpec[] = [];
  for (const mode of opts.modes)
    for (let s = 1; s <= opts.seeds; s++)
      specs.push({
        mode,
        seed: s,
        durationMs: opts.minutes * 60_000,
        binMs: opts.binSeconds * 1000,
        config,
      });

  console.log(
    `Running ${specs.length} sessions (${opts.modes.join(', ')} x ${opts.seeds} seeds, ` +
      `${opts.minutes} sim-min each, preset "${opts.preset}") on ${opts.threads} threads...`,
  );
  const t0 = performance.now();
  const results: RunResult[] = new Array(specs.length);
  let next = 0;
  let done = 0;
  const self = fileURLToPath(import.meta.url);
  await Promise.all(
    Array.from({ length: Math.min(opts.threads, specs.length) }, async () => {
      const worker = new Worker(self, { workerData: { child: true } });
      try {
        while (next < specs.length) {
          const idx = next++;
          results[idx] = await new Promise<RunResult>((resolve, reject) => {
            worker.once('message', resolve);
            worker.once('error', reject);
            worker.postMessage(specs[idx]);
          });
          done++;
          process.stdout.write(`\r  ${done}/${specs.length} done`);
        }
      } finally {
        await worker.terminate();
      }
    }),
  );
  const wall = (performance.now() - t0) / 1000;
  console.log(`\nFinished in ${wall.toFixed(1)} s.\n`);

  const summary = summarize(results);
  mkdirSync(opts.out, { recursive: true });
  writeFileSync(
    `${opts.out}/experiment.json`,
    JSON.stringify({ options: opts, config, wallSeconds: wall, summary, results }, null, 2),
  );
  writeFileSync(`${opts.out}/experiment.csv`, resultsToCsv(results));

  const lines: string[] = [];
  lines.push(`| Condition | Seeds | Mean rally (all) | Early third | Late third | Late - early |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const c of summary.conditions) {
    const ci = (m: { mean: number; lo: number; hi: number }) =>
      `${fmt(m.mean)} [${fmt(m.lo)}, ${fmt(m.hi)}]`;
    lines.push(
      `| ${c.mode} | ${c.seeds} | ${ci(c.meanRally)} | ${ci(c.earlyRally)} | ${ci(c.lateRally)} | ${ci(c.improvement)} |`,
    );
  }
  lines.push('');
  lines.push(`| Comparison | Metric | Mann-Whitney U | p (two-sided) |`);
  lines.push(`|---|---|---|---|`);
  for (const k of summary.comparisons) {
    lines.push(
      `| ${k.a} vs ${k.b} | ${k.metric} | ${fmt(k.test.u, 1)} | ${fmt(k.test.p)} (${k.test.method}) |`,
    );
  }
  const table = lines.join('\n');
  writeFileSync(`${opts.out}/summary.md`, table + '\n');
  console.log('Mean rally length (hits per rally), mean [95% CI] across seeds:\n');
  console.log(table);
  console.log(`\nWrote ${opts.out}/experiment.json, experiment.csv and summary.md`);
}

if (isMainThread) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else if (workerData?.child) {
  parentPort!.on('message', (spec: RunSpec) => {
    parentPort!.postMessage(runSession(spec));
  });
}
