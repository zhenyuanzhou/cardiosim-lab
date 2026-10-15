import { useState } from "react";
import { sim, useStore } from "../../state/store";
import { FIDELITY_TABLE, runChecks } from "./validation";

export function ValidationPanel() {
  useStore((s) => s.shownTime);
  const params = useStore((s) => s.params);
  const [det, setDet] = useState<string | null>(null);
  const data = sim.data;
  if (!data) return null;
  const checks = runChecks(data, data.measure());
  const groups = [...new Set(checks.map((c) => c.group))];
  const selfTest = async () => {
    setDet("running…");
    const r = await sim.compare(params, params, 4000);
    let maxDiff = 0;
    for (let i = 0; i < Math.min(r.a.ecg.length, r.b.ecg.length); i++) maxDiff = Math.max(maxDiff, Math.abs(r.a.ecg[i] - r.b.ecg[i]));
    setDet(r.a.ecg.length === r.b.ecg.length && maxDiff === 0 ? `PASS · two independent 4 s runs are bit-identical (${r.a.ecg.length / 15} samples)` : `FAIL · max difference ${maxDiff}`);
  };
  return (
    <>
      <p className="note">Live checks on the current simulation. The automated test-suite (npm test) covers the same physiology plus conduction and signal tests.</p>
      {groups.map((g) => (
        <div key={g}>
          <p className="h3">{g}</p>
          <table className="meas" data-testid="validation-table">
            <tbody>
              {checks
                .filter((c) => c.group === g)
                .map((c) => (
                  <tr key={c.name} title={c.criterion}>
                    <td style={{ whiteSpace: "normal" }}>
                      {c.name}
                      <div className="note">{c.criterion}</div>
                    </td>
                    <td className="mono" style={{ whiteSpace: "normal" }}>{c.value}</td>
                    <td>
                      <span className={`status ${c.status === "n/a" ? "na" : c.status}`}>{c.status}</span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
      <div className="toolbar">
        <button className="btn" onClick={selfTest}>Run determinism self-test</button>
        {det && <span className="note">{det}</span>}
      </div>
      <p className="h3">Fidelity classification of outputs</p>
      <table className="meas">
        <tbody>
          {FIDELITY_TABLE.map((r) => (
            <tr key={r.output}>
              <td style={{ whiteSpace: "normal" }}>
                {r.output}
                <div className="note">{r.note}</div>
              </td>
              <td style={{ whiteSpace: "normal", textAlign: "left" }}>
                <span className={`ev ${r.category.startsWith("Mech") ? "literature" : r.category.startsWith("Red") ? "calibrated" : "nominal"}`}>{r.category}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">No output of this simulator is clinically validated. Numerical values are model outputs for teaching and concept demonstration.</p>
    </>
  );
}
