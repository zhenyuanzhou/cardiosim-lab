import { pace, TP06_DEFAULT_MODS as B } from "../../src/simulation/cellular/tp06";
// EAD preset: when does the secondary upstroke occur relative to the AP upstroke?
for (const [label, mods, cl] of [
  ["EAD", { ...B, tauF: 0.5, gCaL: 2.5, gKs: 0.2 }, 1000],
  ["EAD severe", { ...B, tauF: 0.5, gCaL: 3, gKs: 0.2 }, 1000],
  ["DAD", { ...B, gCaL: 2, vUp: 4.5, kNaCa: 2.5, vRyRLeak: 0.00018 }, 600],
] as const) {
  const r = pace("epi", mods as never, cl, 30);
  const v = r.v;
  // find local minima followed by rises (EAD takeoff) and the post-repolarisation upstroke (DAD)
  const events: string[] = [];
  let vmin = Infinity, rising = false;
  for (let i = 30; i < v.length; i++) {
    if (v[i] < vmin) { vmin = v[i]; rising = false; }
    if (!rising && v[i] > vmin + 2 && v[i] > -60) { events.push(`takeoff@${i * r.sampleDt}ms (from ${vmin.toFixed(0)}mV)`); rising = true; }
  }
  let trig = -1;
  for (let i = 30; i < v.length; i++) if (v[i] > -40 && v[i - 1] <= -40 && i * r.sampleDt > 100) { trig = i * r.sampleDt; break; }
  console.log(`${label}: apd90=${r.apd90} EADs=${r.eadCount} DAD=${r.dadAmplitude.toFixed(0)}mV trig=${r.triggeredBeat} upstrokeCross@${trig}ms`);
  console.log("   ", events.slice(0, 6).join("  "));
}
