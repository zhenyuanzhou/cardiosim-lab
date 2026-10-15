/**
 * Deterministic seeded PRNG (mulberry32). All stochastic model elements must draw
 * from an instance of this generator so that a given seed reproduces a run exactly.
 * Phase 1 contains no stochastic physiology; the generator is wired in for Phase 2+
 * (sinus pauses, stochastic AV block, AF substrate).
 */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  get state(): number {
    return this.s;
  }
  set state(v: number) {
    this.s = v >>> 0;
  }
}
