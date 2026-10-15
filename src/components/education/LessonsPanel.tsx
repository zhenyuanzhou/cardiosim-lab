/** Guided lessons: load the starting state, apply one manipulation live, then answer the quiz. */
import { useState } from "react";
import { LESSONS, baseParams, type Lesson } from "../../education/lessons";
import { cloneParams } from "../../simulation/core/params";
import { useStore } from "../../state/store";
import { applyLive, restart } from "../../state/actions";

function Quiz({ lesson }: { lesson: Lesson }) {
  const [pick, setPick] = useState<Record<number, number>>({});
  return (
    <div className="quiz">
      {lesson.quiz.map((q, i) => (
        <fieldset key={i}>
          <legend>{q.q}</legend>
          {q.options.map((o, k) => (
            <label key={k} className={pick[i] === k ? (k === q.answer ? "ok" : "bad") : ""}>
              <input type="radio" name={`${lesson.id}-${i}`} checked={pick[i] === k} onChange={() => setPick({ ...pick, [i]: k })} /> {o}
            </label>
          ))}
          {pick[i] !== undefined && <p className="note">{pick[i] === q.answer ? "Correct. " : "Not quite. "}{q.why}</p>}
        </fieldset>
      ))}
    </div>
  );
}

export function LessonsPanel() {
  const [id, setId] = useState<string>(LESSONS[0].id);
  const [applied, setApplied] = useState(false);
  const lesson = LESSONS.find((l) => l.id === id)!;
  const set = useStore((s) => s.set);
  const load = () => {
    set({ mode: lesson.mode, explorerLeads: lesson.leads, scenarioId: `lesson:${lesson.id}` });
    restart(baseParams(lesson.start));
    setApplied(false);
  };
  const manipulate = () => {
    if (!lesson.manipulation) return;
    const p = cloneParams(useStore.getState().params);
    lesson.manipulation.apply(p);
    applyLive(p);
    setApplied(true);
  };
  return (
    <div className="lessons" data-testid="lessons">
      <label className="note" htmlFor="lesson-pick">Lesson</label>
      <select id="lesson-pick" value={id} onChange={(e) => { setId(e.target.value); setApplied(false); }}>
        {LESSONS.map((l, i) => (
          <option key={l.id} value={l.id}>
            {i + 1}. {l.title}
          </option>
        ))}
      </select>
      <h3>{lesson.title}</h3>
      <p><b>Objective.</b> {lesson.objective}</p>
      <ol className="steps">
        <li>
          <button className="btn" onClick={load}>Load starting state</button> <span className="note">opens the {lesson.mode} view with leads {lesson.leads.join(", ")}</span>
        </li>
        {lesson.manipulation && (
          <li>
            <button className="btn primary" onClick={manipulate} disabled={applied}>{lesson.manipulation.label}</button>
            <span className="note"> applied live at the current time — compare beats before and after the change</span>
          </li>
        )}
        <li>Observe:
          <ul>{lesson.expected.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </li>
      </ol>
      <p><b>Mechanism.</b> {lesson.mechanism}</p>
      <p className="note"><b>Fidelity.</b> {lesson.fidelity}</p>
      <Quiz key={lesson.id} lesson={lesson} />
    </div>
  );
}
