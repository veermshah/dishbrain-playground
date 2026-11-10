import type { FeedbackMode, Rally, SimConfig } from './core/closedLoop.ts';
import type { Role } from './core/mea.ts';
import type { RunResult, RunSpec } from './core/experiment.ts';

export type ToSim =
  | { type: 'init'; config: SimConfig; seed: number }
  | { type: 'mode'; mode: FeedbackMode }
  | { type: 'speed'; speed: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'step'; ms: number }
  | { type: 'plastic'; on: boolean };

export interface LayoutMsg {
  type: 'layout';
  n: number;
  nExc: number;
  x: Float32Array;
  y: Float32Array;
  electrodeOf: Int16Array;
  roles: Role[];
  sensoryByPlace: number[][];
  wMax: number;
}

export interface FrameMsg {
  type: 'frame';
  t: number;
  ballX: number;
  ballY: number;
  paddleY: number;
  paddleHeight: number;
  ballRadius: number;
  feedbackLeft: number;
  feedbackWindow: number;
  mode: FeedbackMode;
  paused: boolean;
  hits: number;
  misses: number;
  currentRally: number;
  newRallies: (Rally & { mode: FeedbackMode })[];
  /** Spikes per neuron per second for each electrode over the frame. */
  electrodeRate: Float32Array;
  /** 1 = sensory pulse, 2 = feedback pulse, during the frame. */
  stimulated: Uint8Array;
  spikeIds: Uint16Array;
  spikeTimes: Float64Array;
  /** Recent activity per neuron, 0-255. */
  activity: Uint8Array;
  rateUp: number;
  rateDown: number;
  command: number;
  meanW: number;
  /** Achieved simulation speed (sim ms per wall ms). */
  achieved: number;
  events: { t: number; kind: 'hit' | 'miss' }[];
}

export interface WeightsMsg {
  type: 'weights';
  t: number;
  hist: Float32Array;
}

export type FromSim = LayoutMsg | FrameMsg | WeightsMsg;

export type ToExp = { type: 'run'; id: number; spec: RunSpec };
export type FromExp =
  | { type: 'progress'; id: number; fraction: number }
  | { type: 'done'; id: number; result: RunResult };
