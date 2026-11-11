import { Network, defaultNetworkParams, type NetworkParams } from './network.ts';
import {
  MotorDecoder,
  SensoryEncoder,
  assignNeurons,
  defaultDecoderParams,
  defaultEncoderParams,
  defaultLayout,
  electrodeMembers,
  placeIndex,
  N_ELECTRODES,
  type DecoderParams,
  type EncoderParams,
  type MeaLayout,
} from './mea.ts';
import { Pong, defaultPongParams, type PongParams, type PongEvent } from './pong.ts';
import { Rng } from './rng.ts';

/**
 * Feedback protocol.
 *  - dishbrain:     the protocol of Kagan et al. (2022). After a hit, a predictable
 *                   synchronous burst on every sensory electrode (100 Hz for 100 ms)
 *                   while play continues. After a miss, unpredictable stimulation
 *                   (random sensory sites, 5 Hz, double amplitude) for the 4 s window.
 *
 * Ablations, which change only what happens after a miss (hits get nothing):
 *  - predictable:   the 100 Hz / 100 ms synchronous burst on every sensory electrode
 *  - unpredictable: random pulses on random sensory electrodes for the whole window
 *  - silent:        no stimulation during the window, then the game resets
 *
 * Learning by stimulation avoidance (not part of the paper):
 *  - avoidance:     while the ball approaches and the paddle is out of line, the
 *                   place-coded sensory electrodes get high-frequency Poisson pulses.
 *                   They stop within a millisecond of a fast motor decode pointing the
 *                   paddle towards the ball. Misses get a quiet window, as in silent.
 */
export type FeedbackMode = 'dishbrain' | 'predictable' | 'unpredictable' | 'silent' | 'avoidance';
export const FEEDBACK_MODES: FeedbackMode[] = [
  'dishbrain',
  'predictable',
  'unpredictable',
  'silent',
  'avoidance',
];

export interface StimParams {
  /** Current injected into each neuron of a stimulated electrode. */
  amp: number;
  /** Pulse duration in ms. */
  durMs: number;
}

export interface FeedbackParams {
  /** Length of the post-miss window (game paused), ms. 4 s in the paper. */
  windowMs: number;
  /** Multiplier on feedback pulse amplitude. */
  strength: number;
  predictableHz: number;
  predictableMs: number;
  /** Event rate of the unpredictable stimulus. */
  unpredictableHz: number;
  /** Probability that each sensory electrode joins an unpredictable event. */
  unpredictableFraction: number;
  /** Amplitude multiplier of unpredictable pulses relative to sensory pulses. */
  unpredictableGain: number;
}

export interface AvoidanceParams {
  /** Poisson pulse rate of the avoidable stimulation, Hz. */
  rateHz: number;
  /** Amplitude multiplier relative to sensory pulses. */
  gain: number;
  /** Time constant of the fast motor decode that can switch the stimulation off, ms. */
  decodeTauMs: number;
  /** Minimum decoded command towards the ball that counts as "moving towards it". */
  threshold: number;
  /** The paddle counts as aligned when |ball - paddle| < alignFrac * paddleHeight / 2. */
  alignFrac: number;
  /** Cap on avoidable stimulation per approach of the ball, ms. */
  maxMs: number;
}

export type RewardMode = 'none' | 'contingent' | 'shuffled';

export interface RewardParams {
  /**
   * 'contingent': +hit after a hit and miss after a miss (R-STDP only).
   * 'shuffled':   at the same moments, the reward of a randomly chosen earlier
   *               outcome from the same session, which keeps the reward rate but
   *               breaks the link to behaviour.
   */
  mode: RewardMode;
  hit: number;
  miss: number;
  /**
   * If > 0, deliver reward minus a running average of past rewards (averaged
   * over roughly this many outcomes), i.e. a reward prediction error. 0 = off.
   */
  baselineEvents: number;
}

export interface SimConfig {
  network: NetworkParams;
  pong: PongParams;
  encoder: EncoderParams;
  decoder: DecoderParams;
  stim: StimParams;
  feedback: FeedbackParams;
  avoidance: AvoidanceParams;
  reward: RewardParams;
  mode: FeedbackMode;
}

export const defaultAvoidanceParams: AvoidanceParams = {
  rateHz: 200,
  gain: 2,
  decodeTauMs: 5,
  threshold: 0.05,
  alignFrac: 0.5,
  maxMs: 1500,
};

export const defaultRewardParams: RewardParams = {
  mode: 'none',
  hit: 1,
  miss: -1,
  baselineEvents: 0,
};

export const defaultFeedbackParams: FeedbackParams = {
  windowMs: 4000,
  strength: 1,
  predictableHz: 100,
  predictableMs: 100,
  unpredictableHz: 5,
  unpredictableFraction: 0.5,
  unpredictableGain: 2,
};

export function defaultConfig(mode: FeedbackMode = 'dishbrain'): SimConfig {
  return {
    network: { ...defaultNetworkParams },
    pong: { ...defaultPongParams },
    encoder: { ...defaultEncoderParams },
    decoder: { ...defaultDecoderParams },
    stim: { amp: 18, durMs: 2 },
    feedback: { ...defaultFeedbackParams },
    avoidance: { ...defaultAvoidanceParams },
    reward: { ...defaultRewardParams },
    mode,
  };
}

export interface Rally {
  /** Sim time (ms) at which the rally ended with a miss. */
  t: number;
  hits: number;
}

/**
 * The full closed loop: network <-> MEA <-> Pong, stepped 1 ms at a time.
 * Pure TypeScript with no DOM dependencies, so it runs in a worker or Node.
 */
export class ClosedLoop {
  readonly cfg: SimConfig;
  readonly net: Network;
  readonly pong: Pong;
  readonly layout: MeaLayout;
  readonly electrodeOf: Int16Array;
  readonly members: Int32Array[];
  readonly encoder: SensoryEncoder;
  readonly decoder: MotorDecoder;
  readonly isUp: Uint8Array;
  readonly isDown: Uint8Array;

  /** Spikes per electrode accumulated since last `drainElectrodeCounts`. */
  readonly electrodeCounts: Float32Array = new Float32Array(N_ELECTRODES);
  /**
   * Electrodes stimulated on the last step:
   * 1 = sensory pulse, 2 = post-miss feedback, 3 = post-hit feedback,
   * 4 = avoidable stimulation.
   */
  readonly stimulated: Uint8Array = new Uint8Array(N_ELECTRODES);

  mode: FeedbackMode;
  t = 0;
  hits = 0;
  misses = 0;
  currentRally = 0;
  readonly rallies: Rally[] = [];
  /** Remaining ms of post-miss feedback window (0 = playing). */
  feedbackLeft = 0;
  lastEvent: PongEvent = null;

  private readonly ext: Float32Array;
  private readonly stimLeft: Int16Array = new Int16Array(N_ELECTRODES);
  private readonly stimAmp: Float32Array = new Float32Array(N_ELECTRODES);
  private readonly stimKind: Uint8Array = new Uint8Array(N_ELECTRODES);
  private readonly rng: Rng;
  private feedbackElapsed = 0;
  /** ms since the last hit-triggered burst started, or -1 if none is running. */
  private hitBurstElapsed = -1;
  /** Fast motor decode used by the avoidance contingency. */
  readonly fastDecoder: MotorDecoder;
  /** ms of avoidable stimulation delivered during the current approach. */
  avoidMs = 0;
  /** True while avoidable stimulation is being delivered. */
  avoidOn = false;
  private readonly rewardRng: Rng;
  private readonly outcomes: number[] = [];

  constructor(cfg: SimConfig, seed: number) {
    this.cfg = cfg;
    this.mode = cfg.mode;
    this.net = new Network(cfg.network, seed);
    this.pong = new Pong(cfg.pong);
    this.rng = Rng.derive(seed, 3);
    this.layout = defaultLayout();
    this.electrodeOf = assignNeurons(this.net.x, this.net.y);
    this.members = electrodeMembers(this.electrodeOf);
    this.encoder = new SensoryEncoder(cfg.encoder);
    this.isUp = new Uint8Array(this.net.n);
    this.isDown = new Uint8Array(this.net.n);
    let nUp = 0;
    let nDown = 0;
    for (const e of this.layout.up)
      for (const i of this.members[e]) {
        this.isUp[i] = 1;
        nUp++;
      }
    for (const e of this.layout.down)
      for (const i of this.members[e]) {
        this.isDown[i] = 1;
        nDown++;
      }
    this.decoder = new MotorDecoder(cfg.decoder, nUp, nDown);
    this.fastDecoder = new MotorDecoder(
      { ...cfg.decoder, tauMs: cfg.avoidance.decodeTauMs },
      nUp,
      nDown,
    );
    this.rewardRng = Rng.derive(seed, 4);
    this.ext = new Float32Array(this.net.n);
    this.pong.serve(this.rng);
  }

  private pulse(e: number, amp: number, kind = 0): void {
    this.stimLeft[e] = this.cfg.stim.durMs;
    this.stimAmp[e] = amp;
    this.stimKind[e] = kind;
  }

  /** Advance the whole loop by 1 ms. */
  step(): void {
    const { cfg, pong, stimLeft, stimAmp, ext, members, stimulated } = this;
    this.lastEvent = null;
    stimulated.fill(0);

    if (this.feedbackLeft > 0) {
      this.feedbackStep();
    } else {
      if (this.hitBurstElapsed >= 0) this.hitBurstStep();
      if (this.mode === 'avoidance') this.avoidanceStep();
      else this.avoidOn = false;
      const s = pong.s;
      const place = this.encoder.tick(s.ballY - s.paddleY, s.ballX);
      if (place >= 0) {
        for (const e of this.layout.sensoryByPlace[place]) {
          this.pulse(e, cfg.stim.amp);
          if (!stimulated[e]) stimulated[e] = 1;
        }
      }
    }

    // Build external current from active pulses.
    ext.fill(0);
    for (let e = 0; e < N_ELECTRODES; e++) {
      if (stimLeft[e] > 0) {
        const m = members[e];
        const amp = stimAmp[e];
        for (let q = 0; q < m.length; q++) ext[m[q]] += amp;
        stimLeft[e]--;
      }
    }

    const net = this.net;
    const ns = net.step(ext);
    let up = 0;
    let down = 0;
    const { spikes } = net;
    const { electrodeOf, electrodeCounts, isUp, isDown } = this;
    for (let q = 0; q < ns; q++) {
      const i = spikes[q];
      electrodeCounts[electrodeOf[i]]++;
      up += isUp[i];
      down += isDown[i];
    }
    this.decoder.update(up, down);
    this.fastDecoder.update(up, down);

    if (this.feedbackLeft > 0) {
      this.feedbackLeft--;
      if (this.feedbackLeft === 0) {
        this.pong.serve(this.rng);
        this.encoder.reset();
        this.avoidMs = 0;
      }
    } else {
      const ev = pong.step(0.001, this.decoder.command());
      this.lastEvent = ev;
      if (ev === 'hit') {
        this.hits++;
        this.currentRally++;
        if (this.mode === 'dishbrain') this.hitBurstElapsed = 0;
        this.avoidMs = 0;
        this.deliverReward(true);
      } else if (ev === 'miss') {
        this.hitBurstElapsed = -1;
        this.stopAvoidance();
        this.deliverReward(false);
        this.misses++;
        this.rallies.push({ t: this.t, hits: this.currentRally });
        this.currentRally = 0;
        this.feedbackLeft = cfg.feedback.windowMs;
        this.feedbackElapsed = 0;
      }
    }
    this.t++;
  }

  /**
   * Learning-by-stimulation-avoidance contingency. Runs before the network
   * step, so the decision uses activity up to the previous millisecond.
   */
  private avoidanceStep(): void {
    const a = this.cfg.avoidance;
    const s = this.pong.s;
    const rel = s.ballY - s.paddleY;
    const half = this.pong.p.paddleHeight / 2;
    const approaching = s.vx < 0;
    const misaligned = Math.abs(rel) > a.alignFrac * half;
    const towards = this.fastDecoder.command() * Math.sign(rel) > a.threshold;
    const active = approaching && misaligned && !towards && this.avoidMs < a.maxMs;
    if (!active) {
      if (this.avoidOn) this.stopAvoidance();
      return;
    }
    this.avoidOn = true;
    this.avoidMs++;
    if (this.rng.next() < a.rateHz / 1000) {
      const place = placeIndex(rel, this.cfg.encoder.placeSpan);
      const amp = this.cfg.stim.amp * a.gain;
      for (const e of this.layout.sensoryByPlace[place]) {
        this.pulse(e, amp, 4);
        this.stimulated[e] = 4;
      }
    }
  }

  /** Whether any avoidable pulse is currently injecting current. */
  avoidancePulseActive(): boolean {
    for (const e of this.layout.sensory)
      if (this.stimLeft[e] > 0 && this.stimKind[e] === 4) return true;
    return false;
  }

  /** Cut any avoidable pulse that is still running. */
  private stopAvoidance(): void {
    this.avoidOn = false;
    for (const e of this.layout.sensory) {
      if (this.stimLeft[e] > 0 && this.stimKind[e] === 4) this.stimLeft[e] = 0;
    }
  }

  private deliverReward(hit: boolean): void {
    const r = this.cfg.reward;
    if (r.mode === 'none') return;
    const value = hit ? r.hit : r.miss;
    this.outcomes.push(value);
    const raw =
      r.mode === 'contingent' ? value : this.outcomes[this.rewardRng.int(this.outcomes.length)];
    let delivered = raw;
    if (r.baselineEvents > 0) {
      delivered = raw - this.rewardBaseline;
      this.rewardBaseline += (raw - this.rewardBaseline) / r.baselineEvents;
    }
    this.lastReward = delivered;
    this.net.applyReward(delivered);
  }

  /** Reward delivered on the last hit or miss (0 before any). */
  lastReward = 0;
  private rewardBaseline = 0;

  /** Predictable burst after a hit (dishbrain mode); the game keeps running. */
  private hitBurstStep(): void {
    const f = this.cfg.feedback;
    const period = Math.max(1, Math.round(1000 / f.predictableHz));
    if (this.hitBurstElapsed % period === 0) {
      const amp = this.cfg.stim.amp * f.strength;
      for (const e of this.layout.sensory) {
        this.pulse(e, amp);
        this.stimulated[e] = 3;
      }
    }
    this.hitBurstElapsed++;
    if (this.hitBurstElapsed >= f.predictableMs) this.hitBurstElapsed = -1;
  }

  private feedbackStep(): void {
    const f = this.cfg.feedback;
    const amp = this.cfg.stim.amp * f.strength;
    const sensory = this.layout.sensory;
    if (this.mode === 'predictable') {
      const period = Math.max(1, Math.round(1000 / f.predictableHz));
      if (this.feedbackElapsed < f.predictableMs) {
        if (this.feedbackElapsed % period === 0) {
          for (const e of sensory) {
            this.pulse(e, amp);
            this.stimulated[e] = 2;
          }
        }
      }
    } else if (this.mode === 'unpredictable' || this.mode === 'dishbrain') {
      if (this.rng.next() < f.unpredictableHz / 1000) {
        for (const e of sensory) {
          if (this.rng.next() < f.unpredictableFraction) {
            this.pulse(e, amp * f.unpredictableGain);
            this.stimulated[e] = 2;
          }
        }
      }
    }
    this.feedbackElapsed++;
  }

  /**
   * How "correct" the sensory-to-motor wiring is: mean E->E weight from
   * "ball above" sensory neurons to the up region minus to the down region,
   * minus the same difference for "ball below" sensory neurons. 0 at random,
   * positive when the weights favour moving towards the ball.
   */
  mappingIndex(): number {
    const net = this.net;
    let placeOf = this.placeOf;
    if (!placeOf) {
      const p = new Int8Array(net.n).fill(-1);
      this.layout.sensoryByPlace.forEach((els, k) =>
        els.forEach((e) => this.members[e].forEach((i) => (p[i] = k))),
      );
      this.placeOf = placeOf = p;
    }
    const half = this.layout.sensoryByPlace.length / 2;
    const acc = [0, 0, 0, 0];
    const cnt = [0, 0, 0, 0];
    for (let i = 0; i < net.nExc; i++) {
      const k0: number = placeOf[i];
      if (k0 < 0) continue;
      const base: number = k0 < half ? 0 : 2;
      for (let syn = net.outStart[i]; syn < net.outStart[i + 1]; syn++) {
        const j = net.outTarget[syn];
        if (j >= net.nExc) continue;
        const k = this.isUp[j] ? base : this.isDown[j] ? base + 1 : -1;
        if (k < 0) continue;
        acc[k] += net.w[syn];
        cnt[k]++;
      }
    }
    const m = acc.map((a, k) => (cnt[k] ? a / cnt[k] : 0));
    return m[0] - m[1] - (m[2] - m[3]);
  }
  private placeOf: Int8Array | null = null;

  /**
   * +1 if the decoded command points the paddle towards the ball, -1 if away,
   * 0 when the ball is receding, roughly aligned, or the game is paused.
   */
  steeringSign(): number {
    if (this.feedbackLeft > 0) return 0;
    const s = this.pong.s;
    if (s.vx >= 0) return 0;
    const rel = s.ballY - s.paddleY;
    if (Math.abs(rel) < this.pong.p.paddleHeight / 4) return 0;
    const c = this.decoder.command();
    return c === 0 ? 0 : Math.sign(c) * Math.sign(rel);
  }

  run(ms: number): void {
    for (let k = 0; k < ms; k++) this.step();
  }

  drainElectrodeCounts(out: Float32Array): void {
    out.set(this.electrodeCounts);
    this.electrodeCounts.fill(0);
  }
}
