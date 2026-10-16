import { measure } from "./avnrt-scan";
for (const se of [250, 200, 170]) for (const sl of [180, 210, 240]) {
  const r: any = measure((p) => { p.avNode.retroTime = 15; p.avNode.retroErp = 150; p.avNode.slowAhMin = sl; p.avNode.slowErp = se; });
  console.log(`slowErp=${se} slowAhMin=${sl} -> n=${r.n} CL=${r.cl?.toFixed(0)} VA=${r.va?.toFixed(0)} AVN=${r.avn?.toFixed(0)}`);
}
