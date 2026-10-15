import { sim, useStore } from "../../state/store";

const f0 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(0));

/** Signal-derived measurements of the latest complete beat, side by side with model timing. */
export function MeasurementsTable() {
  const t = useStore((s) => s.shownTime);
  const data = sim.data;
  if (!data) return null;
  const beats = data.measure().filter((b) => b.tEnd !== null && b.tEnd <= t);
  const b = beats[beats.length - 1];
  if (!b) return <div className="note">Measurements appear after the first complete beat.</div>;
  const tr = b.truth;
  const w = tr ? data.waves.get(tr.waveId) : undefined;
  const rows: [string, string, string, string][] = [
    ["Heart rate (bpm)", f0(b.hr), w ? "" : "", "60–100"],
    ["RR (ms)", f0(b.rr), "", ""],
    ["PR (ms)", f0(b.pr), tr && tr.pOn !== null ? f0(tr.qrsOn - tr.pOn) : "—", "120–200"],
    ["P duration (ms)", b.pOn !== null && b.pOff !== null ? f0(b.pOff - b.pOn) : "—", w ? f0(w.tLastAtrial - w.tFirstAtrial) : "—", "< 120"],
    ["QRS (ms)", f0(b.qrs), tr ? f0(tr.qrsOff - tr.qrsOn) : "—", "< 110"],
    ["QT (ms)", f0(b.qt), tr ? f0(tr.repolEnd - tr.qrsOn) : "—", ""],
    ["QTc Bazett (ms)", f0(b.qtcBazett), "", "≤ 450–460"],
    ["QTc Fridericia (ms)", f0(b.qtcFridericia), "", ""],
    ["QRS axis (°)", f0(b.axisQRS), "", "−30 to +90"],
    ["P / T axis (°)", `${f0(b.axisP)} / ${f0(b.axisT)}`, "", ""],
    ["AH (ms)", "—", tr ? f0(tr.ah) : "—", "76 ± 16*"],
    ["HV (ms)", "—", tr ? f0(tr.hisToV) : "—", "45 ± 6*"],
  ];
  return (
    <div>
      <p className="h3">Measurements · beat at {(b.qrsOn / 1000).toFixed(2)} s</p>
      <table className="meas" data-testid="measurements">
        <thead>
          <tr>
            <th>Quantity</th>
            <th title="Measured from the simulated ECG signals only">ECG signal</th>
            <th title="Internal timing of the activation model">Model</th>
            <th>Adult ref.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, a, m, r]) => (
            <tr key={k}>
              <td>{k}</td>
              <td className="mono">{a}</td>
              <td className="mono dim">{m}</td>
              <td className="dim">{r}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note" style={{ marginTop: 6 }}>
        ECG-signal values come from fiducial detection on the simulated leads; "Model" values are the activation model's own timings (P on = first atrial activation, QRS = first→last ventricular activation, QT = to last APD90). *Lee &amp; Lien 1975 (intracardiac, not visible on the surface ECG).
      </p>
    </div>
  );
}
