import { describe, expect, it } from 'vitest';
import { ClosedLoop, defaultConfig, type FeedbackMode } from '../src/core/closedLoop.ts';
import { resultsToCsv, runSession, summarize } from '../src/core/experiment.ts';

const smallConfig = (mode: FeedbackMode) => {
  const cfg = defaultConfig(mode);
  cfg.network.nNeurons = 300;
  return cfg;
};

/** Put the loop one step away from a guaranteed miss and step through it. */
function forceMiss(sim: ClosedLoop) {
  sim.pong.s = { ballX: 0.0152, ballY: 0.05, vx: -0.5, vy: 0, paddleY: 0.9 };
  sim.pong.p.paddleSpeed = 0;
  sim.step();
  expect(sim.lastEvent).toBe('miss');
}

function feedbackPulses(mode: FeedbackMode, ms: number) {
  const sim = new ClosedLoop(smallConfig(mode), 1);
  forceMiss(sim);
  let pulses = 0;
  const electrodes = new Set<number>();
  const times: number[] = [];
  for (let t = 0; t < ms; t++) {
    sim.step();
    let any = false;
    sim.stimulated.forEach((v, e) => {
      if (v === 2) {
        pulses++;
        electrodes.add(e);
        any = true;
      }
    });
    if (any) times.push(t);
  }
  return { sim, pulses, electrodes, times };
}

describe('closed loop', () => {
  it('is deterministic for a given seed', () => {
    const a = new ClosedLoop(smallConfig('predictable'), 3);
    const b = new ClosedLoop(smallConfig('predictable'), 3);
    a.run(5000);
    b.run(5000);
    expect(a.pong.s).toEqual(b.pong.s);
    expect(Array.from(a.net.w)).toEqual(Array.from(b.net.w));
  });

  it('pauses the game for the feedback window after a miss, then serves', () => {
    const sim = new ClosedLoop(smallConfig('silent'), 2);
    forceMiss(sim);
    expect(sim.misses).toBe(1);
    expect(sim.rallies).toHaveLength(1);
    expect(sim.feedbackLeft).toBe(sim.cfg.feedback.windowMs);
    const ball = { ...sim.pong.s };
    sim.run(sim.cfg.feedback.windowMs - 1);
    expect(sim.pong.s.ballX).toBe(ball.ballX);
    sim.step();
    expect(sim.feedbackLeft).toBe(0);
    expect(sim.pong.s.ballX).toBeGreaterThan(0.5);
  });

  it('predictable feedback is a synchronous 100 Hz burst on all sensory electrodes', () => {
    const { sim, electrodes, times } = feedbackPulses('predictable', 2000);
    expect([...electrodes].sort((x, y) => x - y)).toEqual(
      [...sim.layout.sensory].sort((x, y) => x - y),
    );
    expect(times).toHaveLength(10);
    for (let k = 1; k < times.length; k++) expect(times[k] - times[k - 1]).toBe(10);
    expect(times[times.length - 1]).toBeLessThan(100);
  });

  it('unpredictable feedback hits random subsets at random times across the window', () => {
    const { sim, electrodes, times } = feedbackPulses('unpredictable', 2000);
    expect(times.length).toBeGreaterThan(2);
    expect(times[times.length - 1]).toBeGreaterThan(200);
    for (const e of electrodes) expect(sim.layout.roles[e]).toBe('sensory');
  });

  it('silent feedback delivers no stimulation', () => {
    expect(feedbackPulses('silent', 2000).pulses).toBe(0);
  });

  it('drives the paddle from motor activity', () => {
    const sim = new ClosedLoop(smallConfig('silent'), 4);
    const y0 = sim.pong.s.paddleY;
    let moved = 0;
    for (let t = 0; t < 3000; t++) {
      const before = sim.pong.s.paddleY;
      sim.step();
      if (sim.pong.s.paddleY !== before) moved++;
    }
    expect(moved).toBeGreaterThan(100);
    expect(sim.pong.s.paddleY).not.toBe(y0);
  });
});

describe('experiment runner', () => {
  it('produces reproducible binned results and summaries', () => {
    const spec = {
      mode: 'silent' as const,
      seed: 5,
      durationMs: 20000,
      binMs: 5000,
      config: smallConfig('silent'),
    };
    const a = runSession(spec);
    const b = runSession(spec);
    expect(a).toEqual(b);
    expect(a.binRally).toHaveLength(4);
    expect(a.hits + a.misses).toBeGreaterThan(0);
    const summary = summarize([
      a,
      runSession({ ...spec, seed: 6 }),
      runSession({ ...spec, mode: 'predictable', seed: 5 }),
    ]);
    expect(summary.conditions.map((c) => c.mode)).toEqual(['silent', 'predictable']);
    expect(summary.comparisons.length).toBe(2);
    const csv = resultsToCsv([a]);
    expect(csv.split('\n')[0]).toBe('mode,seed,bin,bin_start_s,mean_rally,hit_rate');
    expect(csv.trim().split('\n')).toHaveLength(5);
  });
});

describe('presets', () => {
  it('apply without mutating the base config', async () => {
    const { applyPreset } = await import('../src/core/presets.ts');
    const base = defaultConfig();
    const off = applyPreset(base, 'noPlasticity');
    expect(off.network.plastic).toBe(false);
    expect(base.network.plastic).toBe(true);
    const hi = applyPreset(base, 'highPlasticity');
    expect(hi.network.aPlus).toBeCloseTo(base.network.aPlus * 2.5);
  });
});
