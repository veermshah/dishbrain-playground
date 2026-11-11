import { describe, expect, it } from 'vitest';
import { ClosedLoop, defaultConfig } from '../src/core/closedLoop.ts';
import { Network } from '../src/core/network.ts';
import { applyPreset } from '../src/core/presets.ts';

describe('R-STDP', () => {
  const pair = (rewardLr = 1, extra: Partial<ConstructorParameters<typeof Network>[0]> = {}) => {
    const net = new Network(
      {
        nNeurons: 2,
        excFraction: 1,
        connectionProb: 1,
        noiseRate: 0,
        wExc: 1,
        maxDelay: 1,
        rule: 'rstdp',
        rewardLr,
        ...extra,
      },
      9,
    );
    const s01 = net.outStart[0];
    const s10 = net.outStart[1];
    const w0 = { w01: net.w[s01], w10: net.w[s10] };
    const ext = new Float32Array(2);
    // Neuron 0 fires at t = 10, neuron 1 at t = 15.
    for (let t = 0; t < 30; t++) {
      ext[0] = t === 10 ? 200 : 0;
      ext[1] = t === 15 ? 200 : 0;
      net.step(ext);
    }
    return { net, s01, s10, w0 };
  };

  it('leaves weights alone until a reward arrives, but builds eligibility of the STDP sign', () => {
    const { net, s01, s10, w0 } = pair();
    expect(net.w[s01]).toBe(w0.w01);
    expect(net.w[s10]).toBe(w0.w10);
    expect(net.eligibility(s01)).toBeGreaterThan(0);
    expect(net.eligibility(s10)).toBeLessThan(0);
  });

  it('positive reward applies the STDP sign, negative reward flips it', () => {
    const a = pair();
    a.net.applyReward(1);
    expect(a.net.w[a.s01]).toBeGreaterThan(a.w0.w01);
    expect(a.net.w[a.s10]).toBeLessThan(a.w0.w10);
    const b = pair();
    b.net.applyReward(-1);
    expect(b.net.w[b.s01]).toBeLessThan(b.w0.w01);
    expect(b.net.w[b.s10]).toBeGreaterThan(b.w0.w10);
  });

  it('eligibility decays with tauElig, so late rewards do less', () => {
    const early = pair();
    const e0 = early.net.eligibility(early.s01);
    early.net.applyReward(1);
    const dEarly = early.net.w[early.s01] - early.w0.w01;

    const late = pair();
    for (let t = 0; t < 1000; t++) late.net.step(null);
    expect(late.net.eligibility(late.s01)).toBeCloseTo(e0 * Math.exp(-1), 5);
    late.net.applyReward(1);
    const dLate = late.net.w[late.s01] - late.w0.w01;
    expect(dLate).toBeGreaterThan(0);
    expect(dLate / dEarly).toBeCloseTo(Math.exp(-1), 2);
  });

  it('keeps weights within [0, wMax]', () => {
    const up = pair(1e6);
    up.net.applyReward(1);
    expect(up.net.w[up.s01]).toBe(up.net.p.wMax);
    expect(up.net.w[up.s10]).toBe(0);
    const down = pair(1e6);
    down.net.applyReward(-1);
    expect(down.net.w[down.s01]).toBe(0);
    expect(down.net.w[down.s10]).toBe(down.net.p.wMax);
  });

  it('does nothing with plasticity off or under the plain STDP rule', () => {
    const off = pair(1, { plastic: false });
    off.net.applyReward(1);
    expect(off.net.w[off.s01]).toBe(off.w0.w01);
    const plain = new Network({ nNeurons: 50, rule: 'stdp' }, 1);
    const w = Array.from(plain.w);
    plain.applyReward(1);
    expect(Array.from(plain.w)).toEqual(w);
  });

  it('routes hits and misses to rewards in the closed loop, and shuffles them in the control', () => {
    const cfg = applyPreset(defaultConfig('silent'), 'rstdp');
    cfg.network.nNeurons = 300;
    cfg.reward.baselineEvents = 0;
    const sim = new ClosedLoop(cfg, 2);
    sim.pong.p.paddleSpeed = 0;
    sim.pong.s = { ballX: 0.0152, ballY: 0.5, vx: -0.5, vy: 0, paddleY: 0.5 };
    sim.step();
    expect(sim.lastEvent).toBe('hit');
    expect(sim.lastReward).toBe(1);
    sim.pong.s = { ballX: 0.0152, ballY: 0.05, vx: -0.5, vy: 0, paddleY: 0.9 };
    sim.step();
    expect(sim.lastEvent).toBe('miss');
    expect(sim.lastReward).toBe(-1);

    const shuffled = applyPreset(defaultConfig('silent'), 'rstdpShuffled');
    shuffled.network.nNeurons = 300;
    shuffled.reward.baselineEvents = 0;
    const sh = new ClosedLoop(shuffled, 2);
    sh.pong.p.paddleSpeed = 0;
    const seen = new Set<number>();
    for (let k = 0; k < 40; k++) {
      sh.pong.s = { ballX: 0.0152, ballY: 0.5, vx: -0.5, vy: 0, paddleY: 0.5 };
      sh.feedbackLeft = 0;
      sh.step();
      seen.add(sh.lastReward);
    }
    // Every outcome was a hit, so shuffling can only ever hand back +1.
    expect([...seen]).toEqual([1]);
    sh.pong.s = { ballX: 0.0152, ballY: 0.05, vx: -0.5, vy: 0, paddleY: 0.9 };
    sh.step();
    // A miss among 40 hits is most likely rewarded with an earlier +1.
    expect(sh.lastEvent).toBe('miss');
    expect(sh.lastReward).toBe(1);
  });
});

describe('reward baseline', () => {
  it('delivers reward minus the running average of past rewards', () => {
    const cfg = applyPreset(defaultConfig('silent'), 'rstdp');
    cfg.network.nNeurons = 300;
    cfg.reward.baselineEvents = 4;
    const sim = new ClosedLoop(cfg, 2);
    sim.pong.p.paddleSpeed = 0;
    let avg = 0;
    for (let k = 0; k < 6; k++) {
      sim.pong.s = { ballX: 0.0152, ballY: 0.5, vx: -0.5, vy: 0, paddleY: 0.5 };
      sim.step();
      expect(sim.lastReward).toBeCloseTo(1 - avg, 6);
      avg += (1 - avg) / 4;
    }
    // After a run of hits a hit is worth less and a miss costs more.
    expect(sim.lastReward).toBeLessThan(0.5);
    sim.pong.s = { ballX: 0.0152, ballY: 0.05, vx: -0.5, vy: 0, paddleY: 0.9 };
    sim.step();
    expect(sim.lastReward).toBeCloseTo(-1 - avg, 6);
  });
});

describe('avoidance contingency', () => {
  const make = () => {
    const cfg = defaultConfig('avoidance');
    cfg.network.nNeurons = 300;
    cfg.avoidance.rateHz = 500;
    const sim = new ClosedLoop(cfg, 3);
    sim.pong.p.paddleSpeed = 0;
    return sim;
  };
  /** Ball approaching, well above the paddle. */
  const setScene = (sim: ClosedLoop, vx = -0.5, ballY = 0.2) => {
    sim.pong.s = { ballX: 0.8, ballY, vx, vy: 0, paddleY: 0.8 };
  };
  /** Pin the fast decode: -1 = paddle heading up (towards the ball), +1 = down (away). */
  const force = (sim: ClosedLoop, dir: number) => {
    sim.fastDecoder.rateUp = dir < 0 ? 1000 : 0;
    sim.fastDecoder.rateDown = dir > 0 ? 1000 : 0;
  };
  const run = (sim: ClosedLoop, ms: number, dir: number, scene = () => setScene(sim)) => {
    let pulses = 0;
    for (let t = 0; t < ms; t++) {
      scene();
      force(sim, dir);
      sim.step();
      if (sim.stimulated.some((v) => v === 4)) pulses++;
    }
    return pulses;
  };

  it('stimulates the place-coded electrodes while the paddle moves away from the ball', () => {
    const sim = make();
    const pulses = run(sim, 100, +1);
    expect(pulses).toBeGreaterThan(20);
    expect(sim.avoidOn).toBe(true);
    const place = sim.layout.sensoryByPlace[0];
    let onPlace = 0;
    for (let t = 0; t < 50; t++) {
      setScene(sim);
      force(sim, +1);
      sim.step();
      sim.stimulated.forEach((v, e) => {
        if (v === 4) {
          expect(place).toContain(e);
          onPlace++;
        }
      });
    }
    expect(onPlace).toBeGreaterThan(0);
  });

  it('stops within 5 ms once the decode turns towards the ball', () => {
    const sim = make();
    run(sim, 50, +1);
    let lastPulse = -1;
    for (let t = 0; t < 50; t++) {
      setScene(sim);
      force(sim, -1);
      sim.step();
      if (sim.stimulated.some((v) => v === 4) || sim.avoidancePulseActive()) lastPulse = t;
    }
    expect(lastPulse).toBeLessThan(5);
    expect(sim.avoidOn).toBe(false);
  });

  it('never stimulates while moving towards the ball, when aligned, or when the ball recedes', () => {
    const towards = make();
    expect(run(towards, 200, -1)).toBe(0);
    const aligned = make();
    expect(run(aligned, 200, +1, () => setScene(aligned, -0.5, 0.8))).toBe(0);
    const receding = make();
    expect(run(receding, 200, +1, () => setScene(receding, 0.5))).toBe(0);
  });

  it('caps avoidable stimulation per approach at maxMs', () => {
    const sim = make();
    sim.cfg.avoidance.maxMs = 100;
    run(sim, 300, +1);
    expect(sim.avoidMs).toBe(100);
    expect(run(sim, 100, +1)).toBe(0);
  });

  it('other modes never deliver avoidable stimulation', () => {
    const cfg = defaultConfig('silent');
    cfg.network.nNeurons = 300;
    const sim = new ClosedLoop(cfg, 3);
    sim.pong.p.paddleSpeed = 0;
    expect(run(sim, 200, +1)).toBe(0);
  });
});
