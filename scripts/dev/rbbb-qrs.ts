import { run, params, median } from "../../tests/helpers/sim";
const a = run(params(), 6000), b = run(params({ hisPurkinje: { rbbCv: 0.05 } }), 6000);
const span = (r: any) => median(r.waves.slice(2).map((w: any) => w.tLastVent - w.tFirstVent));
const q = (r: any) => median(r.beats.map((x: any) => x.qrs));
console.log("truth", span(a), span(b), "measured", q(a), q(b));
