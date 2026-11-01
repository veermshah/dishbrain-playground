import { describe, expect, it } from 'vitest';
import { Pong } from '../src/core/pong.ts';
import { Rng } from '../src/core/rng.ts';

describe('Pong physics', () => {
  it('moves the ball in a straight line', () => {
    const g = new Pong();
    g.s = { ballX: 0.5, ballY: 0.5, vx: -0.5, vy: 0.2, paddleY: 0.5 };
    g.step(0.1, 0);
    expect(g.s.ballX).toBeCloseTo(0.45);
    expect(g.s.ballY).toBeCloseTo(0.52);
  });

  it('bounces off the top, bottom and back walls', () => {
    const g = new Pong();
    g.s = { ballX: 0.5, ballY: 0.02, vx: 0, vy: -0.5, paddleY: 0.5 };
    g.step(0.02, 0);
    expect(g.s.vy).toBeGreaterThan(0);
    expect(g.s.ballY).toBeGreaterThanOrEqual(g.p.ballRadius);
    g.s = { ballX: 0.5, ballY: 0.98, vx: 0, vy: 0.5, paddleY: 0.5 };
    g.step(0.02, 0);
    expect(g.s.vy).toBeLessThan(0);
    g.s = { ballX: 0.98, ballY: 0.5, vx: 0.5, vy: 0, paddleY: 0.5 };
    g.step(0.02, 0);
    expect(g.s.vx).toBeLessThan(0);
  });

  it('registers a hit and reflects when the paddle covers the ball', () => {
    const g = new Pong();
    g.s = { ballX: 0.02, ballY: 0.55, vx: -0.5, vy: 0, paddleY: 0.5 };
    expect(g.step(0.02, 0)).toBe('hit');
    expect(g.s.vx).toBeGreaterThan(0);
    // Hitting below the paddle centre sends the ball downward.
    expect(g.s.vy).toBeGreaterThan(0);
    const speed = Math.hypot(g.s.vx, g.s.vy);
    expect(speed).toBeCloseTo(0.5, 6);
  });

  it('registers a miss when the paddle is elsewhere', () => {
    const g = new Pong();
    g.s = { ballX: 0.02, ballY: 0.1, vx: -0.5, vy: 0, paddleY: 0.8 };
    expect(g.step(0.02, 0)).toBe('miss');
  });

  it('moves the paddle with the command and clamps it inside the field', () => {
    const g = new Pong();
    g.s.paddleY = 0.5;
    g.step(0.1, -1);
    expect(g.s.paddleY).toBeCloseTo(0.5 - g.p.paddleSpeed * 0.1);
    for (let i = 0; i < 100; i++) g.step(0.1, 5);
    expect(g.s.paddleY).toBeCloseTo(1 - g.p.paddleHeight / 2);
  });

  it('serves towards the paddle from the right half', () => {
    const g = new Pong();
    const rng = new Rng(1);
    for (let i = 0; i < 50; i++) {
      g.serve(rng);
      expect(g.s.vx).toBeLessThan(0);
      expect(g.s.ballX).toBeGreaterThan(0.5);
      expect(Math.hypot(g.s.vx, g.s.vy)).toBeCloseTo(g.p.ballSpeed, 6);
    }
  });
});
