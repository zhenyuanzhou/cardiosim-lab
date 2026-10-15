/**
 * Binary min-heap of simulation events keyed by time (ms).
 * Ties are broken by insertion sequence so that processing order is deterministic.
 */
export const EV_EXCITE = 0; // excitation arrives at `node` coming from `src`
export const EV_AUTO = 1; // automaticity (pacemaker) check for `node`; `stamp` = lastAct when scheduled

export interface QueueSnapshot {
  time: Float64Array;
  seq: Float64Array;
  node: Int32Array;
  src: Int32Array;
  wave: Int32Array;
  kind: Uint8Array;
  stamp: Float64Array;
  size: number;
  seqCounter: number;
}

export class EventQueue {
  private cap: number;
  private size = 0;
  private seqCounter = 0;
  time: Float64Array;
  seq: Float64Array;
  node: Int32Array;
  src: Int32Array;
  wave: Int32Array;
  kind: Uint8Array;
  stamp: Float64Array;

  constructor(capacity = 1 << 16) {
    this.cap = capacity;
    this.time = new Float64Array(capacity);
    this.seq = new Float64Array(capacity);
    this.node = new Int32Array(capacity);
    this.src = new Int32Array(capacity);
    this.wave = new Int32Array(capacity);
    this.kind = new Uint8Array(capacity);
    this.stamp = new Float64Array(capacity);
  }

  get length(): number {
    return this.size;
  }

  peekTime(): number {
    return this.size > 0 ? this.time[0] : Infinity;
  }

  private grow(): void {
    const nc = this.cap * 2;
    const g = <T extends Float64Array | Int32Array | Uint8Array>(a: T): T => {
      const b = new (a.constructor as { new (n: number): T })(nc);
      b.set(a);
      return b;
    };
    this.time = g(this.time);
    this.seq = g(this.seq);
    this.node = g(this.node);
    this.src = g(this.src);
    this.wave = g(this.wave);
    this.kind = g(this.kind);
    this.stamp = g(this.stamp);
    this.cap = nc;
  }

  private less(i: number, j: number): boolean {
    const ti = this.time[i];
    const tj = this.time[j];
    return ti < tj || (ti === tj && this.seq[i] < this.seq[j]);
  }

  private swap(i: number, j: number): void {
    const s = (a: Float64Array | Int32Array | Uint8Array) => {
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    };
    s(this.time);
    s(this.seq);
    s(this.node);
    s(this.src);
    s(this.wave);
    s(this.kind);
    s(this.stamp);
  }

  push(time: number, node: number, src: number, wave: number, kind: number, stamp = 0): void {
    if (this.size >= this.cap) this.grow();
    let i = this.size++;
    this.time[i] = time;
    this.seq[i] = this.seqCounter++;
    this.node[i] = node;
    this.src[i] = src;
    this.wave[i] = wave;
    this.kind[i] = kind;
    this.stamp[i] = stamp;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(i, p)) {
        this.swap(i, p);
        i = p;
      } else break;
    }
  }

  /** Removes the root; its fields are copied into `out`. */
  pop(out: { time: number; node: number; src: number; wave: number; kind: number; stamp: number }): boolean {
    if (this.size === 0) return false;
    out.time = this.time[0];
    out.node = this.node[0];
    out.src = this.src[0];
    out.wave = this.wave[0];
    out.kind = this.kind[0];
    out.stamp = this.stamp[0];
    const last = --this.size;
    if (last > 0) {
      this.time[0] = this.time[last];
      this.seq[0] = this.seq[last];
      this.node[0] = this.node[last];
      this.src[0] = this.src[last];
      this.wave[0] = this.wave[last];
      this.kind[0] = this.kind[last];
      this.stamp[0] = this.stamp[last];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.size && this.less(l, m)) m = l;
        if (r < this.size && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return true;
  }

  snapshot(): QueueSnapshot {
    const n = this.size;
    return {
      time: this.time.slice(0, n),
      seq: this.seq.slice(0, n),
      node: this.node.slice(0, n),
      src: this.src.slice(0, n),
      wave: this.wave.slice(0, n),
      kind: this.kind.slice(0, n),
      stamp: this.stamp.slice(0, n),
      size: n,
      seqCounter: this.seqCounter,
    };
  }

  restore(s: QueueSnapshot): void {
    while (this.cap < s.size) this.grow();
    this.time.set(s.time);
    this.seq.set(s.seq);
    this.node.set(s.node);
    this.src.set(s.src);
    this.wave.set(s.wave);
    this.kind.set(s.kind);
    this.stamp.set(s.stamp);
    this.size = s.size;
    this.seqCounter = s.seqCounter;
  }

  clear(): void {
    this.size = 0;
    this.seqCounter = 0;
  }
}
