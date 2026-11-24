import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { addDays, isoDay, prettyDay } from '../lib/dates';
import {
  ALT_OPTIONS, amountMode, dateFor, exName, exVideo, isoWeekday, prescription, rxText, scheduleFor, setHasValue, setText, WEEKDAY_SHORT,
  type AltOption, type Assignment, type BlockDay, type BlockExercise, type LiftBlock, type RehabSwitch, type Scheduled, type SetLog,
} from '../lib/lifts';
import type { Person } from '../lib/types';
import { ErrorMsg } from '../ui/common';
import { PrepList } from '../ui/Prep';
import { PrintBlock } from '../ui/PrintBlock';
import { fullName } from '../lib/types';

interface Loaded {
  blocks: LiftBlock[];
  assignments: Assignment[];
  rehab: RehabSwitch[];
  logs: SetLog[];          // last ~60 days, newest value per set
}

const canLogOn = (date: string) => date >= addDays(isoDay(), -3) && date <= addDays(isoDay(), 1);

/** The lift part of the athlete's Today screen: Lift Prep, sprints, and The Meatshack. */
export function LiftToday({ me }: { me: Person }) {
  const today = isoDay();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);   // block_day id the athlete tapped
  const [printing, setPrinting] = useState(false);

  const load = () => Promise.all([
    api.listBlocks(), api.assignmentsFor(me.id), api.rehabSwitches(me.id),
    api.setLogs({ personId: me.id, from: addDays(today, -60), to: addDays(today, 1) }),
  ]).then(([blocks, assignments, rehab, logs]) => setData({ blocks, assignments, rehab, logs }))
    .catch(e => setError(e.message));
  useEffect(() => { load(); }, [me.id]);

  const sched: Scheduled | null = useMemo(() => data ? scheduleFor(today, data.assignments, data.blocks) : null, [data, today]);

  if (error) return <ErrorMsg error={error} />;
  if (!data) return null;
  if (!sched) {
    return <div className="card"><h2>The Meatshack</h2><div className="small muted">No lift block assigned for this week yet.</div></div>;
  }

  const { block, week, assignment } = sched;
  const day = (picked && block.days.find(d => d.id === picked)) || sched.day;
  const dayDate = day ? dateFor(assignment.start_date, block, week, day.weekday) : today;

  return (
    <>
      <div className="chips" style={{ alignItems: 'center' }}>
        <span className="small muted" style={{ marginRight: 4 }}>{block.name} · Week {week}</span>
        <button className="toggle" style={{ height: 30, marginLeft: 'auto' }} onClick={() => setPrinting(true)}>Print / PDF</button>
        {block.days.map(d => {
          const dt = dateFor(assignment.start_date, block, week, d.weekday);
          const on = day?.id === d.id;
          return (
            <button key={d.id} className={`toggle ${on ? 'on' : ''}`} style={{ height: 30 }} onClick={() => setPicked(d.id)}>
              {WEEKDAY_SHORT[isoWeekday(dt)]}{dt === today ? ' · today' : ''}
            </button>
          );
        })}
      </div>
      {printing && <PrintBlock block={block} athlete={fullName(me)} startDate={assignment.start_date}
        logs={data.logs.filter(l => block.days.some(d => d.exercises.some(e => e.id === l.block_exercise_id)))} onClose={() => setPrinting(false)} />}
      {!day ? (
        <div className="card"><h2>Rest day</h2><div className="small muted">No lift scheduled today. Tap a day above to look ahead.</div></div>
      ) : (
        <>
          <MeatshackCard me={me} day={day} week={week} date={dayDate} data={data} onLogged={l => setData(d => d && { ...d, logs: [l, ...d.logs] })} />
        </>
      )}
    </>
  );
}

function MeatshackCard({ me, day, week, date, data, onLogged }: {
  me: Person; day: BlockDay; week: number; date: string; data: Loaded; onLogged: (l: SetLog) => void;
}) {
  const [open, setOpen] = useState<string | null>('prep');
  useEffect(() => { setOpen('prep'); }, [day.id]);
  const todays = data.logs.filter(l => l.log_date === date);
  const loggable = canLogOn(date);

  return (
    <div className="card" style={{ gap: 0 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <h2>The Meatshack</h2>
        <span className="small muted">{day.label} · {prettyDay(date)}</span>
      </div>
      {day.notes && <div className="msg info" style={{ marginBottom: 8 }}>{day.notes}</div>}
      {!loggable && <div className="small muted" style={{ marginBottom: 8 }}>Logging opens on {prettyDay(date)}.</div>}
      <div style={{ borderTop: '1px solid var(--line)' }}>
        <button onClick={() => setOpen(o => (o === 'prep' ? null : 'prep'))} style={{ width: '100%', background: 'none', border: 'none', color: 'var(--text)', padding: '12px 0', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
          <span style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontWeight: 700, color: 'var(--gold)', width: 26 }}>LP</span>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>Lifting Prep</span>
            <span className="small muted">{[day.prep?.name, day.focus === 'lower' && day.sprints[week - 1] ? 'Sprints' : null].filter(Boolean).join(' · ') || 'Before A1'}</span>
          </span>
          <span className="muted">{open === 'prep' ? '▾' : '▸'}</span>
        </button>
        {open === 'prep' && <div style={{ paddingBottom: 14 }}><PrepList day={day} week={week} /></div>}
      </div>
      {day.exercises.map(e => (
        <ExerciseRow key={e.id} me={me} e={e} week={week} date={date} loggable={loggable}
          open={open === e.id} onToggle={() => setOpen(o => (o === e.id ? null : e.id))}
          logs={todays.filter(l => l.block_exercise_id === e.id)}
          history={data.logs.filter(l => l.log_date < date && (l.block_exercise_id === e.id || l.exercise_name === exName(e)))}
          rehabOn={data.rehab.some(r => r.block_exercise_id === e.id)}
          onLogged={onLogged} />
      ))}
    </div>
  );
}

function ExerciseRow({ me, e, week, date, loggable, open, onToggle, logs, history, rehabOn, onLogged }: {
  me: Person; e: BlockExercise; week: number; date: string; loggable: boolean; open: boolean; onToggle: () => void;
  logs: SetLog[]; history: SetLog[]; rehabOn: boolean; onLogged: (l: SetLog) => void;
}) {
  const rx = prescription(e, week);
  const sets = rx?.sets ?? 0;
  const bySet = new Map(logs.map(l => [l.set_number, l]));
  const mode = amountMode(rx?.reps);
  const perSet = e.log_type !== 'done' || mode != null;
  const doneCount = !perSet ? (bySet.get(1)?.done ? sets : 0) : [...bySet.values()].filter(setHasValue).length;
  const complete = sets > 0 && doneCount >= sets;

  // "Last time": most recent earlier date with values for this exercise
  const lastDate = history.find(setHasValue)?.log_date;
  const last = lastDate ? history.filter(l => l.log_date === lastDate).sort((a, b) => a.set_number - b.set_number) : [];
  const lastText = last.map(setText).filter(Boolean).join(', ');

  /** Each save is a new record; carry the set's other values forward so nothing gets wiped. */
  const save = async (set: number, patch: Partial<SetLog>) => {
    const cur = bySet.get(set);
    const row = await api.logSet({
      person_id: me.id, block_exercise_id: e.id, log_date: date, week, set_number: set,
      weight: cur?.weight ?? null, result: cur?.result ?? null, done: cur?.done ?? false, used_rehab: rehabOn,
      alt: cur?.alt ?? null, reps_done: cur?.reps_done ?? null, seconds_done: cur?.seconds_done ?? null,
      exercise_name: exName(e), prescribed: rxText(e, week) || null, ...patch,
    } as Omit<SetLog, 'id' | 'created_at'>);
    onLogged(row);
  };

  if (!rx) return null;
  return (
    <div style={{ borderTop: '1px solid var(--line)' }}>
      <button onClick={onToggle} style={{ width: '100%', background: 'none', border: 'none', color: 'var(--text)', padding: '12px 0', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
        <span style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontWeight: 700, color: 'var(--gold)', width: 26 }}>{e.slot}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>{exName(e)}</span>
          <span className="small muted">{rxText(e, week)}{rehabOn ? ' · REHAB' : ''}</span>
        </span>
        <span className="chip" style={complete ? { background: '#14241A', color: '#A9DDB5' } : undefined}>{complete ? 'Done' : `${doneCount}/${sets}`}</span>
        <span className="muted">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 14 }}>
          {rehabOn && e.rehab && <div className="msg info"><b>Coach switched you to the rehab option:</b> {e.rehab.replace(/^Rehab\s*=\s*/i, '')}</div>}
          {exVideo(e) && <a href={exVideo(e)!} target="_blank" rel="noreferrer" className="small" style={{ fontWeight: 600 }}>Watch video ↗</a>}
          {e.cue && <div className="small muted">{e.cue}</div>}
          {rx.note && <div className="small" style={{ color: 'var(--gold)' }}>{rx.note}</div>}
          {!rehabOn && e.rehab && <div className="small muted">Option: {e.rehab}</div>}
          {lastText && <div className="small">Last time ({prettyDay(lastDate!, { month: 'short', day: 'numeric' })}): <b>{lastText}</b></div>}
          {!perSet ? (
            <button className={`btn ${bySet.get(1)?.done ? 'ghost' : ''}`} disabled={!loggable}
              onClick={() => save(1, { done: !bySet.get(1)?.done })}>{bySet.get(1)?.done ? '✓ Done (tap to undo)' : `Mark done · ${rx.reps}`}</button>
          ) : (
            Array.from({ length: sets }, (_, i) => i + 1).map(n => (
              <SetRow key={`${e.id}-${date}-${n}`} n={n} reps={rx.reps} type={e.log_type} label={e.result_label} mode={mode}
                saved={bySet.get(n)} disabled={!loggable} onSave={patch => save(n, patch)} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

const sameVal = (a: string, b: string) => a.trim() === b.trim();

/**
 * One set: weight (or result), an "Alternative" dropdown that swaps the weight for a band or
 * bodyweight on just this set, and a reps / seconds box when the prescription is AMRAP / ALAP.
 */
function SetRow({ n, reps, type, label, mode, saved, disabled, onSave }: {
  n: number; reps: string; type: 'weight' | 'result' | 'done'; label: string | null; mode: 'reps' | 'seconds' | null;
  saved?: SetLog; disabled: boolean; onSave: (patch: Partial<SetLog>) => Promise<void>;
}) {
  const savedMain = type === 'weight' ? (saved?.weight != null ? String(saved.weight) : '') : (saved?.result ?? '');
  const savedAmt = mode === 'reps' ? (saved?.reps_done != null ? String(saved.reps_done) : '') : mode === 'seconds' ? (saved?.seconds_done != null ? String(saved.seconds_done) : '') : '';
  const alt = saved?.alt ?? '';
  const [main, setMain] = useState(savedMain);
  const [amt, setAmt] = useState(savedAmt);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>(saved && setHasValue(saved) ? 'saved' : 'idle');
  useEffect(() => { setMain(savedMain); }, [savedMain]);
  useEffect(() => { setAmt(savedAmt); }, [savedAmt]);

  const mainOk = type === 'weight' ? main === '' || (/^\d+(\.\d)?$/.test(main) && Number(main) <= 2000) : main.length <= 40;
  const amtOk = amt === '' || (/^\d+$/.test(amt) && Number(amt) <= (mode === 'seconds' ? 3600 : 500));

  const run = async (patch: Partial<SetLog>) => {
    setState('saving');
    try { await onSave(patch); setState('saved'); } catch { setState('error'); }
  };
  const commitMain = () => {
    if (!mainOk || sameVal(main, savedMain)) return;
    run(type === 'weight' ? { weight: main === '' ? null : Number(main), alt: null } : { result: main.trim() || null });
  };
  const commitAmt = () => {
    if (!amtOk || sameVal(amt, savedAmt)) return;
    const v = amt === '' ? null : Number(amt);
    run(mode === 'reps' ? { reps_done: v } : { seconds_done: v });
  };
  const pickAlt = (v: string) => run(v ? { alt: v as AltOption, weight: null } : { alt: null });

  return (
    <div className="set-row">
      <span className="set-label">Set {n}<span className="muted"> · {reps}</span></span>
      <div className="set-inputs">
        {type === 'weight' && !alt && (
          <input className="input" aria-label={`Set ${n} weight`} style={{ flex: '1 1 90px', borderColor: mainOk ? undefined : 'var(--red)' }}
            inputMode="decimal" placeholder="Weight (lb)" value={main} disabled={disabled}
            onChange={ev => { setMain(ev.target.value); setState('idle'); }} onBlur={commitMain}
            onKeyDown={ev => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }} />
        )}
        {type === 'result' && (
          <input className="input" aria-label={`Set ${n} ${label ?? 'result'}`} style={{ flex: '1 1 90px' }} placeholder={label ?? 'Result'}
            value={main} disabled={disabled} onChange={ev => { setMain(ev.target.value); setState('idle'); }} onBlur={commitMain}
            onKeyDown={ev => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }} />
        )}
        {type === 'weight' && (
          <select className={`input alt-select ${alt ? 'on' : ''}`} aria-label={`Set ${n} alternative`} value={alt} disabled={disabled}
            onChange={ev => pickAlt(ev.target.value)} style={{ flex: alt ? '1 1 150px' : '0 0 128px' }}>
            <option value="">{alt ? 'Back to weight' : 'Alternative'}</option>
            {ALT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        {mode && (
          <input className="input" aria-label={`Set ${n} ${mode === 'reps' ? 'reps done' : 'seconds held'}`} style={{ flex: '0 0 92px', borderColor: amtOk ? undefined : 'var(--red)' }}
            inputMode="numeric" placeholder={mode === 'reps' ? 'Reps' : 'Seconds'} value={amt} disabled={disabled}
            onChange={ev => { setAmt(ev.target.value); setState('idle'); }} onBlur={commitAmt}
            onKeyDown={ev => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }} />
        )}
        <span className="set-state" style={{ color: state === 'error' ? 'var(--red)' : 'var(--green-text)' }} aria-live="polite">
          {state === 'saving' ? '…' : state === 'saved' ? '✓' : state === 'error' ? '!' : ''}
        </span>
      </div>
    </div>
  );
}
