# DishBrain Playground

[![CI](https://github.com/veermshah/dishbrain-playground/actions/workflows/ci.yml/badge.svg)](https://github.com/veermshah/dishbrain-playground/actions/workflows/ci.yml)
[![Deploy](https://github.com/veermshah/dishbrain-playground/actions/workflows/pages.yml/badge.svg)](https://github.com/veermshah/dishbrain-playground/actions/workflows/pages.yml)

**Live demo: https://veermshah.github.io/dishbrain-playground/**

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

| Piece    | Model                                                                                                                                                                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neurons  | 1000 Izhikevich neurons [2], 80% regular-spiking excitatory and 20% fast-spiking inhibitory, 1 ms steps                                                                                                                                                                                |
| Wiring   | Fixed out-degree random graph (p = 0.1, 100 synapses per neuron), excitatory delays 1-10 ms, background noise kicks, in the style of [3]                                                                                                                                               |
| Learning | Additive trace-based STDP on excitatory-to-excitatory synapses, τ = 20 ms, slightly depression-dominated (A− = 1.2 A+), weights clipped to [0, 10]                                                                                                                                     |
| MEA      | Each neuron sits under one of 64 electrodes. Columns 3-4 are sensory, columns 0-1 are the "up" motor region, columns 6-7 are "down", columns 2 and 5 are recording only                                                                                                                |
| Encoding | Place code: the sensory row that gets pulsed is the ball's vertical offset from the paddle, in 8 bins. Rate code: pulse frequency goes from 4 Hz (ball at the far wall) to 40 Hz (ball at the paddle), as in the paper                                                                 |
| Decoding | Smoothed population rates of the two motor regions (τ = 100 ms). Paddle velocity is proportional to (down − up)                                                                                                                                                                        |
| Feedback | After every miss the game pauses for 2 s. **Predictable**: all 16 sensory electrodes pulse together at 100 Hz for 100 ms. **Unpredictable**: 5 Hz random events, each hitting a random half of the sensory electrodes at 2× amplitude, for the whole pause. **Silent**: no stimulation |

One deliberate difference from the paper: here all three conditions differ _only_ in what happens after a
miss, so the experiment isolates that single variable. In the paper, the predictable burst followed hits.

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
It spreads sessions across worker threads; on my machine 36 twenty-minute sessions take about a minute.

### In the browser

- **Feedback** toggles the post-miss condition live (keys `1`, `2`, `3`).
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
| predictable   | 0.306 [0.289, 0.322] | 0.280 [0.243, 0.316] | 0.330 [0.276, 0.384] | 0.050 [−0.030, 0.131] |
| unpredictable | 0.299 [0.267, 0.331] | 0.300 [0.252, 0.349] | 0.300 [0.263, 0.337] | 0.000 [−0.051, 0.050] |
| silent        | 0.307 [0.290, 0.325] | 0.294 [0.249, 0.339] | 0.326 [0.274, 0.378] | 0.032 [−0.052, 0.116] |

Mann-Whitney U on late-third rally length: predictable vs silent p = 0.91, predictable vs unpredictable
p = 0.44, unpredictable vs silent p = 0.56. The tests on improvement (late − early) are no better (all
p > 0.5).

**Controls**

| Preset                               | Condition     | Late third           | Late − early           |
| ------------------------------------ | ------------- | -------------------- | ---------------------- |
| No plasticity (STDP off)             | predictable   | 0.309 [0.252, 0.366] | −0.002 [−0.080, 0.076] |
|                                      | unpredictable | 0.337 [0.290, 0.385] | 0.048 [−0.015, 0.110]  |
|                                      | silent        | 0.314 [0.254, 0.373] | −0.005 [−0.088, 0.078] |
| High plasticity (2.5× A±, τ = 40 ms) | predictable   | 0.331 [0.281, 0.380] | 0.031 [−0.069, 0.130]  |
|                                      | unpredictable | 0.319 [0.276, 0.361] | 0.027 [−0.024, 0.078]  |
|                                      | silent        | 0.314 [0.264, 0.364] | 0.013 [−0.072, 0.097]  |

No pairwise comparison in either control reaches p < 0.25.

### What this means

**Predictable feedback did not beat silent or unpredictable feedback.** No condition learned. Rally length
stays around 0.3 hits per rally from start to finish, which is what a paddle drifting at random gets with
this paddle size. The network with plasticity switched off scores the same as the networks with it on, so
STDP is not doing anything useful for the task here.

Before settling on the defaults I also tried a small number of variants by hand on 4-6 seeds each:
faster motor decoding (τ = 20 ms), larger STDP steps, a longer STDP window, stronger sensory pulses and
doubled feedback strength. None of them changed the picture, and I did not keep searching for a setting
that "works", because picking whichever configuration happens to clear p < 0.05 would just be p-hacking.

My read on why plain STDP fails here is credit assignment in time. STDP only sees spike pairs about 20 ms
apart. A miss, and the feedback after it, comes hundreds of milliseconds to seconds after the motor
activity that caused it, so the feedback cannot single out the synapses that produced the wrong move. All
it can do is nudge every synapse that happens to be active during the feedback, which is the same set in
every trial. Getting the effect would need something that bridges that gap: eligibility traces with a
neuromodulatory signal (Izhikevich's dopamine-modulated STDP), short-term plasticity, homeostatic
mechanisms that respond to how predictable the input is, or a much tighter sensorimotor loop in the style
of "learning by stimulation avoidance". Those are the next things I want to try.

This is also a useful negative result in itself: whatever the cultures in the paper are doing, a
generic STDP network does not reproduce it just by being exposed to the same stimulation protocol.

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
- The protocol is simplified: a 2 s pause instead of 4 s, feedback after misses only, 16 sensory
  electrodes on an 8×8 grid instead of the paper's layout on a high-density array.
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
