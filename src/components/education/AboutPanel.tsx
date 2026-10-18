import { sim, useStore } from "../../state/store";
import { APP_VERSION, RELEASE_DATE } from "../../version";

export function AboutPanel({ buildMs }: { buildMs: number }) {
  useStore((s) => s.shownTime);
  const meta = sim.meta;
  return (
    <>
      <div className="card">
        <h4>What this is · version {APP_VERSION} ({RELEASE_DATE})</h4>
        <p>
          CardioSim Lab links cellular action potentials, spatial activation of an idealised heart and a forward-computed 12-lead ECG through one causal simulation on one clock. Changing a parameter changes the simulated electrophysiology; the ECG is recomputed from it, never looked up.
        </p>
        <p className="note">For research education and concept demonstration only. It is not a clinically validated diagnostic system, not a patient-specific model, and does not predict clinical drug effects.</p>
      </div>
      <div className="card">
        <h4>How the model works</h4>
        <dl className="kv">
          <dt>Level 1</dt>
          <dd>Conduction network: SA node automaticity with autonomic modulation, directional AV node with recovery-dependent delay (Sun et al. 1995 form), His bundle, bundle branches, fascicles, Purkinje networks, latent junctional/ventricular pacemakers with overdrive reset.</dd>
          <dt>Level 2</dt>
          <dd>Voxelised atria and ventricles (2.5 mm grid) with fibre-based anisotropic conduction, refractoriness and CV restitution; event-driven propagation.</dd>
          <dt>Cells</dt>
          <dd>Reduced-order action-potential waveforms anchored to activation time and APD90; two-component APD restitution (steady-state slope fitted to human in-vivo data, Franz 1988; nominal fast recovery term and cycle-length memory).</dd>
          <dt>ECG</dt>
          <dd>Lead field of the impressed current −σi∇Vm: infinite-medium potentials at V1–V6, Einthoven lead vectors for limb electrodes, Wilson central terminal, Goldberger leads.</dd>
          <dt>Level 3</dt>
          <dd>ten Tusscher–Panfilov 2006 ventricular cell model in the Ionic cell tab (single cells; results mapped onto the tissue as APD/CV scaling). Re-entry (AVNRT, AVRT, flutter, AF, scar VT, polymorphic VT, fibrillation) emerges from the tissue graph and lumped AV links. The ionic model is not coupled cell-to-cell, so afterdepolarisations exist only in the single cell and reach the tissue as the timing of a triggered beat; torsades de pointes uses a drifting source on a mid-wall path, which reproduces the twisting morphology; the run is gated on the long-QT substrate (it does nothing with a normal action-potential duration) but the source itself is imposed rather than emergent, because this engine has no diffusion and so cannot grow a rotor. Calcium disorders use a measured human QT slope rather than the cell model, which reproduces the opposite direction. See the scenario registry and SCIENTIFIC_LIMITATIONS.</dd>
        </dl>
      </div>
      <div className="card">
        <h4>Using it</h4>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>Space plays/pauses; ← / → step 20 ms; [ and ] jump between beats.</li>
          <li>Click the ECG (Inspect) to freeze time and see what the heart is doing at that instant.</li>
          <li>Click any cell in the heart to add its action potential to Panel B.</li>
          <li>Parameters apply live at the display time; the Explain tab reports measured consequences.</li>
          <li>A/B: set a baseline, change parameters, run both from t = 0 and overlay them.</li>
        </ul>
      </div>
      {meta && (
        <div className="card">
          <h4>Model statistics</h4>
          <dl className="kv mono">
            <dt>Cells</dt>
            <dd>
              {meta.n.toLocaleString()} ({meta.counts.atrial} atrial, {meta.counts.ventricular} ventricular, {meta.counts.conduction} conduction system)
            </dd>
            <dt>Build</dt>
            <dd>{buildMs.toFixed(0)} ms</dd>
            <dt>Engine</dt>
            <dd>{sim.usingWorker ? "Web Worker" : "main thread (worker unavailable)"}</dd>
            <dt>Last chunk</dt>
            <dd>{sim.lastComputeMs.toFixed(0)} ms per 500 ms simulated</dd>
            <dt>Sampling</dt>
            <dd>{meta && sim.data ? (1000 / sim.data.dt).toFixed(0) : "—"} Hz</dd>
          </dl>
        </div>
      )}
      <div className="card">
        <h4>Key references</h4>
        <ul style={{ margin: 0, paddingLeft: 18 }} className="note">
          <li>Durrer D et al. Total excitation of the isolated human heart. Circulation 1970;41:899–912.</li>
          <li>Lee YS, Lien WP. Left ventricular approach for recording His bundle potential in man. Chest 1975;67:696–701.</li>
          <li>Jose AD, Collison D. Intrinsic heart rate in man. Cardiovasc Res 1970;4:160–167.</li>
          <li>van Schie MS et al. Atrial conduction velocity estimation. Europace 2021;23:1815–1825.</li>
          <li>Franz MR et al. Circulation 1987;75:379–386 · J Clin Invest 1988;82:972–979.</li>
          <li>Opthof T et al. Heart Rhythm 2017;14:265–272 · Meijborg VMF et al. Circ Arrhythm Electrophysiol 2014;7:524–531.</li>
          <li>Mitchell CC, Schaeffer DG. Bull Math Biol 2003;65:767–793.</li>
          <li>Sun J, Amellal F, Glass L, Billette J. J Theor Biol 1995;173:79–91.</li>
          <li>Neic A et al. J Comput Phys 2017;346:191–211 · van Oosterom A, Oostendorp TF. Heart 2004;90:165–168.</li>
          <li>Kligfield P et al. Circulation 2007;115:1306–1324 · Surawicz B et al.; Rautaharju PM et al. Circulation 2009;119:e235/e241.</li>
        </ul>
        <p className="note">Full list with DOIs: docs/REFERENCES.md.</p>
      </div>
    </>
  );
}
