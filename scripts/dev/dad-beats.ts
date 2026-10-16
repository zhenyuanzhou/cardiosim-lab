import { pace, TP06_DEFAULT_MODS } from "../../src/simulation/cellular/tp06";
const B = TP06_DEFAULT_MODS;
const DAD = { ...B, vRyRLeak: 0.00018, gCaL: 2, vUp: 4.5, kNaCa: 2.5 };
for (const beats of [20, 25, 30, 40]) {
  for (const cl of [500, 600]) {
    const r = pace("epi", DAD, cl, beats);
    console.log(`beats=${beats} CL=${cl} apd=${r.apd90} DAD=${r.dadAmplitude.toFixed(1)}mV triggered=${r.triggeredBeat}`);
  }
}
const EAD = { ...B, tauF: 0.5, gCaL: 2.5, gKs: 0.2 };
for (const beats of [20, 30]) {
  const r = pace("epi", EAD, 1000, beats);
  console.log(`EAD beats=${beats} apd=${r.apd90} EADs=${r.eadCount}`);
}
