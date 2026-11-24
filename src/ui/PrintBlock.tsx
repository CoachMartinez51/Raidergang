import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { dateFor, exName, prescription, setText, WEEKDAY_LONG, type LiftBlock, type SetLog } from '../lib/lifts';
import { prettyDay } from '../lib/dates';

/**
 * Printable lift sheet (one page per lift day), laid out like the Winter Lifting
 * template: weekly Sets/Reps with blank WT boxes to write in. On iPhone/iPad,
 * Print → share → Save to Files gives a PDF.
 */
export function PrintBlock({ block, athlete, startDate, logs = [], onClose }: {
  block: LiftBlock; athlete?: string; startDate?: string; logs?: SetLog[]; onClose: () => void;
}) {
  useEffect(() => {
    document.body.classList.add('printing');
    return () => document.body.classList.remove('printing');
  }, []);
  const weeks = Array.from({ length: block.weeks }, (_, i) => i + 1);
  const logged = (exId: string, week: number, set: number) => {
    const l = logs.find(x => x.block_exercise_id === exId && x.week === week && x.set_number === set);
    return l ? setText(l) : '';
  };

  return createPortal(
    <div className="print-root">
      <div className="print-toolbar no-print">
        <button className="btn" onClick={() => window.print()}>Print / Save PDF</button>
        <button className="btn ghost" onClick={onClose}>Close</button>
        <span className="small" style={{ color: '#555' }}>Tip: on iPhone/iPad, tap Print, then the share button to save as a PDF.</span>
      </div>
      {block.days.map(day => (
        <section key={day.id} className="print-page">
          <header className="print-head">
            <img src="/raidergang-logo.png" alt="" className="print-logo" />
            <div>
              <div className="print-title">{block.name} · {WEEKDAY_LONG[day.weekday]} · {day.label}</div>
              <div className="print-sub">
                {athlete ? <b>{athlete}</b> : null}{athlete ? ' · ' : ''}
                {startDate ? weeks.map(w => `Wk ${w}: ${prettyDay(dateFor(startDate, block, w, day.weekday), { month: 'numeric', day: 'numeric' })}`).join('   ') : block.notes}
              </div>
            </div>
          </header>
          {day.notes && <div className="print-note">{day.notes}</div>}

          <table className="print-table">
            <thead>
              <tr>
                <th style={{ width: 34 }}>Slot</th>
                <th>Exercise</th>
                {weeks.map(w => <th key={w} colSpan={2} className="wk">Week {w}</th>)}
              </tr>
              <tr className="sub">
                <th></th><th></th>
                {weeks.map(w => [<th key={`${w}a`}>Sets/Reps</th>, <th key={`${w}b`}>WT</th>])}
              </tr>
            </thead>
            <tbody>
              <tr className="prep">
                <td className="slot">LP</td>
                <td colSpan={1 + weeks.length * 2}>
                  <b>Lifting Prep{day.prep?.name ? ` (${day.prep.name})` : ''}</b>
                  <div className="prep-items">
                    {(day.prep?.items ?? []).map((it, i) => <span key={i}>{it.name}{it.dose ? ` (${it.dose})` : ''}</span>)}
                  </div>
                  {day.focus === 'lower' && day.sprints.some(Boolean) && (
                    <div className="prep-items"><b>Sprints:</b>{weeks.map(w => day.sprints[w - 1] ? <span key={w}>Wk {w} {day.sprints[w - 1]}</span> : null)}</div>
                  )}
                  {day.warmup && <div className="muted-print">{day.warmup}</div>}
                </td>
              </tr>
              {day.exercises.map(e => {
                const maxSets = Math.max(1, ...weeks.map(w => (e.log_type === 'done' ? 1 : prescription(e, w)?.sets ?? 0)));
                return Array.from({ length: maxSets }, (_, i) => (
                  <tr key={`${e.id}-${i}`} className={i === 0 ? 'first' : ''}>
                    {i === 0 && (
                      <>
                        <td className="slot" rowSpan={maxSets}>{e.slot}</td>
                        <td rowSpan={maxSets} className="ex">
                          <b>{exName(e)}</b>
                          {[e.rir, e.cue].filter(Boolean).map((t, k) => <div key={k} className="muted-print">{t}</div>)}
                          {e.rehab && <div className="muted-print"><i>{e.rehab}</i></div>}
                        </td>
                      </>
                    )}
                    {weeks.map(w => {
                      const rx = prescription(e, w);
                      const has = rx && (e.log_type === 'done' ? i === 0 : i < rx.sets);
                      return [
                        <td key={`${w}r`} className="reps">{has ? rx!.reps : ''}{has && i === 0 && rx!.note ? <div className="muted-print">{rx!.note}</div> : null}</td>,
                        <td key={`${w}w`} className={`wt ${has ? '' : 'na'}`}>{has ? logged(e.id, w, i + 1) : ''}</td>,
                      ];
                    })}
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  , document.body);
}
