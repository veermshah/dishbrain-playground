import type { SimConfig } from './closedLoop.ts';

export type PresetName = 'dishbrain' | 'highPlasticity' | 'noPlasticity';

export interface Preset {
  label: string;
  description: string;
  apply: (cfg: SimConfig) => void;
}

export const PRESETS: Record<PresetName, Preset> = {
  dishbrain: {
    label: 'DishBrain-like',
    description:
      '1000 neurons, 4-40 Hz rate code, 100 Hz / 100 ms predictable burst, 5 Hz unpredictable stimulation.',
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
