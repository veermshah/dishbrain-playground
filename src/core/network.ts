import { Rng } from './rng.ts';

/**
 * A sparse recurrent network of Izhikevich (2003) neurons with
 * trace-based additive STDP on excitatory-to-excitatory synapses.
 *
 * Everything lives in flat typed arrays so a 1000-neuron network
 * runs many times faster than real time in a single thread.
 */
export interface NetworkParams {
  /** Total neuron count. 80% excitatory, 20% inhibitory. */
  nNeurons: number;
  /** Fraction of excitatory neurons. */
  excFraction: number;
  /** Probability that any given pair is connected (sets the out-degree). */
  connectionProb: number;
  /** Initial excitatory weight (mean). */
  wExc: number;
  /** Inhibitory weight (negative current). */
  wInh: number;
  /** Upper bound for plastic weights. */
  wMax: number;
  /** Maximum axonal delay for excitatory synapses, in ms. */
  maxDelay: number;
  /** STDP potentiation step (pre before post). */
  aPlus: number;
  /** STDP depression step (post before pre). */
  aMinus: number;
  /** STDP time constant in ms (shared by both sides of the window). */
  tauStdp: number;
  /** Probability per neuron per ms of a background input kick. */
  noiseRate: number;
  /** Amplitude of a background kick. */
  noiseAmp: number;
  /** Whether STDP is active. */
  plastic: boolean;
}

export const defaultNetworkParams: NetworkParams = {
  nNeurons: 1000,
  excFraction: 0.8,
  connectionProb: 0.1,
  wExc: 6,
  wInh: -5,
  wMax: 10,
  maxDelay: 10,
  aPlus: 0.06,
  aMinus: 0.072,
  tauStdp: 20,
  noiseRate: 0.0025,
  noiseAmp: 20,
  plastic: true,
};

export class Network {
  readonly p: NetworkParams;
  readonly n: number;
  readonly nExc: number;
  readonly a: Float32Array;
  readonly b: Float32Array;
  readonly c: Float32Array;
  readonly d: Float32Array;
  readonly v: Float32Array;
  readonly u: Float32Array;
  /** Spatial layout on the unit square (used to map neurons to electrodes). */
  readonly x: Float32Array;
  readonly y: Float32Array;

  // Outgoing synapses in CSR form. Synapse id = index into these arrays.
  readonly outStart: Int32Array;
  readonly outTarget: Int32Array;
  readonly outDelay: Uint8Array;
  readonly w: Float32Array;
  readonly plasticSyn: Uint8Array;

  // Incoming plastic synapses (for LTP on a post spike).
  readonly inStart: Int32Array;
  readonly inSyn: Int32Array;
  readonly inSrc: Int32Array;

  /** One exponential spike trace per neuron (pre and post share tau). */
  readonly trace: Float32Array;
  private readonly traceDecay: number;

  /** Ring buffer of delayed synaptic input, maxDelay+1 slots of n. */
  private readonly delayBuf: Float32Array;
  private readonly slots: number;

  /** Indices of neurons that spiked on the last step. */
  readonly spikes: Int32Array;
  nSpikes = 0;
  t = 0;
  private readonly rng: Rng;
  private readonly input: Float32Array;

  constructor(params: Partial<NetworkParams>, seed: number) {
    const p = { ...defaultNetworkParams, ...params };
    this.p = p;
    const n = Math.max(2, Math.round(p.nNeurons));
    const nExc = Math.round(n * p.excFraction);
    this.n = n;
    this.nExc = nExc;
    const rng = Rng.derive(seed, 1);
    this.rng = Rng.derive(seed, 2);

    this.a = new Float32Array(n);
    this.b = new Float32Array(n);
    this.c = new Float32Array(n);
    this.d = new Float32Array(n);
    this.v = new Float32Array(n);
    this.u = new Float32Array(n);
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);

    // Izhikevich (2003) heterogeneous regular-spiking / fast-spiking mix.
    for (let i = 0; i < n; i++) {
      const r = rng.next();
      if (i < nExc) {
        this.a[i] = 0.02;
        this.b[i] = 0.2;
        this.c[i] = -65 + 15 * r * r;
        this.d[i] = 8 - 6 * r * r;
      } else {
        this.a[i] = 0.02 + 0.08 * r;
        this.b[i] = 0.25 - 0.05 * r;
        this.c[i] = -65;
        this.d[i] = 2;
      }
      this.v[i] = -65;
      this.u[i] = this.b[i] * -65;
      this.x[i] = rng.next();
      this.y[i] = rng.next();
    }

    // Fixed out-degree random connectivity, no self-connections.
    const k = Math.max(1, Math.min(n - 1, Math.round(p.connectionProb * (n - 1))));
    const nSyn = n * k;
    this.outStart = new Int32Array(n + 1);
    this.outTarget = new Int32Array(nSyn);
    this.outDelay = new Uint8Array(nSyn);
    this.w = new Float32Array(nSyn);
    this.plasticSyn = new Uint8Array(nSyn);
    const maxDelay = Math.max(1, Math.min(250, Math.round(p.maxDelay)));
    const chosen = new Uint8Array(n);
    const picks = new Int32Array(k);
    let s = 0;
    for (let i = 0; i < n; i++) {
      this.outStart[i] = s;
      let m = 0;
      while (m < k) {
        const j = rng.int(n);
        if (j === i || chosen[j]) continue;
        chosen[j] = 1;
        picks[m++] = j;
      }
      picks.sort();
      for (let q = 0; q < k; q++) {
        const j = picks[q];
        chosen[j] = 0;
        this.outTarget[s] = j;
        if (i < nExc) {
          this.w[s] = p.wExc * (0.75 + 0.5 * rng.next());
          this.outDelay[s] = 1 + rng.int(maxDelay);
          this.plasticSyn[s] = j < nExc ? 1 : 0;
        } else {
          this.w[s] = p.wInh;
          this.outDelay[s] = 1;
        }
        s++;
      }
    }
    this.outStart[n] = s;

    // Build the incoming index for plastic synapses.
    const inCount = new Int32Array(n);
    for (let syn = 0; syn < nSyn; syn++) if (this.plasticSyn[syn]) inCount[this.outTarget[syn]]++;
    this.inStart = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) this.inStart[i + 1] = this.inStart[i] + inCount[i];
    const fill = this.inStart.slice(0, n);
    this.inSyn = new Int32Array(this.inStart[n]);
    this.inSrc = new Int32Array(this.inStart[n]);
    for (let i = 0; i < n; i++) {
      for (let syn = this.outStart[i]; syn < this.outStart[i + 1]; syn++) {
        if (!this.plasticSyn[syn]) continue;
        const j = this.outTarget[syn];
        const at = fill[j]++;
        this.inSyn[at] = syn;
        this.inSrc[at] = i;
      }
    }

    this.trace = new Float32Array(n);
    this.traceDecay = Math.exp(-1 / p.tauStdp);
    this.slots = maxDelay + 1;
    this.delayBuf = new Float32Array(this.slots * n);
    this.spikes = new Int32Array(n);
    this.input = new Float32Array(n);
  }

  /**
   * Advance the network by 1 ms.
   * @param ext external current per neuron for this step (may be null)
   * @returns number of spikes this step (indices in `spikes`)
   */
  step(ext: Float32Array | null): number {
    const { n, v, u, a, b, c, d, delayBuf, input, trace, p } = this;
    const slot = this.t % this.slots;
    const base = slot * n;
    const rng = this.rng;
    const noiseRate = p.noiseRate;
    const noiseAmp = p.noiseAmp;

    for (let i = 0; i < n; i++) {
      let I = delayBuf[base + i];
      delayBuf[base + i] = 0;
      if (ext !== null) I += ext[i];
      if (rng.next() < noiseRate) I += noiseAmp;
      input[i] = I;
    }

    let ns = 0;
    const spikes = this.spikes;
    for (let i = 0; i < n; i++) {
      let vi = v[i];
      const ui = u[i];
      const I = input[i];
      // Two half-steps for numerical stability (as in Izhikevich 2003).
      vi += 0.5 * (0.04 * vi * vi + 5 * vi + 140 - ui + I);
      vi += 0.5 * (0.04 * vi * vi + 5 * vi + 140 - ui + I);
      if (vi >= 30 || vi !== vi) {
        v[i] = c[i];
        u[i] = vi === vi ? ui + a[i] * (b[i] * 30 - ui) + d[i] : b[i] * c[i];
        spikes[ns++] = i;
      } else {
        v[i] = vi;
        u[i] = ui + a[i] * (b[i] * vi - ui);
      }
    }
    this.nSpikes = ns;

    // Propagate spikes into the delay buffer.
    const { outStart, outTarget, outDelay, w, slots } = this;
    const t = this.t;
    for (let q = 0; q < ns; q++) {
      const i = spikes[q];
      for (let syn = outStart[i]; syn < outStart[i + 1]; syn++) {
        const at = ((t + outDelay[syn]) % slots) * n + outTarget[syn];
        delayBuf[at] += w[syn];
      }
    }

    // STDP, then update traces.
    const decay = this.traceDecay;
    for (let i = 0; i < n; i++) trace[i] *= decay;
    if (p.plastic) this.applyStdp(ns);
    for (let q = 0; q < ns; q++) trace[spikes[q]] += 1;

    this.t++;
    return ns;
  }

  /**
   * Additive nearest-trace STDP. For each spike of neuron i:
   *  - LTD on its outgoing plastic synapses, scaled by the target's trace
   *    (the target fired before i: post-before-pre).
   *  - LTP on its incoming plastic synapses, scaled by the source's trace
   *    (the source fired before i: pre-before-post).
   */
  private applyStdp(ns: number): void {
    const { spikes, outStart, outTarget, plasticSyn, w, inStart, inSyn, inSrc, trace, nExc } =
      this;
    const { aPlus, aMinus, wMax } = this.p;
    for (let q = 0; q < ns; q++) {
      const i = spikes[q];
      if (i < nExc) {
        for (let syn = outStart[i]; syn < outStart[i + 1]; syn++) {
          if (!plasticSyn[syn]) continue;
          const tr = trace[outTarget[syn]];
          if (tr > 1e-4) {
            const nw = w[syn] - aMinus * tr;
            w[syn] = nw < 0 ? 0 : nw;
          }
        }
      }
      for (let k = inStart[i]; k < inStart[i + 1]; k++) {
        const tr = trace[inSrc[k]];
        if (tr > 1e-4) {
          const syn = inSyn[k];
          const nw = w[syn] + aPlus * tr;
          w[syn] = nw > wMax ? wMax : nw;
        }
      }
    }
  }

  /** Mean of all plastic weights. */
  meanPlasticWeight(): number {
    let sum = 0;
    let cnt = 0;
    for (let s = 0; s < this.w.length; s++) {
      if (this.plasticSyn[s]) {
        sum += this.w[s];
        cnt++;
      }
    }
    return cnt ? sum / cnt : 0;
  }

  /** Histogram of plastic weights over [0, wMax]. */
  weightHistogram(bins: number): Float32Array {
    const h = new Float32Array(bins);
    const scale = bins / this.p.wMax;
    for (let s = 0; s < this.w.length; s++) {
      if (!this.plasticSyn[s]) continue;
      let k = Math.floor(this.w[s] * scale);
      if (k >= bins) k = bins - 1;
      h[k]++;
    }
    return h;
  }
}
