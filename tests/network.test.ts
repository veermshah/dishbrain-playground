import { describe, expect, it } from 'vitest';
import { Network } from '../src/core/network.ts';
import { Rng } from '../src/core/rng.ts';

describe('Rng', () => {
  it('is reproducible for a given seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const xs = Array.from({ length: 100 }, () => a.next());
    const ys = Array.from({ length: 100 }, () => b.next());
    expect(xs).toEqual(ys);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('gives different streams for different seeds and salts', () => {
    expect(new Rng(1).next()).not.toEqual(new Rng(2).next());
    expect(Rng.derive(7, 1).next()).not.toEqual(Rng.derive(7, 2).next());
  });

  it('produces roughly standard normal samples', () => {
    const r = new Rng(3);
    const n = 20000;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const x = r.normal();
      sum += x;
      sq += x * x;
    }
    const mean = sum / n;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(sq / n - mean * mean - 1)).toBeLessThan(0.05);
  });
});

describe('Network', () => {
  const small = { nNeurons: 200, connectionProb: 0.1 };

  it('builds 80/20 E/I with fixed out-degree and no self-connections', () => {
    const net = new Network({ nNeurons: 1000 }, 1);
    expect(net.nExc).toBe(800);
    const k = net.outStart[1] - net.outStart[0];
    expect(k).toBe(100);
    for (let i = 0; i < net.n; i++) {
      expect(net.outStart[i + 1] - net.outStart[i]).toBe(k);
      for (let s = net.outStart[i]; s < net.outStart[i + 1]; s++) {
        expect(net.outTarget[s]).not.toBe(i);
        if (i >= net.nExc) expect(net.w[s]).toBeLessThan(0);
        else expect(net.w[s]).toBeGreaterThan(0);
        expect(net.plasticSyn[s]).toBe(i < net.nExc && net.outTarget[s] < net.nExc ? 1 : 0);
      }
    }
  });

  it('is deterministic given a seed', () => {
    const run = (seed: number) => {
      const net = new Network(small, seed);
      const trace: number[] = [];
      for (let t = 0; t < 2000; t++) {
        net.step(null);
        for (let q = 0; q < net.nSpikes; q++) trace.push(t * 1000 + net.spikes[q]);
      }
      return { trace, v: Array.from(net.v), w: Array.from(net.w) };
    };
    const a = run(11);
    const b = run(11);
    expect(a.trace.length).toBeGreaterThan(0);
    expect(a.trace).toEqual(b.trace);
    expect(a.v).toEqual(b.v);
    expect(a.w).toEqual(b.w);
    expect(run(12).trace).not.toEqual(a.trace);
  });

  it('matches the Izhikevich update for a single isolated neuron', () => {
    const net = new Network({ nNeurons: 10, noiseRate: 0, plastic: false }, 5);
    const ext = new Float32Array(net.n);
    ext[0] = 10;
    let v = -65;
    let u = net.b[0] * -65;
    for (let t = 0; t < 50; t++) {
      net.step(ext);
      v += 0.5 * (0.04 * v * v + 5 * v + 140 - u + 10);
      v += 0.5 * (0.04 * v * v + 5 * v + 140 - u + 10);
      if (v >= 30) {
        u = u + net.a[0] * (net.b[0] * v - u) + net.d[0];
        v = net.c[0];
        break;
      }
      u = u + net.a[0] * (net.b[0] * v - u);
      expect(net.v[0]).toBeCloseTo(v, 3);
      expect(net.u[0]).toBeCloseTo(u, 3);
    }
  });

  it('stays quiet without input or noise and fires with background noise', () => {
    const quiet = new Network({ ...small, noiseRate: 0 }, 2);
    let n0 = 0;
    for (let t = 0; t < 500; t++) n0 += quiet.step(null);
    expect(n0).toBe(0);
    const noisy = new Network({ nNeurons: 1000 }, 2);
    let n1 = 0;
    for (let t = 0; t < 1000; t++) n1 += noisy.step(null);
    const rateHz = n1 / noisy.n;
    expect(rateHz).toBeGreaterThan(0.5);
    expect(rateHz).toBeLessThan(40);
  });
});

describe('STDP', () => {
  /** Two excitatory neurons connected both ways; force spikes at chosen times. */
  function pairing(tFirst: number, tSecond: number) {
    const net = new Network(
      { nNeurons: 2, excFraction: 1, connectionProb: 1, noiseRate: 0, wExc: 1, maxDelay: 1 },
      9,
    );
    const w01 = net.outStart[0]; // synapse 0 -> 1
    const w10 = net.outStart[1]; // synapse 1 -> 0
    const before = { w01: net.w[w01], w10: net.w[w10] };
    const ext = new Float32Array(2);
    for (let t = 0; t < 60; t++) {
      ext[0] = t === tFirst ? 200 : 0;
      ext[1] = t === tSecond ? 200 : 0;
      net.step(ext);
    }
    return { dw01: net.w[w01] - before.w01, dw10: net.w[w10] - before.w10 };
  }

  it('potentiates pre-before-post and depresses post-before-pre', () => {
    // Neuron 0 fires at t=10, neuron 1 at t=15.
    const { dw01, dw10 } = pairing(10, 15);
    expect(dw01).toBeGreaterThan(0); // 0 -> 1: pre before post
    expect(dw10).toBeLessThan(0); // 1 -> 0: post before pre
  });

  it('flips sign when the order flips', () => {
    const { dw01, dw10 } = pairing(15, 10);
    expect(dw01).toBeLessThan(0);
    expect(dw10).toBeGreaterThan(0);
  });

  it('decays with the spike-time difference', () => {
    const near = pairing(10, 12).dw01;
    const far = pairing(10, 40).dw01;
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
  });

  it('keeps weights within [0, wMax] and does nothing when plasticity is off', () => {
    const net = new Network({ nNeurons: 300, aPlus: 2, aMinus: 2, noiseRate: 0.02 }, 4);
    for (let t = 0; t < 2000; t++) net.step(null);
    for (let s = 0; s < net.w.length; s++) {
      if (!net.plasticSyn[s]) continue;
      expect(net.w[s]).toBeGreaterThanOrEqual(0);
      expect(net.w[s]).toBeLessThanOrEqual(net.p.wMax);
    }
    const frozen = new Network({ nNeurons: 300, plastic: false, noiseRate: 0.02 }, 4);
    const w0 = Array.from(frozen.w);
    for (let t = 0; t < 1000; t++) frozen.step(null);
    expect(Array.from(frozen.w)).toEqual(w0);
  });
});
