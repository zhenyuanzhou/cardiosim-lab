/**
 * Can a wave be made to CIRCULATE around the M-cell island, and does it then sustain itself?
 *
 * During a fast run the island's refractory period exceeds the cycle length, so it is never
 * re-excited: it behaves as a persistent obstacle, and re-entry around it needs no curvature physics.
 * The only question is initiation — a single stimulus sends arms both ways and they annihilate. Here
 * two stimuli are placed on a ring around the island and fired in sequence, so the second wave can
 * only run one way round (the classical S1–S2 cross-field trick).
 */
import { probe, stimNode, ISLAND } from "./tdp-block";
import type { Setup } from "./tdp-emergent";
const list = (v: string | undefined, d: string) => (v ?? d).split(",").map(Number);
ISLAND.phiSd = +(process.argv[8] ?? 55);
ISLAND.longSd = +(process.argv[9] ?? 0.22);
const N = 8;
for (const mBoost of list(process.argv[2], "140"))
  for (const r of list(process.argv[3], "14,18,22"))
    for (const cv of list(process.argv[4], "0.7"))
      for (const s2 of list(process.argv[5], "455,475,495"))
        for (const d23 of list(process.argv[6], "60,90,120"))
          for (const k of list(process.argv[7], "2")) {
            const site = `ring0of${N}r${r}`;
            const site3 = `ring${k}of${N}r${r}`;
            if (stimNode(site) === stimNode(site3)) continue;
            const s: Setup = { apd: 1.3, grad: 1, floor: 0.45, cv, het: 0, s2, site, s3: d23, site3, mBoost, smooth: 1, phiSd: ISLAND.phiSd, longSd: ISLAND.longSd };
            const res = probe(s);
            if (true)
              console.log(`mB${mBoost} r${r} cv${cv} s2=${s2} d23=${d23} k=${k}: captured ${(100 * res.frac).toFixed(0)} % | re ${res.re} | RUN ${res.dur.toFixed(0)} ms (${res.beats} beats)`);
          }
