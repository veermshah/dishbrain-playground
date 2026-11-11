/** Canvas helpers: DPR-aware sizing and theme colours read from CSS variables. */

export interface Theme {
  bg: string;
  line: string;
  lineStrong: string;
  text: string;
  dim: string;
  faint: string;
  phosphor: string;
  glow: string;
  sensory: string;
  up: string;
  down: string;
  exc: string;
  inh: string;
  dishbrain: string;
  predictable: string;
  unpredictable: string;
  silent: string;
  warn: string;
  mono: string;
  dark: boolean;
}

export function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    bg: v('--canvas-bg'),
    line: v('--line'),
    lineStrong: v('--line-strong'),
    text: v('--text'),
    dim: v('--dim'),
    faint: v('--faint'),
    phosphor: v('--phosphor'),
    glow: v('--phosphor-glow'),
    sensory: v('--sensory'),
    up: v('--up'),
    down: v('--down'),
    exc: v('--exc'),
    inh: v('--inh'),
    dishbrain: v('--dishbrain'),
    predictable: v('--predictable'),
    unpredictable: v('--unpredictable'),
    silent: v('--silent'),
    warn: v('--warn'),
    mono: v('--font-mono') || 'monospace',
    dark: document.documentElement.dataset.theme !== 'light',
  };
}

export interface Surface {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
}

/** Resize the backing store to the element's CSS size times DPR. */
export function surface(canvas: HTMLCanvasElement): Surface {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, canvas.clientWidth);
  const h = Math.max(1, canvas.clientHeight);
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/** Parse "#rrggbb" into [r, g, b]. */
export function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16,
  );
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * Perceptually ordered "instrument" colormap for heatmaps:
 * near-black -> deep teal -> phosphor green -> amber -> white.
 */
const STOPS_DARK: [number, number, number][] = [
  [6, 10, 10],
  [12, 60, 62],
  [40, 150, 110],
  [124, 255, 178],
  [255, 214, 120],
  [255, 250, 235],
];
const STOPS_LIGHT: [number, number, number][] = [
  [244, 247, 242],
  [190, 225, 210],
  [80, 170, 130],
  [13, 120, 80],
  [170, 90, 0],
  [90, 30, 0],
];

export function heat(t: number, dark: boolean): string {
  const stops = dark ? STOPS_DARK : STOPS_LIGHT;
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

export function niceTicks(lo: number, hi: number, count: number): number[] {
  const span = hi - lo || 1;
  const step0 = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export function fmtClock(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`;
}
