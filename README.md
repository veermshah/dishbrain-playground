# DishBrain Playground

[![CI](https://github.com/veermshah/dishbrain-playground/actions/workflows/ci.yml/badge.svg)](https://github.com/veermshah/dishbrain-playground/actions/workflows/ci.yml)
[![Deploy](https://github.com/veermshah/dishbrain-playground/actions/workflows/pages.yml/badge.svg)](https://github.com/veermshah/dishbrain-playground/actions/workflows/pages.yml)

**Live demo: https://veermickey.com/dishbrain-playground/**

A simulated culture of 1000 spiking neurons sits on a virtual 8×8 electrode array and plays Pong in the
browser. I built it to poke at one question from the DishBrain paper: does the _kind_ of feedback a
network gets after a miss (predictable, unpredictable or none) change how fast it learns?

Short answer, for this model: no. Details and numbers are below.

![Screenshot of the playground in dark mode](docs/screenshot.png)

## Background

In 2022, Kagan and colleagues at Cortical Labs grew human and mouse cortical neurons on a high-density
multi-electrode array and connected them to a game of Pong [1]. Stimulation on a set of sensory electrodes
told the culture where the ball was (which electrode for the vertical position, pulse rate for distance).
Activity recorded in "motor" regions moved the paddle. The feedback was not a reward signal:

- after a **hit**, the culture got a short **predictable** stimulus (all sensory electrodes, 100 Hz, 100 ms);
- after a **miss**, it got an **unpredictable** stimulus (random sites, 5 Hz, 4 s);
- in the **silent** control, stimulation simply stopped for 4 s after a miss.

Cultures with the full feedback rallied longer in the later part of a 20-minute session than in the first
five minutes, and longer than controls. The authors read this through the free-energy principle [5]: a
self-organising system acts to make its sensory input predictable, so it should drift towards behaviour
that avoids the chaotic noise that follows a miss.

The obvious next question for a modeller is what mechanism could do this. The usual candidate in a
culture is spike-timing-dependent plasticity (STDP) [4]: synapses strengthen when the presynaptic neuron
fires just before the postsynaptic one and weaken in the reverse order. This project tests whether plain
STDP in a generic spiking network is enough.

## What's in the simulation

| Piece    | Model                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neurons  | 1000 Izhikevich neurons [2], 80% regular-spiking excitatory and 20% fast-spiking inhibitory, 1 ms steps                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Wiring   | Fixed out-degree random graph (p = 0.1, 100 synapses per neuron), excitatory delays 1-10 ms, background noise kicks, in the style of [3]                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Learning | Additive trace-based STDP on excitatory-to-excitatory synapses, τ = 20 ms, slightly depression-dominated (A− = 1.2 A+), weights clipped to [0, 10]                                                                                                                                                                                                                                                                                                                                                                                                                      |
| MEA      | Each neuron sits under one of 64 electrodes. Columns 3-4 are sensory, columns 0-1 are the "up" motor region, columns 6-7 are "down", columns 2 and 5 are recording only                                                                                                                                                                                                                                                                                                                                                                                                 |
| Encoding | Place code: the sensory row that gets pulsed is the ball's vertical offset from the paddle, in 8 bins. Rate code: pulse frequency goes from 4 Hz (ball at the far wall) to 40 Hz (ball at the paddle), as in the paper                                                                                                                                                                                                                                                                                                                                                  |
| Decoding | Smoothed population rates of the two motor regions (τ = 100 ms). Paddle velocity is proportional to (down − up)                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Feedback | **DishBrain** (default, the paper's protocol): after a hit, all 16 sensory electrodes pulse together at 100 Hz for 100 ms while play continues; after a miss, the game pauses for 4 s while random half-subsets of the sensory electrodes pulse at 5 Hz and 2× amplitude. **Ablations**, which change only what follows a miss and give nothing after a hit: **predictable** (the 100 Hz / 100 ms burst, then a quiet pause), **unpredictable** (the 4 s of random stimulation), **silent** (a quiet 4 s pause, then the game resets, as in the paper's silent control) |

Every condition uses the same 4 s post-miss window, so they differ only in the stimulation they deliver.

The place code is in paddle-relative coordinates. I chose that so a direct sensory-to-motor mapping is
enough to play well: "ball above the paddle" should drive the up region and "ball below" the down region.
That makes the task as easy as I could make it for a learning rule with no memory.

## Running it

Requires Node 22.18 or newer (the scripts use Node's built-in TypeScript support).

```bash
npm install
npm run dev          # open the playground at http://localhost:5173/dishbrain-playground/
npm test             # vitest: neuron determinism, STDP sign, encoder/decoder, game physics, stats
npm run build        # type-check and build to dist/
npm run experiment   # headless comparison, writes outputs/experiment.{json,csv} and summary.md
```

`npm run experiment` takes flags: `--seeds 12 --minutes 20 --bin 120 --preset dishbrain|highPlasticity|noPlasticity --modes predictable,silent --threads 8`.
It spreads sessions across worker threads; on my machine 48 twenty-minute sessions take about a minute and a half.

### In the browser

- **Feedback** switches live between the DishBrain protocol and the three ablations (keys `1`-`4`).
- **Pause / step / speed** go from 1× to 100× real time (`Space`, `S`, `+`, `-`).
- **STDP** turns plasticity on and off without restarting (`P`). **Reset** builds a new culture (`R`).
- **Parameters** expose neuron count, connection density, STDP rates and window, noise, pulse amplitude,
  feedback strength and window, motor smoothing and game settings, with three presets: _DishBrain-like_,
  _High plasticity_ and _No plasticity (control)_.
- **Run experiment** runs N paired seeds per condition in background Web Workers, plots mean learning
  curves with 95% confidence bands, reports Mann-Whitney U tests, and exports CSV or JSON.
- Panels: the game, the 8×8 electrode heatmap (stimulated electrodes are ringed), the spatial layout of
  the culture coloured by recent firing, a 2-second spike raster grouped by electrode role, rally length
  over time coloured by condition, and the E→E weight histogram over time.
- `?` opens an explainer, `T` switches between the dark and light themes. Reduced-motion preferences turn
  off the ball trail and glow.

## Results

Command: `npm run experiment -- --seeds 12 --minutes 20 --bin 120`, so 12 paired seeds per condition and
20 simulated minutes per session (the length of a DishBrain session). Seed _k_ builds the same network and
serves the same first ball in every condition. The metric is hits per rally, averaged within each session
and then across seeds. "Early" and "late" are the first and last thirds of the session. Brackets are 95%
t-intervals across seeds. Raw results are in [`results/`](results/).

**DishBrain-like preset (STDP on)**

| Condition     | Mean rally (all)     | Early third          | Late third           | Late − early          |
| ------------- | -------------------- | -------------------- | -------------------- | --------------------- |
| dishbrain     | 0.306 [0.283, 0.330] | 0.299 [0.249, 0.350] | 0.339 [0.270, 0.408] | 0.040 [−0.062, 0.142] |
| predictable   | 0.301 [0.277, 0.325] | 0.303 [0.249, 0.356] | 0.322 [0.273, 0.372] | 0.020 [−0.045, 0.084] |
| unpredictable | 0.307 [0.282, 0.332] | 0.301 [0.255, 0.346] | 0.354 [0.295, 0.414] | 0.054 [−0.011, 0.118] |
| silent        | 0.309 [0.280, 0.338] | 0.307 [0.251, 0.364] | 0.319 [0.262, 0.375] | 0.012 [−0.051, 0.074] |

Mann-Whitney U, DishBrain protocol against silent: p = 0.30 on late-third rally length and p = 0.38 on
improvement (late − early). Against the predictable and unpredictable ablations, all p > 0.4. Among the
ablations, the lowest p is unpredictable vs silent on late rally, p = 0.24.

**Controls**

| Preset                               | Condition     | Late third           | Late − early           |
| ------------------------------------ | ------------- | -------------------- | ---------------------- |
| No plasticity (STDP off)             | dishbrain     | 0.331 [0.245, 0.417] | 0.047 [−0.031, 0.124]  |
|                                      | predictable   | 0.297 [0.243, 0.351] | −0.010 [−0.082, 0.062] |
|                                      | unpredictable | 0.325 [0.247, 0.402] | 0.032 [−0.040, 0.104]  |
|                                      | silent        | 0.291 [0.239, 0.343] | −0.024 [−0.091, 0.043] |
| High plasticity (2.5× A±, τ = 40 ms) | dishbrain     | 0.350 [0.292, 0.408] | 0.029 [−0.049, 0.107]  |
|                                      | predictable   | 0.334 [0.271, 0.398] | 0.032 [−0.038, 0.102]  |
|                                      | unpredictable | 0.350 [0.290, 0.410] | 0.028 [−0.060, 0.116]  |
|                                      | silent        | 0.309 [0.261, 0.357] | 0.005 [−0.061, 0.071]  |

Across all three presets (36 comparisons), no p-value falls below 0.23.

### What this means

**The DishBrain protocol did not beat silent, and none of the ablations did either.** No condition
learned. Rally length stays around 0.3 hits per rally from start to finish, which is what a paddle drifting
at random gets with this paddle size. The network with plasticity switched off scores the same as the
networks with it on, including under the paper's protocol (0.331 late-third rally length with STDP off,
0.339 with it on), so STDP is not doing anything useful for the task here.

Before settling on the defaults I also tried a small number of variants by hand on 4-6 seeds each:
faster motor decoding (τ = 20 ms), larger STDP steps, a longer STDP window, stronger sensory pulses and
doubled feedback strength. None of them changed the picture, and I did not keep searching for a setting
that "works", because picking whichever configuration happens to clear p < 0.05 would just be p-hacking.

### Why plain STDP can't learn from this feedback

- **Timing.** STDP only pairs spikes about 20 ms apart. The feedback arrives hundreds of milliseconds to
  seconds after the motor activity that decided the hit or miss, so it cannot reach back to the synapses
  that made the move.
- **The feedback isn't contingent on any particular synapse.** The burst and the noise land on the same
  sensory electrodes whatever the network just did. They change whichever synapses happen to be active
  during the feedback, and that set is the same after good moves and bad ones.
- **No reward signal.** STDP has no way to tell a hit from a miss. Its update depends only on spike
  timing, so "predictable" and "unpredictable" are just two stimulation patterns to it, not good and bad
  outcomes.

Bridging that gap needs extra machinery: eligibility traces gated by a neuromodulatory signal
(Izhikevich's dopamine-modulated STDP), or a tight sensorimotor loop in which the network's own action
switches the stimulation off within the STDP window ("learning by stimulation avoidance"). Both are on my
list.

This is also a useful negative result in itself: whatever the cultures in the paper are doing, a generic
STDP network does not reproduce it just by being given the same stimulation protocol.

## Architecture

```
src/
  core/                framework-free TypeScript, runs in the browser, Web Workers and Node
    rng.ts             seeded mulberry32 PRNG
    network.ts         Izhikevich network in flat typed arrays, CSR synapses, delay ring buffer, STDP
    mea.ts             8x8 layout, neuron-to-electrode mapping, place/rate encoder, motor decoder
    pong.ts            game physics
    closedLoop.ts      network <-> MEA <-> game, feedback modes, rally bookkeeping
    experiment.ts      headless sessions, binned learning curves, summaries, CSV
    stats.ts           mean, 95% CI, Mann-Whitney U (exact and normal approximation)
    presets.ts         parameter presets
  sim.worker.ts        live simulation loop, posts ~30 frames/s to the UI
  experiment.worker.ts one headless session per message
  main.ts, ui/         canvas renderers, controls, parameter panel, experiment pool
scripts/
  experiment.ts        Node runner using worker_threads
  screenshot.ts        README screenshots with headless Chrome
tests/                 vitest suites
```

The live view and the experiment runner use exactly the same `ClosedLoop` code, and every run is
deterministic given its seed, so a curve from the browser and the same seed from `npm run experiment`
produce identical numbers. On a laptop the 1000-neuron loop runs at roughly 100× real time on one core.

## Limitations

- **This is a simulation, not neurons.** It has none of the biology that might matter: no glia, no
  short-term plasticity, no neuromodulators, no development, no real electrode physics. A result here says
  something about this model, not about the cultures.
- The network is tiny next to a real culture (1000 neurons against hundreds of thousands) and its
  connectivity is random rather than grown.
- The protocol is simplified: 16 sensory electrodes on an 8×8 grid instead of the paper's layout on a
  high-density array, and stimulation amplitudes are model currents rather than the paper's 75 mV and
  150 mV.
- The paper's separate **no-feedback** condition, where the ball bounces off the back wall and hits and
  misses have no consequence, is not implemented.
- Stimulation is modelled as a current injected into every neuron under an electrode, with no spread to
  neighbours and no stimulation artefact.
- The p-values are uncorrected for multiple comparisons. With a null result that only makes the
  conclusion more conservative.

## References

1. Kagan BJ, Kitchen AC, Tran NT, et al. (2022). In vitro neurons learn and exhibit sentience when embodied
   in a simulated game-world. _Neuron_ 110(23), 3952-3969. https://doi.org/10.1016/j.neuron.2022.09.001
2. Izhikevich EM (2003). Simple model of spiking neurons. _IEEE Transactions on Neural Networks_ 14(6),
   1569-1572.
3. Izhikevich EM (2006). Polychronization: computation with spikes. _Neural Computation_ 18(2), 245-282.
4. Bi G, Poo M (1998). Synaptic modifications in cultured hippocampal neurons: dependence on spike timing,
   synaptic strength, and postsynaptic cell type. _Journal of Neuroscience_ 18(24), 10464-10472.
5. Friston K (2010). The free-energy principle: a unified brain theory? _Nature Reviews Neuroscience_ 11,
   127-138.

## License

MIT, see [LICENSE](LICENSE).
