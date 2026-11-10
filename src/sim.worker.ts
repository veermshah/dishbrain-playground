/// <reference lib="webworker" />
import { ClosedLoop, type FeedbackMode } from './core/closedLoop.ts';
import { N_ELECTRODES } from './core/mea.ts';
import type { FrameMsg, ToSim, WeightsMsg } from './protocol.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let sim: ClosedLoop | null = null;
let speed = 1;
let paused = false;
let pendingStep = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastWall = 0;
let lastFrameWall = 0;
let lastWeightsT = -Infinity;

const MAX_SPIKES = 30000;
let spikeIds = new Uint16Array(MAX_SPIKES);
let spikeTimes = new Float64Array(MAX_SPIKES);
let nSpk = 0;
const counts = new Float32Array(N_ELECTRODES);
const stim = new Uint8Array(N_ELECTRODES);
let activity = new Float32Array(0);
let frameSimMs = 0;
let frameWallMs = 0;
let ralliesSent = 0;
let events: { t: number; kind: 'hit' | 'miss' }[] = [];

function stepOnce(s: ClosedLoop) {
  s.step();
  const net = s.net;
  for (let q = 0; q < net.nSpikes; q++) {
    const i = net.spikes[q];
    activity[i] += 1;
    if (nSpk < MAX_SPIKES) {
      spikeIds[nSpk] = i;
      spikeTimes[nSpk] = s.t;
      nSpk++;
    }
  }
  for (let e = 0; e < N_ELECTRODES; e++) if (s.stimulated[e] > stim[e]) stim[e] = s.stimulated[e];
  if (s.lastEvent) events.push({ t: s.t, kind: s.lastEvent });
  frameSimMs++;
}

function postFrame(s: ClosedLoop) {
  s.drainElectrodeCounts(counts);
  const rate = new Float32Array(N_ELECTRODES);
  const sec = Math.max(1, frameSimMs) / 1000;
  for (let e = 0; e < N_ELECTRODES; e++) {
    const m = s.members[e].length;
    rate[e] = m ? counts[e] / m / sec : 0;
  }
  // Activity: exponential decay over ~200 ms of sim time per frame.
  const act = new Uint8Array(activity.length);
  const decay = Math.exp(-Math.max(1, frameSimMs) / 200);
  for (let i = 0; i < activity.length; i++) {
    act[i] = Math.min(255, Math.round(activity[i] * 60));
    activity[i] *= decay;
  }
  const newRallies = s.rallies.slice(ralliesSent).map((r) => ({ ...r, mode: s.mode }));
  ralliesSent = s.rallies.length;
  const ids = spikeIds.slice(0, nSpk);
  const times = spikeTimes.slice(0, nSpk);
  nSpk = 0;
  const st = stim.slice();
  stim.fill(0);
  const msg: FrameMsg = {
    type: 'frame',
    t: s.t,
    ballX: s.pong.s.ballX,
    ballY: s.pong.s.ballY,
    paddleY: s.pong.s.paddleY,
    paddleHeight: s.pong.p.paddleHeight,
    ballRadius: s.pong.p.ballRadius,
    feedbackLeft: s.feedbackLeft,
    feedbackWindow: s.cfg.feedback.windowMs,
    mode: s.mode,
    paused,
    hits: s.hits,
    misses: s.misses,
    currentRally: s.currentRally,
    newRallies,
    electrodeRate: rate,
    stimulated: st,
    spikeIds: ids,
    spikeTimes: times,
    activity: act,
    rateUp: s.decoder.rateUp,
    rateDown: s.decoder.rateDown,
    command: s.decoder.command(),
    meanW: s.net.meanPlasticWeight(),
    achieved: frameWallMs > 0 ? frameSimMs / frameWallMs : 0,
    events,
  };
  events = [];
  frameSimMs = 0;
  frameWallMs = 0;
  ctx.postMessage(msg, [rate.buffer, ids.buffer, times.buffer, act.buffer, st.buffer]);

  if (s.t - lastWeightsT >= 1000) {
    lastWeightsT = s.t;
    const hist = s.net.weightHistogram(40);
    const w: WeightsMsg = { type: 'weights', t: s.t, hist };
    ctx.postMessage(w, [hist.buffer]);
  }
}

function loop() {
  timer = null;
  const s = sim;
  if (!s) return;
  const now = performance.now();
  const wallDt = Math.min(100, now - lastWall);
  lastWall = now;
  let budget = paused ? 0 : Math.round(wallDt * speed);
  budget = Math.min(budget, 2000);
  if (pendingStep > 0) {
    budget += pendingStep;
    pendingStep = 0;
  }
  // Never block the worker for more than ~25 ms per tick.
  const deadline = now + 25;
  let k = 0;
  while (k < budget) {
    stepOnce(s);
    k++;
    if ((k & 255) === 0 && performance.now() > deadline) break;
  }
  frameWallMs += wallDt;
  if (now - lastFrameWall >= 33) {
    lastFrameWall = now;
    postFrame(s);
  }
  timer = setTimeout(loop, paused && pendingStep === 0 ? 33 : 4);
}

function start() {
  if (timer === null) {
    lastWall = performance.now();
    timer = setTimeout(loop, 0);
  }
}

ctx.onmessage = (ev: MessageEvent<ToSim>) => {
  const m = ev.data;
  switch (m.type) {
    case 'init': {
      sim = new ClosedLoop(m.config, m.seed);
      activity = new Float32Array(sim.net.n);
      spikeIds = new Uint16Array(MAX_SPIKES);
      spikeTimes = new Float64Array(MAX_SPIKES);
      nSpk = 0;
      ralliesSent = 0;
      lastWeightsT = -Infinity;
      events = [];
      const L = sim.layout;
      ctx.postMessage({
        type: 'layout',
        n: sim.net.n,
        nExc: sim.net.nExc,
        x: sim.net.x.slice(),
        y: sim.net.y.slice(),
        electrodeOf: sim.electrodeOf.slice(),
        roles: L.roles,
        sensoryByPlace: L.sensoryByPlace,
        wMax: sim.net.p.wMax,
      });
      start();
      break;
    }
    case 'mode':
      if (sim) sim.mode = m.mode as FeedbackMode;
      break;
    case 'speed':
      speed = Math.max(0.1, Math.min(200, m.speed));
      break;
    case 'pause':
      paused = m.paused;
      break;
    case 'step':
      pendingStep += Math.max(0, Math.round(m.ms));
      break;
    case 'plastic':
      if (sim) sim.net.p.plastic = m.on;
      break;
  }
};
