import type { SimConfig } from './closedLoop.ts';

export type PresetName =
  | 'dishbrain'
  | 'highPlasticity'
  | 'noPlasticity'
  | 'rstdp'
  | 'rstdpShuffled'
  | 'calibrated'
  | 'learningRig';

export interface Preset {
  label: string;
  description: string;
  apply: (cfg: SimConfig) => void;
}

export const PRESETS: Record<PresetName, Preset> = {
  dishbrain: {
    label: 'DishBrain-like',
    description:
      '1000 neurons, 4-40 Hz rate code, 100 Hz / 100 ms predictable burst, 5 Hz unpredictable stimulation, 4 s feedback window.',
    apply: () => {},
  },
  highPlasticity: {
    label: 'High plasticity',
    description: 'STDP steps 2.5x larger with a longer 40 ms window.',
    apply: (cfg) => {
      cfg.network.aPlus *= 2.5;
      cfg.network.aMinus *= 2.5;
      cfg.network.tauStdp = 40;
    },
  },
  rstdp: {
    label: 'Reward-modulated STDP',
    description:
      'STDP writes into 1 s eligibility traces; each hit (+1) or miss (-1), minus the recent average reward, moves every synapse in proportion to its trace.',
    apply: (cfg) => {
      cfg.network.rule = 'rstdp';
      cfg.reward.mode = 'contingent';
      cfg.reward.baselineEvents = 20;
    },
  },
  rstdpShuffled: {
    label: 'R-STDP, shuffled reward (control)',
    description:
      'Same as R-STDP, but each reward is drawn from earlier outcomes at random, so it carries no information about the move.',
    apply: (cfg) => {
      cfg.network.rule = 'rstdp';
      cfg.reward.mode = 'shuffled';
      cfg.reward.baselineEvents = 20;
    },
  },
  calibrated: {
    label: 'Calibrated motor decode',
    description:
      'Subtracts a 10 s running average of the up/down rate difference, so a fixed imbalance between the motor regions cannot pin the paddle to a wall.',
    apply: (cfg) => {
      cfg.decoder.baselineTauMs = 10_000;
    },
  },
  learningRig: {
    label: 'Learning rig',
    description:
      'Calibrated motor decode plus high plasticity. The shared base for every condition in the "Making it learn" comparison, chosen on development seeds 100-111.',
    apply: (cfg) => {
      PRESETS.calibrated.apply(cfg);
      PRESETS.highPlasticity.apply(cfg);
    },
  },
  noPlasticity: {
    label: 'No plasticity (control)',
    description: 'STDP off. Any change over time cannot come from learning.',
    apply: (cfg) => {
      cfg.network.plastic = false;
    },
  },
};

/** Returns a deep copy of `base` with the preset applied. */
export function applyPreset(base: SimConfig, name: PresetName): SimConfig {
  const cfg = structuredClone(base);
  PRESETS[name].apply(cfg);
  return cfg;
}
