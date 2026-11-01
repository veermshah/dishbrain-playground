/**
 * Virtual 8x8 multi-electrode array (MEA).
 *
 * Each neuron sits in one cell of an 8x8 grid on the unit square and is
 * recorded/stimulated by that cell's electrode. Electrodes play one of
 * four roles, loosely following the DishBrain layout: a central sensory
 * strip that receives the game state, and two motor regions whose
 * firing rates move the paddle up or down.
 */
export const GRID = 8;
export const N_ELECTRODES = GRID * GRID;
/** Number of place-code positions on the sensory strip. */
export const N_PLACES = 8;

export type Role = 'sensory' | 'up' | 'down' | 'none';

export interface MeaLayout {
  roles: Role[];
  /** sensoryByPlace[k] = electrode ids for place k (k = 0 is "ball far above paddle"). */
  sensoryByPlace: number[][];
  sensory: number[];
  up: number[];
  down: number[];
}

export const electrodeId = (row: number, col: number): number => row * GRID + col;

/**
 * Columns 0-1: motor "up". Columns 6-7: motor "down".
 * Columns 3-4: sensory strip (row = place code position).
 * Columns 2 and 5: recording only.
 */
export function defaultLayout(): MeaLayout {
  const roles: Role[] = new Array(N_ELECTRODES).fill('none');
  const sensoryByPlace: number[][] = [];
  const up: number[] = [];
  const down: number[] = [];
  for (let r = 0; r < GRID; r++) {
    sensoryByPlace.push([electrodeId(r, 3), electrodeId(r, 4)]);
    for (const c of [0, 1]) up.push(electrodeId(r, c));
    for (const c of [6, 7]) down.push(electrodeId(r, c));
  }
  for (const e of up) roles[e] = 'up';
  for (const e of down) roles[e] = 'down';
  const sensory = sensoryByPlace.flat();
  for (const e of sensory) roles[e] = 'sensory';
  return { roles, sensoryByPlace, sensory, up, down };
}

/** Map each neuron (by position) to the electrode whose cell contains it. */
export function assignNeurons(xs: Float32Array, ys: Float32Array): Int16Array {
  const out = new Int16Array(xs.length);
  for (let i = 0; i < xs.length; i++) {
    const col = Math.min(GRID - 1, Math.floor(xs[i] * GRID));
    const row = Math.min(GRID - 1, Math.floor(ys[i] * GRID));
    out[i] = electrodeId(row, col);
  }
  return out;
}

/** Group neurons by electrode. */
export function electrodeMembers(electrodeOf: Int16Array): Int32Array[] {
  const lists: number[][] = Array.from({ length: N_ELECTRODES }, () => []);
  for (let i = 0; i < electrodeOf.length; i++) lists[electrodeOf[i]].push(i);
  return lists.map((l) => Int32Array.from(l));
}

export interface EncoderParams {
  /** Range of paddle-relative ball offsets covered by the place code. */
  placeSpan: number;
  /** Rate code: pulse frequency when the ball is at the far wall. */
  rateMinHz: number;
  /** Rate code: pulse frequency when the ball reaches the paddle. */
  rateMaxHz: number;
}

export const defaultEncoderParams: EncoderParams = {
  placeSpan: 1.0,
  rateMinHz: 4,
  rateMaxHz: 40,
};

/**
 * Place code: which of the N_PLACES sensory positions represents a
 * paddle-relative vertical offset (ballY - paddleY, y grows downward).
 */
export function placeIndex(relY: number, span: number): number {
  const f = (relY + span / 2) / span;
  const k = Math.floor(f * N_PLACES);
  return k < 0 ? 0 : k >= N_PLACES ? N_PLACES - 1 : k;
}

/** Rate code: pulse frequency from horizontal distance (0 = at paddle, 1 = far wall). */
export function pulseRateHz(distance: number, p: EncoderParams): number {
  const d = distance < 0 ? 0 : distance > 1 ? 1 : distance;
  return p.rateMinHz + (p.rateMaxHz - p.rateMinHz) * (1 - d);
}

/**
 * Stateful sensory encoder. Each call to `tick` advances 1 ms and returns
 * the place index to pulse this step, or -1 for no pulse.
 */
export class SensoryEncoder {
  private phase = 0;
  readonly p: EncoderParams;
  constructor(p: EncoderParams) {
    this.p = p;
  }

  reset(): void {
    this.phase = 0;
  }

  tick(relY: number, distance: number, dtMs = 1): number {
    this.phase += (pulseRateHz(distance, this.p) * dtMs) / 1000;
    if (this.phase >= 1) {
      this.phase -= 1;
      return placeIndex(relY, this.p.placeSpan);
    }
    return -1;
  }
}

export interface DecoderParams {
  /** Smoothing time constant of the motor rate estimate, ms. */
  tauMs: number;
  /** Rate difference (Hz per neuron) that maps to full paddle speed. */
  fullScaleHz: number;
}

export const defaultDecoderParams: DecoderParams = {
  tauMs: 100,
  fullScaleHz: 4,
};

/**
 * Motor decoder: exponentially smoothed per-neuron firing rates of the
 * "up" and "down" populations. The paddle command is their difference,
 * scaled and clipped to [-1, 1] (-1 = full speed up).
 */
export class MotorDecoder {
  rateUp = 0;
  rateDown = 0;
  readonly p: DecoderParams;
  readonly nUp: number;
  readonly nDown: number;
  private readonly decay: number;
  constructor(p: DecoderParams, nUp: number, nDown: number) {
    this.p = p;
    this.nUp = nUp;
    this.nDown = nDown;
    this.decay = Math.exp(-1 / p.tauMs);
  }

  /** Feed spike counts for one 1 ms step. */
  update(upSpikes: number, downSpikes: number): void {
    const k = 1 - this.decay;
    this.rateUp = this.decay * this.rateUp + k * ((upSpikes * 1000) / Math.max(1, this.nUp));
    this.rateDown =
      this.decay * this.rateDown + k * ((downSpikes * 1000) / Math.max(1, this.nDown));
  }

  command(): number {
    const c = (this.rateDown - this.rateUp) / this.p.fullScaleHz;
    return c < -1 ? -1 : c > 1 ? 1 : c;
  }

  reset(): void {
    this.rateUp = 0;
    this.rateDown = 0;
  }
}
