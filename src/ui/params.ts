import { defaultConfig, type SimConfig } from '../core/closedLoop.ts';
import { PRESETS, applyPreset, type PresetName } from '../core/presets.ts';

interface ParamDef {
  path: [keyof SimConfig, string];
  label: string;
  min: number;
  max: number;
  step: number;
  digits: number;
  hint: string;
}

const DEFS: ParamDef[] = [
  {
    path: ['network', 'nNeurons'],
    label: 'Neurons',
    min: 200,
    max: 2000,
    step: 100,
    digits: 0,
    hint: 'Total neuron count, 80% excitatory',
  },
  {
    path: ['network', 'connectionProb'],
    label: 'Connection density',
    min: 0.02,
    max: 0.25,
    step: 0.01,
    digits: 2,
    hint: 'Probability that any pair is connected',
  },
  {
    path: ['network', 'aPlus'],
    label: 'STDP A+ (LTP)',
    min: 0,
    max: 0.3,
    step: 0.005,
    digits: 3,
    hint: 'Potentiation step when pre fires before post',
  },
  {
    path: ['network', 'aMinus'],
    label: 'STDP A− (LTD)',
    min: 0,
    max: 0.36,
    step: 0.006,
    digits: 3,
    hint: 'Depression step when post fires before pre',
  },
  {
    path: ['network', 'tauStdp'],
    label: 'STDP window (ms)',
    min: 5,
    max: 60,
    step: 1,
    digits: 0,
    hint: 'Time constant of the STDP window',
  },
  {
    path: ['network', 'noiseRate'],
    label: 'Background noise',
    min: 0,
    max: 0.01,
    step: 0.0005,
    digits: 4,
    hint: 'Chance per neuron per ms of a spontaneous input kick',
  },
  {
    path: ['stim', 'amp'],
    label: 'Sensory pulse amplitude',
    min: 5,
    max: 40,
    step: 1,
    digits: 0,
    hint: 'Current injected by a sensory pulse',
  },
  {
    path: ['feedback', 'strength'],
    label: 'Feedback strength',
    min: 0,
    max: 3,
    step: 0.1,
    digits: 1,
    hint: 'Multiplier on post-miss stimulation amplitude',
  },
  {
    path: ['feedback', 'windowMs'],
    label: 'Feedback window (ms)',
    min: 500,
    max: 4000,
    step: 100,
    digits: 0,
    hint: 'Pause after a miss (DishBrain used 4 s)',
  },
  {
    path: ['decoder', 'tauMs'],
    label: 'Motor smoothing (ms)',
    min: 10,
    max: 300,
    step: 10,
    digits: 0,
    hint: 'Time constant of the motor rate estimate',
  },
  {
    path: ['pong', 'ballSpeed'],
    label: 'Ball speed',
    min: 0.2,
    max: 1.2,
    step: 0.05,
    digits: 2,
    hint: 'Field widths per second',
  },
  {
    path: ['pong', 'paddleHeight'],
    label: 'Paddle height',
    min: 0.1,
    max: 0.4,
    step: 0.01,
    digits: 2,
    hint: 'Fraction of field height',
  },
];

type Section = Record<string, unknown>;
const get = (cfg: SimConfig, d: ParamDef) =>
  (cfg[d.path[0]] as unknown as Section)[d.path[1]] as number;
const set = (cfg: SimConfig, d: ParamDef, v: number) => {
  (cfg[d.path[0]] as unknown as Section)[d.path[1]] = v;
};

export interface ParamPanel {
  current(): SimConfig;
  presetName(): PresetName;
}

/**
 * Builds the parameter form. `onApply` is called with a fresh config
 * when the user presses "Apply & restart".
 */
export function buildParams(form: HTMLFormElement, onApply: (cfg: SimConfig) => void): ParamPanel {
  let preset: PresetName = 'dishbrain';
  let cfg = applyPreset(defaultConfig(), preset);
  const inputs: { d: ParamDef; input: HTMLInputElement; out: HTMLOutputElement }[] = [];

  const presetWrap = document.createElement('div');
  presetWrap.className = 'param-actions';
  const presetLabel = document.createElement('label');
  presetLabel.className = 'ctl-label';
  presetLabel.htmlFor = 'preset';
  presetLabel.textContent = 'Preset';
  const select = document.createElement('select');
  select.id = 'preset';
  for (const [key, p] of Object.entries(PRESETS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = p.label;
    select.append(opt);
  }
  const desc = document.createElement('span');
  desc.className = 'mono small dim';
  desc.textContent = PRESETS[preset].description;
  presetWrap.append(presetLabel, select, desc);
  form.append(presetWrap);

  DEFS.forEach((d, k) => {
    const wrap = document.createElement('div');
    wrap.className = 'param';
    const id = `p-${k}`;
    const label = document.createElement('label');
    label.htmlFor = id;
    const name = document.createElement('span');
    name.textContent = d.label;
    const out = document.createElement('output');
    out.htmlFor.add(id);
    label.append(name, out);
    const input = document.createElement('input');
    input.type = 'range';
    input.id = id;
    input.min = String(d.min);
    input.max = String(d.max);
    input.step = String(d.step);
    input.title = d.hint;
    input.setAttribute('aria-describedby', `${id}-hint`);
    const hint = document.createElement('span');
    hint.id = `${id}-hint`;
    hint.className = 'sr-only';
    hint.textContent = d.hint;
    input.addEventListener('input', () => {
      set(cfg, d, Number(input.value));
      out.value = Number(input.value).toFixed(d.digits);
    });
    wrap.append(label, input, hint);
    form.append(wrap);
    inputs.push({ d, input, out });
  });

  const plasticWrap = document.createElement('div');
  plasticWrap.className = 'param';
  const plasticLabel = document.createElement('label');
  const plasticBox = document.createElement('input');
  plasticBox.type = 'checkbox';
  plasticBox.id = 'p-plastic';
  plasticLabel.htmlFor = 'p-plastic';
  plasticLabel.innerHTML = '<span>STDP enabled</span>';
  plasticBox.addEventListener('change', () => {
    cfg.network.plastic = plasticBox.checked;
  });
  plasticWrap.append(plasticLabel, plasticBox);
  form.append(plasticWrap);

  const actions = document.createElement('div');
  actions.className = 'param-actions';
  const apply = document.createElement('button');
  apply.type = 'submit';
  apply.className = 'btn primary';
  apply.textContent = 'Apply & restart';
  const revert = document.createElement('button');
  revert.type = 'button';
  revert.className = 'btn';
  revert.textContent = 'Revert to preset';
  actions.append(apply, revert);
  form.append(actions);

  const sync = () => {
    for (const { d, input, out } of inputs) {
      input.value = String(get(cfg, d));
      out.value = get(cfg, d).toFixed(d.digits);
    }
    plasticBox.checked = cfg.network.plastic;
    select.value = preset;
    desc.textContent = PRESETS[preset].description;
  };
  sync();

  select.addEventListener('change', () => {
    preset = select.value as PresetName;
    const mode = cfg.mode;
    cfg = applyPreset(defaultConfig(mode), preset);
    sync();
  });
  revert.addEventListener('click', () => {
    cfg = applyPreset(defaultConfig(cfg.mode), preset);
    sync();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    onApply(structuredClone(cfg));
  });

  return {
    current: () => structuredClone(cfg),
    presetName: () => preset,
  };
}
