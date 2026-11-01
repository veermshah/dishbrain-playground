import type { Rng } from './rng.ts';

/**
 * Minimal single-player Pong on the unit square.
 * The paddle lives on the left wall (x = 0). y grows downward.
 */
export interface PongParams {
  paddleHeight: number;
  ballRadius: number;
  /** Ball speed in field widths per second. */
  ballSpeed: number;
  /** Paddle speed at full command, field heights per second. */
  paddleSpeed: number;
  /** Max bounce angle off the paddle, radians. */
  maxBounceAngle: number;
}

export const defaultPongParams: PongParams = {
  paddleHeight: 0.22,
  ballRadius: 0.015,
  ballSpeed: 0.55,
  paddleSpeed: 0.9,
  maxBounceAngle: (55 * Math.PI) / 180,
};

export interface PongState {
  ballX: number;
  ballY: number;
  vx: number;
  vy: number;
  paddleY: number;
}

export type PongEvent = 'hit' | 'miss' | null;

export class Pong {
  readonly p: PongParams;
  s: PongState;

  constructor(params: Partial<PongParams> = {}) {
    this.p = { ...defaultPongParams, ...params };
    this.s = { ballX: 0.8, ballY: 0.5, vx: -this.p.ballSpeed, vy: 0, paddleY: 0.5 };
  }

  /** Serve a new ball from the right half towards the paddle at a random angle. */
  serve(rng: Rng): void {
    const angle = (rng.next() * 2 - 1) * (Math.PI / 4);
    const sp = this.p.ballSpeed;
    this.s.ballX = 0.75 + 0.15 * rng.next();
    this.s.ballY = 0.15 + 0.7 * rng.next();
    this.s.vx = -sp * Math.cos(angle);
    this.s.vy = sp * Math.sin(angle);
  }

  /**
   * Advance by dt seconds with paddle command in [-1, 1] (negative = up).
   * Returns 'hit' or 'miss' when the ball reaches the paddle wall.
   */
  step(dt: number, command: number): PongEvent {
    const { p, s } = this;
    const half = p.paddleHeight / 2;
    const cmd = command < -1 ? -1 : command > 1 ? 1 : command;
    s.paddleY += cmd * p.paddleSpeed * dt;
    if (s.paddleY < half) s.paddleY = half;
    if (s.paddleY > 1 - half) s.paddleY = 1 - half;

    s.ballX += s.vx * dt;
    s.ballY += s.vy * dt;
    const r = p.ballRadius;
    if (s.ballY < r) {
      s.ballY = 2 * r - s.ballY;
      s.vy = Math.abs(s.vy);
    } else if (s.ballY > 1 - r) {
      s.ballY = 2 * (1 - r) - s.ballY;
      s.vy = -Math.abs(s.vy);
    }
    if (s.ballX > 1 - r) {
      s.ballX = 2 * (1 - r) - s.ballX;
      s.vx = -Math.abs(s.vx);
    }
    if (s.ballX <= r && s.vx < 0) {
      const offset = s.ballY - s.paddleY;
      if (Math.abs(offset) <= half + r) {
        const rel = Math.max(-1, Math.min(1, offset / (half + r)));
        const angle = rel * p.maxBounceAngle;
        const sp = Math.hypot(s.vx, s.vy);
        s.vx = sp * Math.cos(angle);
        s.vy = sp * Math.sin(angle);
        s.ballX = 2 * r - s.ballX;
        return 'hit';
      }
      return 'miss';
    }
    return null;
  }
}
