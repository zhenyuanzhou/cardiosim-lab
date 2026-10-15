/**
 * Live numeric explanation of how the instantaneous heart vector relates to the primary lead,
 * plus the physiological event in progress (from the activation records, not a template).
 */
import { sim, useStore } from "../../state/store";
import { LEAD_INFO, dot3, frontalAngle, heartVector, isLimb, leadIndex, leadVector, len3 } from "./leadMath";
import { describeInstant } from "../../components/education/featureMap";

export function LeadInfoCard() {
  const t = useStore((s) => s.shownTime);
  const leads = useStore((s) => s.explorerLeads);
  const data = sim.data;
  const meta = sim.meta;
  if (!data || !meta) return null;
  const lead = leads[0];
  const info = LEAD_INFO[lead];
  const fit = leadVector(lead, data);
  const P = heartVector(data, t);
  const Pm = len3(P);
  const Lm = len3(fit.vec);
  const proj = dot3(P, fit.vec);
  const actual = data.at(t, leadIndex(lead));
  const cos = Pm > 1e-6 && Lm > 1e-6 ? proj / (Pm * Lm) : 0;
  const ang = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
  const inst = describeInstant(meta, data, data.measure(), t);
  const limb = isLimb(lead);
  const small = Pm < 0.03;
  return (
    <div className="lead-info" data-testid="lead-info">
      <div className="kv">
        <dt>Lead {lead}</dt>
        <dd>
          {info.def} · positive pole: {info.positive}
          {info.angle !== undefined ? ` · axis ${info.angle > 0 ? "+" : ""}${info.angle}°` : ""}
        </dd>
        <dt>Event</dt>
        <dd>
          <b>{inst.segment}</b> — {inst.origin}
        </dd>
        <dt>Heart vector</dt>
        <dd className="mono">
          |P| = {Pm.toFixed(2)} mV-eq · frontal {frontalAngle(P).toFixed(0)}° · {P[2] >= 0 ? "anterior" : "posterior"} component {Math.abs(P[2]).toFixed(2)}
        </dd>
        <dt>Projection</dt>
        <dd className="mono">
          L·P = |L||P| cos {ang.toFixed(0)}° = <b style={{ color: proj >= 0 ? "var(--ok)" : "var(--bad)" }}>{proj >= 0 ? "+" : ""}{proj.toFixed(2)} mV</b>
          {" · "}recorded {actual >= 0 ? "+" : ""}
          {actual.toFixed(2)} mV
        </dd>
      </div>
      <p className="note">
        {small
          ? "The net heart vector is near zero (isoelectric interval or cancelling sources), so every lead is near its baseline."
          : ang < 80
            ? `The vector points ${ang.toFixed(0)}° from the lead's positive direction → positive deflection.`
            : ang > 100
              ? `The vector points ${ang.toFixed(0)}° from the lead's positive direction (towards its negative pole) → negative deflection.`
              : `The vector is nearly perpendicular to this lead (${ang.toFixed(0)}°) → small or biphasic deflection.`}{" "}
        {limb
          ? "In this model the limb leads are exact dipole projections (Einthoven lead vectors)."
          : `Chest leads are computed from the full source distribution with a volume-conductor lead field; the dipole estimate explains ${(fit.r2 * 100).toFixed(0)} % of this lead's variance — the rest reflects nearby (non-dipolar) sources. The reference is the Wilson central terminal (mean of RA, LA, LL).`}
      </p>
      <p className="note">{inst.caveat}</p>
    </div>
  );
}
