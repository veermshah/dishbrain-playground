import { Network, defaultNetworkParams, type NetworkParams } from './network.ts';
import {
  MotorDecoder,
  SensoryEncoder,
  assignNeurons,
  defaultDecoderParams,
  defaultEncoderParams,
  defaultLayout,
  electrodeMembers,
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
 */
export type FeedbackMode = 'dishbrain' | 'predictable' | 'unpredictable' | 'silent';
export const FEEDBACK_MODES: FeedbackMode[] = [
  'dishbrain',
  'predictable',
  'unpredictable',
  'silent',
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

export interface SimConfig {
  network: NetworkParams;
  pong: PongParams;
  encoder: EncoderParams;
  decoder: DecoderParams;
  stim: StimParams;
  feedback: FeedbackParams;
  mode: FeedbackMode;
}

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
   * 1 = sensory pulse, 2 = post-miss feedback, 3 = post-hit feedback.
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
  private readonly rng: Rng;
  private feedbackElapsed = 0;
  /** ms since the last hit-triggered burst started, or -1 if none is running. */
  private hitBurstElapsed = -1;

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
    this.ext = new Float32Array(this.net.n);
    this.pong.serve(this.rng);
  }

  private pulse(e: number, amp: number): void {
    this.stimLeft[e] = this.cfg.stim.durMs;
    this.stimAmp[e] = amp;
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

    if (this.feedbackLeft > 0) {
      this.feedbackLeft--;
      if (this.feedbackLeft === 0) {
        this.pong.serve(this.rng);
        this.encoder.reset();
      }
    } else {
      const ev = pong.step(0.001, this.decoder.command());
      this.lastEvent = ev;
      if (ev === 'hit') {
        this.hits++;
        this.currentRally++;
        if (this.mode === 'dishbrain') this.hitBurstElapsed = 0;
      } else if (ev === 'miss') {
        this.hitBurstElapsed = -1;
        this.misses++;
        this.rallies.push({ t: this.t, hits: this.currentRally });
        this.currentRally = 0;
        this.feedbackLeft = cfg.feedback.windowMs;
        this.feedbackElapsed = 0;
      }
    }
    this.t++;
  }

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

  run(ms: number): void {
    for (let k = 0; k < ms; k++) this.step();
  }

  drainElectrodeCounts(out: Float32Array): void {
    out.set(this.electrodeCounts);
    this.electrodeCounts.fill(0);
  }
}
