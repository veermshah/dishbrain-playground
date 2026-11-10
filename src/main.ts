import './style.css';
import { FEEDBACK_MODES, type FeedbackMode, type SimConfig } from './core/closedLoop.ts';
import {
  resultsToCsv,
  summarize,
  type ExperimentSummary,
  type RunResult,
  type RunSpec,
} from './core/experiment.ts';
import type { FromExp, FromSim, FrameMsg, LayoutMsg, ToSim } from './protocol.ts';
import { fmtClock, readTheme, type Theme } from './ui/canvas.ts';
import { buildParams } from './ui/params.ts';
import {
  SpikeRing,
  drawBrain,
  drawCurves,
  drawGame,
  drawMea,
  drawRally,
  drawRaster,
  drawWeights,
  rasterOrder,
  type RallyPoint,
  type Trail,
  type WeightSnapshot,
} from './ui/views.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/* ------------------------------------------------------------ theme */

const THEME_KEY = 'dishbrain-theme';
function storedTheme(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}
function applyTheme(t: 'light' | 'dark') {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* storage unavailable */
  }
  theme = readTheme();
}
const initialTheme =
  (storedTheme() as 'light' | 'dark' | null) ??
  (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
document.documentElement.dataset.theme = initialTheme;
let theme: Theme = readTheme();
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reduced = reducedMotionQuery.matches;
reducedMotionQuery.addEventListener('change', (e) => (reduced = e.matches));

/* ------------------------------------------------------------ state */

const SPEEDS = [1, 2, 5, 10, 20, 50, 100];
let speedIdx = 0;
let paused = false;
let plastic = true;
let mode: FeedbackMode = 'predictable';
let seed = (Math.random() * 1e9) >>> 0;
let config: SimConfig;

let layout: LayoutMsg | null = null;
let order: ReturnType<typeof rasterOrder> | null = null;
let frame: FrameMsg | null = null;
const ring = new SpikeRing(120_000);
const trail: Trail = { xs: [], ys: [] };
let rallies: RallyPoint[] = [];
let weights: WeightSnapshot[] = [];
let maxRate = 20;
let dirty = true;

/* ------------------------------------------------------------ simulation worker */

const sim = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
const send = (m: ToSim) => sim.postMessage(m);

sim.onmessage = (ev: MessageEvent<FromSim>) => {
  const m = ev.data;
  if (m.type === 'layout') {
    layout = m;
    order = rasterOrder(m);
  } else if (m.type === 'frame') {
    frame = m;
    ring.push(m.spikeIds, m.spikeTimes);
    for (const r of m.newRallies) rallies.push(r);
    if (rallies.length > 5000) rallies = rallies.slice(-5000);
    trail.xs.push(m.ballX);
    trail.ys.push(m.ballY);
    if (trail.xs.length > 14) {
      trail.xs.shift();
      trail.ys.shift();
    }
    let peak = 0;
    for (const r of m.electrodeRate) peak = Math.max(peak, r);
    maxRate = Math.max(10, 0.9 * maxRate + 0.1 * peak);
    dirty = true;
  } else if (m.type === 'weights') {
    weights.push({ t: m.t, hist: m.hist });
    if (weights.length > 600) weights = weights.filter((_, i) => i % 2 === 0);
  }
};

function restart(cfg: SimConfig, newSeed = true) {
  config = cfg;
  if (newSeed) seed = (Math.random() * 1e9) >>> 0;
  config.mode = mode;
  config.network.plastic = config.network.plastic && plastic;
  plastic = config.network.plastic;
  updatePlasticBtn();
  layout = null;
  order = null;
  frame = null;
  ring.clear();
  trail.xs.length = 0;
  trail.ys.length = 0;
  rallies = [];
  weights = [];
  send({ type: 'init', config, seed });
  send({ type: 'speed', speed: SPEEDS[speedIdx] });
  send({ type: 'pause', paused });
}

/* ------------------------------------------------------------ controls */

const params = buildParams($('params') as HTMLFormElement, (cfg) => {
  plastic = cfg.network.plastic;
  restart(cfg);
});

const modeBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('.seg-btn'));
function setMode(m: FeedbackMode) {
  mode = m;
  for (const b of modeBtns) {
    const on = b.dataset.mode === m;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  send({ type: 'mode', mode: m });
}
modeBtns.forEach((b, i) => {
  b.addEventListener('click', () => setMode(b.dataset.mode as FeedbackMode));
  b.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const j = (i + (e.key === 'ArrowRight' ? 1 : modeBtns.length - 1)) % modeBtns.length;
      modeBtns[j].focus();
      setMode(modeBtns[j].dataset.mode as FeedbackMode);
    }
  });
});

const playBtn = $<HTMLButtonElement>('btn-play');
function setPaused(p: boolean) {
  paused = p;
  playBtn.textContent = p ? '▶' : '❚❚';
  playBtn.setAttribute('aria-label', p ? 'Resume' : 'Pause');
  send({ type: 'pause', paused: p });
}
playBtn.addEventListener('click', () => setPaused(!paused));
$('btn-step').addEventListener('click', () => {
  if (!paused) setPaused(true);
  send({ type: 'step', ms: 100 });
});

const speedInput = $<HTMLInputElement>('speed');
const speedOut = $<HTMLOutputElement>('speed-out');
speedInput.max = String(SPEEDS.length - 1);
function setSpeed(i: number) {
  speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, i));
  const label = `${SPEEDS[speedIdx]}×`;
  speedInput.value = String(speedIdx);
  speedInput.setAttribute('aria-valuetext', label);
  speedOut.value = label;
  send({ type: 'speed', speed: SPEEDS[speedIdx] });
}
speedInput.addEventListener('input', () => setSpeed(Number(speedInput.value)));

const plasticBtn = $<HTMLButtonElement>('btn-plastic');
function updatePlasticBtn() {
  plasticBtn.setAttribute('aria-pressed', String(plastic));
  plasticBtn.textContent = plastic ? 'STDP on' : 'STDP off';
}
plasticBtn.addEventListener('click', () => {
  plastic = !plastic;
  updatePlasticBtn();
  send({ type: 'plastic', on: plastic });
});
$('btn-reset').addEventListener('click', () => restart(params.current()));

const help = $<HTMLDialogElement>('help');
const openHelp = () => {
  if (!help.open) help.showModal();
};
$('btn-help').addEventListener('click', openHelp);
help.querySelector('[data-close]')!.addEventListener('click', () => help.close());
help.addEventListener('click', (e) => {
  if (e.target === help) help.close();
});
$('btn-theme').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  dirty = true;
  if (lastSummary) renderSummary(lastSummary, lastBinMs);
});

document.addEventListener('keydown', (e) => {
  const tgt = e.target as HTMLElement;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (tgt.closest('input, select, textarea') || help.open) return;
  const k = e.key;
  if (k === ' ' && !(tgt instanceof HTMLButtonElement)) {
    e.preventDefault();
    setPaused(!paused);
  } else if (k === 's' || k === 'S') {
    if (!paused) setPaused(true);
    send({ type: 'step', ms: 100 });
  } else if (k === '1' || k === '2' || k === '3') {
    setMode(FEEDBACK_MODES[Number(k) - 1]);
  } else if (k === '+' || k === '=') {
    setSpeed(speedIdx + 1);
  } else if (k === '-' || k === '_') {
    setSpeed(speedIdx - 1);
  } else if (k === 'p' || k === 'P') {
    plasticBtn.click();
  } else if (k === 'r' || k === 'R') {
    restart(params.current());
  } else if (k === 't' || k === 'T') {
    $('btn-theme').click();
  } else if (k === '?') {
    openHelp();
  }
});

/* ------------------------------------------------------------ render loop */

const cv = {
  game: $<HTMLCanvasElement>('cv-game'),
  mea: $<HTMLCanvasElement>('cv-mea'),
  brain: $<HTMLCanvasElement>('cv-brain'),
  raster: $<HTMLCanvasElement>('cv-raster'),
  rally: $<HTMLCanvasElement>('cv-rally'),
  weights: $<HTMLCanvasElement>('cv-weights'),
  exp: $<HTMLCanvasElement>('cv-exp'),
};
const ro = {
  time: $('ro-time'),
  speed: $('ro-speed'),
  rally: $('ro-rally'),
  hitrate: $('ro-hitrate'),
  weight: $('ro-weight'),
  status: $('game-status'),
  motorUp: $('motor-up'),
  motorDown: $('motor-down'),
  motorTxt: $('motor-txt'),
};

let lastSlow = 0;
function render(now: number) {
  requestAnimationFrame(render);
  if (!dirty) return;
  dirty = false;
  const f = frame;
  drawGame(cv.game, f, trail, theme, reduced);
  drawMea(
    cv.mea,
    f?.electrodeRate ?? null,
    f?.stimulated ?? null,
    layout?.roles ?? null,
    theme,
    maxRate,
  );
  drawBrain(cv.brain, layout, f?.activity ?? null, theme);
  drawRaster(cv.raster, ring, f?.t ?? 0, 2000, order, layout?.n ?? 1, theme);
  // Slow-changing charts at ~5 Hz.
  if (now - lastSlow > 200) {
    lastSlow = now;
    drawRally(cv.rally, rallies, f?.t ?? 0, theme);
    drawWeights(cv.weights, weights, layout?.wMax ?? 10, theme);
  }
  if (f) {
    ro.time.textContent = fmtClock(f.t);
    ro.speed.textContent = f.paused ? 'PAUSED' : `${f.achieved.toFixed(f.achieved < 10 ? 1 : 0)}×`;
    ro.rally.textContent = String(f.currentRally);
    const tot = f.hits + f.misses;
    ro.hitrate.textContent = tot ? `${((100 * f.hits) / tot).toFixed(0)}` : '--';
    ro.weight.textContent = f.meanW.toFixed(2);
    const inFb = f.feedbackLeft > 0;
    ro.status.textContent = f.paused
      ? 'PAUSED'
      : inFb
        ? `FEEDBACK · ${f.mode.toUpperCase()}`
        : 'PLAYING';
    ro.status.classList.toggle('miss', inFb);
    const scale = (v: number) => `${Math.min(50, (v / 12) * 50)}%`;
    ro.motorUp.style.width = scale(f.rateUp);
    ro.motorDown.style.width = scale(f.rateDown);
    ro.motorTxt.textContent = `up ${f.rateUp.toFixed(1)} Hz · down ${f.rateDown.toFixed(1)} Hz`;
  }
}

window.addEventListener('resize', () => {
  dirty = true;
  if (lastSummary) renderSummary(lastSummary, lastBinMs);
});

/* ------------------------------------------------------------ experiment mode */

const expForm = $<HTMLFormElement>('exp-form');
const expRun = $<HTMLButtonElement>('exp-run');
const expCancel = $<HTMLButtonElement>('exp-cancel');
const expCsv = $<HTMLButtonElement>('exp-csv');
const expJson = $<HTMLButtonElement>('exp-json');
const expBar = $('exp-bar');
const expStatus = $('exp-status');
const expTable = $('exp-table');
let pool: Worker[] = [];
let lastResults: RunResult[] = [];
let lastSummary: ExperimentSummary | null = null;
let lastBinMs = 60_000;
let lastSpecConfig: SimConfig | null = null;

function stopPool() {
  for (const w of pool) w.terminate();
  pool = [];
}

function renderSummary(s: ExperimentSummary, binMs: number) {
  drawCurves(cv.exp, s.conditions, binMs, theme);
  const f = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : 'n/a');
  const rows = s.conditions
    .map(
      (c) =>
        `<tr><td><span class="dot dot-${c.mode}"></span> ${c.mode}</td><td>${f(c.earlyRally.mean)}</td><td>${f(c.lateRally.mean)} <span class="dim">[${f(c.lateRally.lo)}, ${f(c.lateRally.hi)}]</span></td><td>${f(c.improvement.mean)}</td></tr>`,
    )
    .join('');
  const comps = s.comparisons
    .map(
      (k) =>
        `<tr><td>${k.a} vs ${k.b}</td><td>${k.metric === 'lateRally' ? 'late rally' : 'late − early'}</td><td class="${k.test.p < 0.05 ? 'sig' : ''}">${f(k.test.p)}</td></tr>`,
    )
    .join('');
  expTable.innerHTML = `
    <table aria-label="Mean rally length by condition">
      <thead><tr><th scope="col">Condition</th><th scope="col">Early ⅓</th><th scope="col">Late ⅓ [95% CI]</th><th scope="col">Δ</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table aria-label="Mann-Whitney U tests between conditions">
      <thead><tr><th scope="col">Comparison</th><th scope="col">Metric</th><th scope="col">p (MWU)</th></tr></thead>
      <tbody>${comps}</tbody>
    </table>
    <p class="note">Values are hits per rally, averaged per seed then across seeds. p-values are two-sided and uncorrected for multiple comparisons.</p>`;
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

expCsv.addEventListener('click', () =>
  download('dishbrain-experiment.csv', resultsToCsv(lastResults), 'text/csv'),
);
expJson.addEventListener('click', () =>
  download(
    'dishbrain-experiment.json',
    JSON.stringify({ config: lastSpecConfig, summary: lastSummary, results: lastResults }, null, 2),
    'application/json',
  ),
);
expCancel.addEventListener('click', () => {
  stopPool();
  expRun.disabled = false;
  expCancel.disabled = true;
  expStatus.textContent = 'cancelled';
});

expForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const seeds = Math.max(2, Math.min(40, Number($<HTMLInputElement>('exp-seeds').value) || 6));
  const minutes = Math.max(1, Math.min(60, Number($<HTMLInputElement>('exp-minutes').value) || 10));
  const binS = Math.max(10, Math.min(600, Number($<HTMLInputElement>('exp-bin').value) || 60));
  const modes = Array.from(
    expForm.querySelectorAll<HTMLInputElement>('input[name=mode]:checked'),
  ).map((i) => i.value as FeedbackMode);
  if (!modes.length) {
    expStatus.textContent = 'pick at least one condition';
    return;
  }
  const cfg = params.current();
  lastSpecConfig = cfg;
  const specs: RunSpec[] = [];
  for (const m of modes)
    for (let s = 1; s <= seeds; s++)
      specs.push({
        mode: m,
        seed: s,
        durationMs: minutes * 60_000,
        binMs: binS * 1000,
        config: cfg,
      });

  stopPool();
  const nWorkers = Math.max(1, Math.min(specs.length, (navigator.hardwareConcurrency || 4) - 1, 8));
  const progress = new Array<number>(specs.length).fill(0);
  const results: RunResult[] = [];
  let next = 0;
  const t0 = performance.now();
  expRun.disabled = true;
  expCancel.disabled = false;
  expCsv.disabled = true;
  expJson.disabled = true;

  const update = () => {
    const total = progress.reduce((a, b) => a + b, 0) / specs.length;
    expBar.style.width = `${(total * 100).toFixed(1)}%`;
    expStatus.textContent = `${results.length}/${specs.length} sessions · ${nWorkers} workers · ${((performance.now() - t0) / 1000).toFixed(0)} s`;
    if (results.length >= 2) {
      lastSummary = summarize(results);
      lastBinMs = binS * 1000;
      renderSummary(lastSummary, lastBinMs);
    }
  };

  const feed = (w: Worker) => {
    if (next >= specs.length) return;
    const id = next++;
    w.postMessage({ type: 'run', id, spec: specs[id] });
  };

  for (let k = 0; k < nWorkers; k++) {
    const w = new Worker(new URL('./experiment.worker.ts', import.meta.url), { type: 'module' });
    pool.push(w);
    w.onmessage = (ev: MessageEvent<FromExp>) => {
      const m = ev.data;
      if (m.type === 'progress') {
        progress[m.id] = m.fraction;
      } else {
        progress[m.id] = 1;
        results.push(m.result);
        if (results.length === specs.length) {
          stopPool();
          lastResults = results.sort((a, b) => a.mode.localeCompare(b.mode) || a.seed - b.seed);
          expRun.disabled = false;
          expCancel.disabled = true;
          expCsv.disabled = false;
          expJson.disabled = false;
        } else feed(w);
      }
      update();
    };
    feed(w);
  }
  update();
});

/* ------------------------------------------------------------ boot */

setMode('predictable');
setSpeed(0);
restart(params.current(), false);
drawCurves(cv.exp, [], 60_000, theme);
requestAnimationFrame(render);
