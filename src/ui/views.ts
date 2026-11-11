import type { FeedbackMode } from '../core/closedLoop.ts';
import type { ConditionSummary } from '../core/experiment.ts';
import { GRID, type Role } from '../core/mea.ts';
import type { FrameMsg, LayoutMsg } from '../protocol.ts';
import { fmtClock, heat, niceTicks, rgba, surface, type Theme } from './canvas.ts';

export const modeColor = (th: Theme, m: FeedbackMode): string =>
  m === 'dishbrain'
    ? th.dishbrain
    : m === 'predictable'
      ? th.predictable
      : m === 'unpredictable'
        ? th.unpredictable
        : th.silent;

const roleColor = (th: Theme, r: Role): string =>
  r === 'sensory' ? th.sensory : r === 'up' ? th.up : r === 'down' ? th.down : th.faint;

/* ------------------------------------------------------------------ game */

export interface Trail {
  xs: number[];
  ys: number[];
}

export function drawGame(
  canvas: HTMLCanvasElement,
  f: FrameMsg | null,
  trail: Trail,
  th: Theme,
  reduced: boolean,
): void {
  const { ctx, w, h } = surface(canvas);
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, w, h);
  // Graticule like an oscilloscope screen.
  ctx.strokeStyle = th.line;
  ctx.lineWidth = 1;
  for (let i = 1; i < 10; i++) {
    const x = Math.round((i * w) / 10) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let i = 1; i < 8; i++) {
    const y = Math.round((i * h) / 8) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = th.lineStrong;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(w / 2 + 0.5, 0);
  ctx.lineTo(w / 2 + 0.5, h);
  ctx.stroke();
  ctx.setLineDash([]);
  if (!f) return;

  const pad = 10;
  const px = (x: number) => pad + x * (w - 2 * pad);
  const py = (y: number) => y * h;
  const inFeedback = f.feedbackLeft > 0;

  // Paddle.
  const ph = f.paddleHeight * h;
  ctx.shadowColor = reduced ? 'transparent' : th.glow;
  ctx.shadowBlur = reduced ? 0 : 14;
  ctx.fillStyle = th.phosphor;
  ctx.fillRect(2, py(f.paddleY) - ph / 2, 6, ph);

  // Ball trail and ball.
  if (!reduced && trail.xs.length > 1) {
    for (let i = 0; i < trail.xs.length; i++) {
      const a = (i / trail.xs.length) * 0.35;
      ctx.fillStyle = rgba(th.phosphor, a);
      ctx.beginPath();
      ctx.arc(px(trail.xs[i]), py(trail.ys[i]), 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const r = Math.max(4, f.ballRadius * h);
  ctx.fillStyle = inFeedback ? th.warn : th.phosphor;
  ctx.beginPath();
  ctx.arc(px(f.ballX), py(f.ballY), r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Feedback overlay.
  if (inFeedback) {
    const frac = f.feedbackLeft / f.feedbackWindow;
    const col = modeColor(th, f.mode);
    ctx.fillStyle = rgba(col, reduced ? 0.08 : 0.06 + 0.1 * frac);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = col;
    ctx.font = `600 13px ${th.mono}`;
    ctx.textAlign = 'center';
    ctx.fillText(`MISS · ${f.mode.toUpperCase()} FEEDBACK`, w / 2, h / 2 - 6);
    ctx.fillStyle = th.dim;
    ctx.font = `12px ${th.mono}`;
    ctx.fillText(`${(f.feedbackLeft / 1000).toFixed(1)} s`, w / 2, h / 2 + 14);
    ctx.fillStyle = col;
    ctx.fillRect(0, h - 3, w * frac, 3);
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = th.dim;
  ctx.font = `11px ${th.mono}`;
  ctx.fillText(`HITS ${f.hits}  MISSES ${f.misses}  RALLY ${f.currentRally}`, 14, 16);
}

/* ------------------------------------------------------------------- MEA */

export function drawMea(
  canvas: HTMLCanvasElement,
  rates: Float32Array | null,
  stim: Uint8Array | null,
  roles: Role[] | null,
  th: Theme,
  maxRate: number,
): void {
  const { ctx, w, h } = surface(canvas);
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, w, h);
  const size = Math.min(w, h);
  const ox = (w - size) / 2;
  const oy = (h - size) / 2;
  const cell = size / GRID;
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const e = r * GRID + c;
      const x = ox + c * cell;
      const y = oy + r * cell;
      const v = rates ? rates[e] / maxRate : 0;
      ctx.fillStyle = heat(Math.sqrt(Math.max(0, v)), th.dark);
      ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4);
      if (roles) {
        ctx.strokeStyle = roleColor(th, roles[e]);
        ctx.globalAlpha = roles[e] === 'none' ? 0.5 : 0.9;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 2.5, y + 2.5, cell - 5, cell - 5);
        ctx.globalAlpha = 1;
      }
      // Electrode contact.
      ctx.fillStyle = rgba(th.dark ? '#000000' : '#ffffff', 0.35);
      ctx.beginPath();
      ctx.arc(x + cell / 2, y + cell / 2, cell * 0.09, 0, Math.PI * 2);
      ctx.fill();
      if (stim && stim[e]) {
        ctx.strokeStyle =
          stim[e] === 3 ? th.predictable : stim[e] === 2 ? th.unpredictable : th.text;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x + cell / 2, y + cell / 2, cell * 0.28, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}

/* ----------------------------------------------------------------- brain */

export function drawBrain(
  canvas: HTMLCanvasElement,
  layout: LayoutMsg | null,
  activity: Uint8Array | null,
  th: Theme,
): void {
  const { ctx, w, h } = surface(canvas);
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, w, h);
  if (!layout) return;
  const size = Math.min(w, h);
  const ox = (w - size) / 2;
  const oy = (h - size) / 2;
  ctx.strokeStyle = th.line;
  ctx.lineWidth = 1;
  for (let i = 1; i < GRID; i++) {
    const p = Math.round((i * size) / GRID) + 0.5;
    ctx.beginPath();
    ctx.moveTo(ox + p, oy);
    ctx.lineTo(ox + p, oy + size);
    ctx.moveTo(ox, oy + p);
    ctx.lineTo(ox + size, oy + p);
    ctx.stroke();
  }
  const rad = Math.max(1.2, Math.min(2.6, size / Math.sqrt(layout.n) / 3));
  for (let i = 0; i < layout.n; i++) {
    const a = activity ? activity[i] / 255 : 0;
    const base = i < layout.nExc ? th.exc : th.inh;
    ctx.fillStyle = rgba(base, 0.18 + 0.82 * Math.min(1, a));
    const r = rad * (1 + 1.2 * Math.min(1, a));
    ctx.fillRect(ox + layout.x[i] * size - r / 2, oy + layout.y[i] * size - r / 2, r, r);
  }
}

/* ---------------------------------------------------------------- raster */

export class SpikeRing {
  ids: Uint16Array;
  times: Float64Array;
  head = 0;
  size = 0;
  constructor(capacity: number) {
    this.ids = new Uint16Array(capacity);
    this.times = new Float64Array(capacity);
  }
  push(ids: Uint16Array, times: Float64Array): void {
    const cap = this.ids.length;
    for (let k = 0; k < ids.length; k++) {
      this.ids[this.head] = ids[k];
      this.times[this.head] = times[k];
      this.head = (this.head + 1) % cap;
      if (this.size < cap) this.size++;
    }
  }
  clear(): void {
    this.head = 0;
    this.size = 0;
  }
}

/** Order neurons for the raster: sensory (by place), up, down, other. */
export function rasterOrder(layout: LayoutMsg): {
  row: Int32Array;
  groups: { role: Role; start: number; end: number }[];
} {
  const order: number[] = [];
  const groups: { role: Role; start: number; end: number }[] = [];
  const add = (role: Role, pick: (i: number) => boolean, key: (i: number) => number) => {
    const start = order.length;
    const ids: number[] = [];
    for (let i = 0; i < layout.n; i++) if (pick(i)) ids.push(i);
    ids.sort((a, b) => key(a) - key(b));
    order.push(...ids);
    groups.push({ role, start, end: order.length });
  };
  const roleOf = (i: number) => layout.roles[layout.electrodeOf[i]];
  add(
    'sensory',
    (i) => roleOf(i) === 'sensory',
    (i) => layout.y[i],
  );
  add(
    'up',
    (i) => roleOf(i) === 'up',
    (i) => layout.electrodeOf[i],
  );
  add(
    'down',
    (i) => roleOf(i) === 'down',
    (i) => layout.electrodeOf[i],
  );
  add(
    'none',
    (i) => roleOf(i) === 'none',
    (i) => layout.electrodeOf[i],
  );
  const row = new Int32Array(layout.n);
  order.forEach((neuron, r) => (row[neuron] = r));
  return { row, groups };
}

export function drawRaster(
  canvas: HTMLCanvasElement,
  ring: SpikeRing,
  tNow: number,
  windowMs: number,
  order: ReturnType<typeof rasterOrder> | null,
  n: number,
  th: Theme,
): void {
  const { ctx, w, h } = surface(canvas);
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, w, h);
  if (!order) return;
  const left = 6;
  const plotW = w - left;
  const rowH = h / n;
  for (const g of order.groups) {
    const y0 = g.start * rowH;
    ctx.fillStyle = roleColor(th, g.role);
    ctx.fillRect(0, y0, 3, (g.end - g.start) * rowH);
    if (g.start > 0) {
      ctx.fillStyle = th.line;
      ctx.fillRect(left, y0, plotW, 1);
    }
  }
  const t0 = tNow - windowMs;
  const roleCols: string[] = order.groups.map((g) => roleColor(th, g.role));
  const groupOfRow = (r: number) => {
    for (let k = 0; k < order.groups.length; k++) if (r < order.groups[k].end) return k;
    return order.groups.length - 1;
  };
  const cap = ring.ids.length;
  const dot = Math.max(1, Math.min(2, rowH * 1.2));
  // Batch by group colour to keep fillStyle changes low.
  for (let k = 0; k < order.groups.length; k++) {
    ctx.fillStyle = roleCols[k];
    for (let q = 0; q < ring.size; q++) {
      const idx = (ring.head - 1 - q + cap) % cap;
      const t = ring.times[idx];
      if (t < t0) break;
      const r = order.row[ring.ids[idx]];
      if (groupOfRow(r) !== k) continue;
      const x = left + ((t - t0) / windowMs) * plotW;
      ctx.fillRect(x, r * rowH, dot, dot);
    }
  }
  ctx.fillStyle = th.dim;
  ctx.font = `10px ${th.mono}`;
  ctx.textAlign = 'right';
  ctx.fillText(fmtClock(tNow), w - 4, h - 4);
  ctx.textAlign = 'left';
}

/* ----------------------------------------------------------------- rally */

export interface RallyPoint {
  t: number;
  hits: number;
  mode: FeedbackMode;
}

function axes(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  m: { l: number; r: number; t: number; b: number },
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  th: Theme,
  xfmt: (v: number) => string,
  xlabel: string,
  ylabel: string,
) {
  const X = (v: number) => m.l + ((v - x0) / (x1 - x0 || 1)) * (w - m.l - m.r);
  const Y = (v: number) => h - m.b - ((v - y0) / (y1 - y0 || 1)) * (h - m.t - m.b);
  ctx.font = `10px ${th.mono}`;
  ctx.fillStyle = th.dim;
  ctx.strokeStyle = th.line;
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  for (const v of niceTicks(y0, y1, 4)) {
    const y = Math.round(Y(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(m.l, y);
    ctx.lineTo(w - m.r, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(v < 10 && v % 1 ? 1 : 0), m.l - 5, y + 3);
  }
  ctx.textAlign = 'center';
  for (const v of niceTicks(x0, x1, Math.max(2, Math.floor((w - m.l - m.r) / 80)))) {
    const x = X(v);
    ctx.fillText(xfmt(v), x, h - m.b + 14);
  }
  ctx.fillText(xlabel, m.l + (w - m.l - m.r) / 2, h - 3);
  ctx.save();
  ctx.translate(10, m.t + (h - m.t - m.b) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(ylabel, 0, 0);
  ctx.restore();
  ctx.textAlign = 'left';
  return { X, Y };
}

export function drawRally(
  canvas: HTMLCanvasElement,
  pts: RallyPoint[],
  tNow: number,
  th: Theme,
): void {
  const { ctx, w, h } = surface(canvas);
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, w, h);
  const m = { l: 34, r: 10, t: 10, b: 30 };
  const x1 = Math.max(60_000, tNow);
  const yMax = Math.max(3, ...pts.map((p) => p.hits)) + 0.5;
  const { X, Y } = axes(
    ctx,
    w,
    h,
    m,
    0,
    x1,
    0,
    yMax,
    th,
    (v) => `${Math.round(v / 60000)}m`,
    'sim time',
    'hits / rally',
  );
  if (!pts.length) {
    ctx.fillStyle = th.dim;
    ctx.font = `11px ${th.mono}`;
    ctx.fillText('waiting for the first miss…', m.l + 10, m.t + 16);
    return;
  }
  // Mode bands along the bottom.
  for (let i = 0; i < pts.length; i++) {
    const xa = X(i ? pts[i - 1].t : 0);
    const xb = X(pts[i].t);
    ctx.fillStyle = rgba(modeColor(th, pts[i].mode), 0.5);
    ctx.fillRect(xa, h - m.b - 3, Math.max(1, xb - xa), 3);
  }
  for (const p of pts) {
    ctx.fillStyle = rgba(modeColor(th, p.mode), 0.55);
    ctx.fillRect(X(p.t) - 1.5, Y(p.hits) - 1.5, 3, 3);
  }
  ctx.strokeStyle = th.text;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const k = 10;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    sum += pts[i].hits;
    if (i >= k) sum -= pts[i - k].hits;
    const avg = sum / Math.min(i + 1, k);
    const x = X(pts[i].t);
    const y = Y(avg);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/* --------------------------------------------------------------- weights */

export interface WeightSnapshot {
  t: number;
  hist: Float32Array;
}

export function drawWeights(
  canvas: HTMLCanvasElement,
  snaps: WeightSnapshot[],
  wMax: number,
  th: Theme,
): void {
  const { ctx, w, h } = surface(canvas);
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, w, h);
  const m = { l: 34, r: 10, t: 10, b: 30 };
  if (!snaps.length) return;
  const t1 = Math.max(60_000, snaps[snaps.length - 1].t);
  const { X, Y } = axes(
    ctx,
    w,
    h,
    m,
    0,
    t1,
    0,
    wMax,
    th,
    (v) => `${Math.round(v / 60000)}m`,
    'sim time',
    'weight',
  );
  const bins = snaps[0].hist.length;
  let peak = 0;
  for (const s of snaps) for (let b = 0; b < bins; b++) peak = Math.max(peak, s.hist[b]);
  const bh = (Y(0) - Y(wMax)) / bins;
  for (let i = 0; i < snaps.length; i++) {
    const s = snaps[i];
    const xa = X(i ? snaps[i - 1].t : 0);
    const xb = X(s.t);
    for (let b = 0; b < bins; b++) {
      const v = s.hist[b] / (peak || 1);
      if (v < 0.002) continue;
      ctx.fillStyle = heat(Math.sqrt(v), th.dark);
      ctx.fillRect(xa, Y(((b + 1) * wMax) / bins), Math.max(1, xb - xa + 0.5), bh + 0.5);
    }
  }
  // Current histogram profile on the right edge.
  const last = snaps[snaps.length - 1];
  ctx.strokeStyle = th.text;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let b = 0; b < bins; b++) {
    const x = w - m.r - (last.hist[b] / (peak || 1)) * 40;
    const y = Y(((b + 0.5) * wMax) / bins);
    if (b === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/* ------------------------------------------------------- learning curves */

export function drawCurves(
  canvas: HTMLCanvasElement,
  conds: ConditionSummary[],
  binMs: number,
  th: Theme,
): void {
  const { ctx, w, h } = surface(canvas);
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, w, h);
  const m = { l: 40, r: 12, t: 14, b: 32 };
  if (!conds.length) {
    ctx.fillStyle = th.dim;
    ctx.font = `12px ${th.mono}`;
    ctx.fillText('Run an experiment to compare conditions.', m.l, m.t + 20);
    return;
  }
  const nBins = Math.max(...conds.map((c) => c.curve.length));
  let yMax = 0.5;
  for (const c of conds)
    for (const p of c.curve) if (Number.isFinite(p.hi)) yMax = Math.max(yMax, p.hi);
  yMax *= 1.1;
  const xEnd = nBins * binMs;
  const { X, Y } = axes(
    ctx,
    w,
    h,
    m,
    0,
    xEnd,
    0,
    yMax,
    th,
    (v) => `${(v / 60000).toFixed(v % 60000 ? 1 : 0)}m`,
    'sim time (bin centre)',
    'mean hits / rally',
  );
  const xc = (b: number) => X((b + 0.5) * binMs);
  for (const c of conds) {
    const col = modeColor(th, c.mode);
    const valid = c.curve.map((p, b) => ({ p, b })).filter(({ p }) => Number.isFinite(p.mean));
    if (!valid.length) continue;
    ctx.fillStyle = rgba(col, 0.16);
    ctx.beginPath();
    valid.forEach(({ p, b }, i) =>
      i ? ctx.lineTo(xc(b), Y(Math.max(0, p.hi))) : ctx.moveTo(xc(b), Y(Math.max(0, p.hi))),
    );
    for (let i = valid.length - 1; i >= 0; i--)
      ctx.lineTo(xc(valid[i].b), Y(Math.max(0, valid[i].p.lo)));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    valid.forEach(({ p, b }, i) =>
      i ? ctx.lineTo(xc(b), Y(p.mean)) : ctx.moveTo(xc(b), Y(p.mean)),
    );
    ctx.stroke();
    for (const { p, b } of valid) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(xc(b), Y(p.mean), 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Legend.
  ctx.font = `11px ${th.mono}`;
  let lx = m.l + 8;
  for (const c of conds) {
    ctx.fillStyle = modeColor(th, c.mode);
    ctx.fillRect(lx, m.t + 2, 10, 3);
    ctx.fillText(`${c.mode} (n=${c.seeds})`, lx + 14, m.t + 7);
    lx += ctx.measureText(`${c.mode} (n=${c.seeds})`).width + 30;
  }
}
