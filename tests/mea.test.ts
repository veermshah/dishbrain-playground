import { describe, expect, it } from 'vitest';
import {
  GRID,
  MotorDecoder,
  N_PLACES,
  SensoryEncoder,
  assignNeurons,
  defaultEncoderParams,
  defaultLayout,
  electrodeMembers,
  placeIndex,
  pulseRateHz,
} from '../src/core/mea.ts';

describe('MEA layout', () => {
  it('has 8 place positions of 2 sensory electrodes and symmetric motor regions', () => {
    const L = defaultLayout();
    expect(L.roles).toHaveLength(GRID * GRID);
    expect(L.sensoryByPlace).toHaveLength(N_PLACES);
    expect(L.sensory).toHaveLength(16);
    expect(L.up).toHaveLength(16);
    expect(L.down).toHaveLength(16);
    const all = new Set([...L.sensory, ...L.up, ...L.down]);
    expect(all.size).toBe(48);
    expect(L.roles.filter((r) => r === 'none')).toHaveLength(16);
  });

  it('assigns every neuron to the electrode cell that contains it', () => {
    const xs = Float32Array.from([0, 0.99, 0.5, 0.13, 1]);
    const ys = Float32Array.from([0, 0.99, 0.5, 0.9, 1]);
    const e = assignNeurons(xs, ys);
    expect(Array.from(e)).toEqual([0, 63, 4 * 8 + 4, 7 * 8 + 1, 63]);
    const members = electrodeMembers(e);
    expect(members[63].length).toBe(2);
    expect(members.reduce((s, m) => s + m.length, 0)).toBe(5);
  });
});

describe('sensory encoder', () => {
  it('place code maps paddle-relative offset monotonically onto 8 positions', () => {
    const span = 1;
    expect(placeIndex(-0.5, span)).toBe(0);
    expect(placeIndex(-5, span)).toBe(0);
    expect(placeIndex(0.49, span)).toBe(N_PLACES - 1);
    expect(placeIndex(3, span)).toBe(N_PLACES - 1);
    expect(placeIndex(-0.01, span)).toBe(3);
    expect(placeIndex(0.01, span)).toBe(4);
    let prev = -1;
    for (let r = -0.6; r <= 0.6; r += 0.01) {
      const k = placeIndex(r, span);
      expect(k).toBeGreaterThanOrEqual(prev);
      prev = k;
    }
  });

  it('rate code goes from 4 Hz at the far wall to 40 Hz at the paddle', () => {
    expect(pulseRateHz(1, defaultEncoderParams)).toBeCloseTo(4);
    expect(pulseRateHz(0, defaultEncoderParams)).toBeCloseTo(40);
    expect(pulseRateHz(0.5, defaultEncoderParams)).toBeCloseTo(22);
    expect(pulseRateHz(-1, defaultEncoderParams)).toBeCloseTo(40);
  });

  it('emits pulses at the encoded rate on the encoded place', () => {
    const enc = new SensoryEncoder(defaultEncoderParams);
    const count = (dist: number, rel: number) => {
      enc.reset();
      let n = 0;
      for (let t = 0; t < 10000; t++) {
        const k = enc.tick(rel, dist);
        if (k >= 0) {
          expect(k).toBe(placeIndex(rel, defaultEncoderParams.placeSpan));
          n++;
        }
      }
      return n;
    };
    expect(count(0, -0.3)).toBe(400);
    expect(count(1, 0.2)).toBe(40);
  });
});

describe('motor decoder', () => {
  it('converges to the population rate and outputs the up/down difference', () => {
    const dec = new MotorDecoder({ tauMs: 50, fullScaleHz: 10, baselineTauMs: 0 }, 100, 100);
    // Up population: 1 spike/ms across 100 neurons = 10 Hz per neuron. Down silent.
    for (let t = 0; t < 1000; t++) dec.update(1, 0);
    expect(dec.rateUp).toBeCloseTo(10, 1);
    expect(dec.rateDown).toBeCloseTo(0, 5);
    expect(dec.command()).toBeCloseTo(-1, 2);
    dec.reset();
    for (let t = 0; t < 1000; t++) dec.update(0, 0.5);
    expect(dec.command()).toBeCloseTo(0.5, 1);
    for (let t = 0; t < 1000; t++) dec.update(0.5, 0.5);
    expect(Math.abs(dec.command())).toBeLessThan(0.01);
  });
});

describe('calibrated motor decoder', () => {
  it('cancels a fixed imbalance between the motor regions but still passes changes', () => {
    const dec = new MotorDecoder({ tauMs: 50, fullScaleHz: 10, baselineTauMs: 1000 }, 100, 100);
    // Down region constantly 5 Hz busier than up.
    for (let t = 0; t < 10_000; t++) dec.update(0.5, 1);
    expect(Math.abs(dec.command())).toBeLessThan(0.01);
    // A sudden extra burst in the up region still moves the paddle up.
    for (let t = 0; t < 100; t++) dec.update(1.5, 1);
    expect(dec.command()).toBeLessThan(-0.3);
  });

  it('is a plain difference decoder when the baseline is off', () => {
    const dec = new MotorDecoder({ tauMs: 50, fullScaleHz: 10, baselineTauMs: 0 }, 100, 100);
    for (let t = 0; t < 10_000; t++) dec.update(0.5, 1);
    expect(dec.command()).toBeCloseTo(0.5, 2);
  });
});
