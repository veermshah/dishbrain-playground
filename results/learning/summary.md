| Condition | Seeds | Mean rally (all) | Early third | Late third | Late - early | Steering (late) | Mapping index (end) |
|---|---|---|---|---|---|---|---|
| dishbrain | 12 | 0.340 [0.303, 0.377] | 0.323 [0.249, 0.398] | 0.357 [0.299, 0.415] | 0.033 [-0.065, 0.132] | -0.066 [-0.153, 0.022] | -0.036 [-0.153, 0.082] |
| silent | 12 | 0.349 [0.314, 0.383] | 0.333 [0.277, 0.390] | 0.364 [0.311, 0.416] | 0.030 [-0.044, 0.105] | -0.188 [-0.292, -0.084] | -0.082 [-0.257, 0.093] |
| avoidance | 12 | 0.800 [0.062, 1.539] | 0.420 [0.300, 0.540] | 0.824 [0.218, 1.431] | 0.404 [-0.105, 0.914] | 0.322 [0.130, 0.515] | 0.748 [0.522, 0.974] |
| avoidance-no-stdp | 12 | 0.379 [0.341, 0.417] | 0.402 [0.324, 0.479] | 0.356 [0.308, 0.404] | -0.045 [-0.149, 0.058] | 0.049 [-0.044, 0.142] | 0.012 [-0.009, 0.032] |
| rstdp | 12 | 0.336 [0.311, 0.361] | 0.325 [0.291, 0.360] | 0.315 [0.274, 0.356] | -0.010 [-0.080, 0.060] | -0.261 [-0.395, -0.127] | -0.063 [-0.129, 0.003] |
| rstdp-shuffled | 12 | 0.350 [0.318, 0.382] | 0.356 [0.298, 0.414] | 0.346 [0.292, 0.400] | -0.009 [-0.097, 0.078] | -0.170 [-0.288, -0.053] | -0.066 [-0.130, -0.003] |

| Comparison | Metric | Mann-Whitney U | p (two-sided) |
|---|---|---|---|
| dishbrain vs silent | lateRally | 67.0 | 0.795 (normal) |
| dishbrain vs silent | improvement | 76.0 | 0.843 (exact) |
| dishbrain vs silent | steeringLate | 102.0 | 0.089 (exact) |
| dishbrain vs silent | mappingEnd | 74.0 | 0.932 (exact) |
| dishbrain vs avoidance | lateRally | 23.0 | 0.005 (normal) |
| dishbrain vs avoidance | improvement | 44.0 | 0.114 (exact) |
| dishbrain vs avoidance | steeringLate | 18.0 | 0.001 (exact) |
| dishbrain vs avoidance | mappingEnd | 3.0 | 0.000 (exact) |
| dishbrain vs avoidance-no-stdp | lateRally | 74.0 | 0.931 (normal) |
| dishbrain vs avoidance-no-stdp | improvement | 95.0 | 0.198 (exact) |
| dishbrain vs avoidance-no-stdp | steeringLate | 34.0 | 0.028 (exact) |
| dishbrain vs avoidance-no-stdp | mappingEnd | 64.0 | 0.671 (exact) |
| dishbrain vs rstdp | lateRally | 90.5 | 0.298 (normal) |
| dishbrain vs rstdp | improvement | 91.0 | 0.291 (exact) |
| dishbrain vs rstdp | steeringLate | 113.0 | 0.017 (exact) |
| dishbrain vs rstdp | mappingEnd | 75.0 | 0.887 (exact) |
| dishbrain vs rstdp-shuffled | lateRally | 77.5 | 0.772 (normal) |
| dishbrain vs rstdp-shuffled | improvement | 87.5 | 0.386 (normal) |
| dishbrain vs rstdp-shuffled | steeringLate | 93.0 | 0.242 (exact) |
| dishbrain vs rstdp-shuffled | mappingEnd | 74.0 | 0.932 (exact) |
| silent vs avoidance | lateRally | 26.0 | 0.009 (normal) |
| silent vs avoidance | improvement | 38.0 | 0.052 (exact) |
| silent vs avoidance | steeringLate | 8.0 | 0.000 (exact) |
| silent vs avoidance | mappingEnd | 4.0 | 0.000 (exact) |
| silent vs avoidance-no-stdp | lateRally | 69.5 | 0.908 (normal) |
| silent vs avoidance-no-stdp | improvement | 93.0 | 0.242 (exact) |
| silent vs avoidance-no-stdp | steeringLate | 18.0 | 0.001 (exact) |
| silent vs avoidance-no-stdp | mappingEnd | 52.0 | 0.266 (exact) |
| silent vs rstdp | lateRally | 92.0 | 0.259 (normal) |
| silent vs rstdp | improvement | 87.0 | 0.410 (exact) |
| silent vs rstdp | steeringLate | 90.0 | 0.319 (exact) |
| silent vs rstdp | mappingEnd | 76.0 | 0.843 (exact) |
| silent vs rstdp-shuffled | lateRally | 87.5 | 0.386 (normal) |
| silent vs rstdp-shuffled | improvement | 85.0 | 0.478 (exact) |
| silent vs rstdp-shuffled | steeringLate | 67.0 | 0.799 (exact) |
| silent vs rstdp-shuffled | mappingEnd | 76.0 | 0.843 (exact) |
| avoidance vs avoidance-no-stdp | lateRally | 126.0 | 0.002 (normal) |
| avoidance vs avoidance-no-stdp | improvement | 117.0 | 0.008 (exact) |
| avoidance vs avoidance-no-stdp | steeringLate | 110.0 | 0.028 (exact) |
| avoidance vs avoidance-no-stdp | mappingEnd | 144.0 | 0.000 (exact) |
| avoidance vs rstdp | lateRally | 127.5 | 0.001 (normal) |
| avoidance vs rstdp | improvement | 112.0 | 0.020 (exact) |
| avoidance vs rstdp | steeringLate | 138.0 | 0.000 (exact) |
| avoidance vs rstdp | mappingEnd | 143.0 | 0.000 (exact) |
| avoidance vs rstdp-shuffled | lateRally | 122.0 | 0.004 (normal) |
| avoidance vs rstdp-shuffled | improvement | 111.0 | 0.024 (exact) |
| avoidance vs rstdp-shuffled | steeringLate | 132.0 | 0.000 (exact) |
| avoidance vs rstdp-shuffled | mappingEnd | 144.0 | 0.000 (exact) |
| avoidance-no-stdp vs rstdp | lateRally | 103.0 | 0.078 (normal) |
| avoidance-no-stdp vs rstdp | improvement | 63.0 | 0.630 (exact) |
| avoidance-no-stdp vs rstdp | steeringLate | 131.0 | 0.000 (exact) |
| avoidance-no-stdp vs rstdp | mappingEnd | 113.0 | 0.017 (exact) |
| avoidance-no-stdp vs rstdp-shuffled | lateRally | 76.0 | 0.840 (normal) |
| avoidance-no-stdp vs rstdp-shuffled | improvement | 62.0 | 0.590 (exact) |
| avoidance-no-stdp vs rstdp-shuffled | steeringLate | 125.0 | 0.001 (exact) |
| avoidance-no-stdp vs rstdp-shuffled | mappingEnd | 112.0 | 0.020 (exact) |
| rstdp vs rstdp-shuffled | lateRally | 60.5 | 0.525 (normal) |
| rstdp vs rstdp-shuffled | improvement | 71.0 | 0.977 (exact) |
| rstdp vs rstdp-shuffled | steeringLate | 51.0 | 0.242 (exact) |
| rstdp vs rstdp-shuffled | mappingEnd | 74.0 | 0.932 (exact) |
