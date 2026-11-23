import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { addDays, isoDay, prettyDay } from '../lib/dates';
import {
  dateFor, exName, exVideo, isoWeekday, prescription, rxText, scheduleFor, WEEKDAY_SHORT,
  type Assignment, type BlockDay, type BlockExercise, type LiftBlock, type RehabSwitch, type Scheduled, type SetLog,
} from '../lib/lifts';
import type { Person } from '../lib/types';
import { ErrorMsg } from '../ui/common';

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
      {!day ? (
        <div className="card"><h2>Rest day</h2><div className="small muted">No lift scheduled today. Tap a day above to look ahead.</div></div>
      ) : (
        <>
          <PrepCard day={day} week={week} />
          <MeatshackCard me={me} day={day} week={week} date={dayDate} data={data} onLogged={l => setData(d => d && { ...d, logs: [l, ...d.logs] })} />
        </>
      )}
    </>
  );
}

function PrepCard({ day, week }: { day: BlockDay; week: number }) {
  const sprint = day.focus === 'lower' ? day.sprints[week - 1] : '';
  if (!day.prep && !sprint && !day.warmup) return null;
  return (
    <div className="card" style={{ gap: 8 }}>
      <div className="row"><h2>Lift Prep</h2>{day.prep && <span className="small muted">{day.prep.name}</span>}</div>
      {day.prep?.items.map((it, i) => (
        <div key={i} className="row small" style={{ borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
          <span style={{ fontWeight: it.video_url ? 600 : 400, color: it.video_url ? 'var(--text)' : 'var(--muted)' }}>{it.name}</span>
          {it.video_url && <a href={it.video_url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, flexShrink: 0 }}>Video ↗</a>}
        </div>
      ))}
      {sprint && (
        <div className="msg info" style={{ display: 'flex', gap: 8 }}><b>Sprints</b><span>{sprint}</span></div>
      )}
      {day.warmup && <div className="small muted">{day.warmup}</div>}
    </div>
  );
}

function MeatshackCard({ me, day, week, date, data, onLogged }: {
  me: Person; day: BlockDay; week: number; date: string; data: Loaded; onLogged: (l: SetLog) => void;
}) {
  const [open, setOpen] = useState<string | null>(day.exercises[0]?.id ?? null);
  useEffect(() => { setOpen(day.exercises[0]?.id ?? null); }, [day.id]);
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
  const doneCount = e.log_type === 'done' ? (bySet.get(1)?.done ? sets : 0) : [...bySet.values()].filter(l => l.weight != null || l.result).length;
  const complete = sets > 0 && doneCount >= sets;

  // "Last time": most recent earlier date with values for this exercise
  const lastDate = history.find(l => l.weight != null || l.result)?.log_date;
  const last = lastDate ? history.filter(l => l.log_date === lastDate).sort((a, b) => a.set_number - b.set_number) : [];
  const lastText = last.map(l => l.weight ?? l.result).filter(v => v != null && v !== '').join(', ');

  const save = async (set: number, patch: Partial<SetLog>) => {
    const row = await api.logSet({
      person_id: me.id, block_exercise_id: e.id, log_date: date, week, set_number: set,
      weight: null, result: null, done: false, used_rehab: rehabOn,
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
          {e.log_type === 'done' ? (
            <button className={`btn ${bySet.get(1)?.done ? 'ghost' : ''}`} disabled={!loggable}
              onClick={() => save(1, { done: !bySet.get(1)?.done })}>{bySet.get(1)?.done ? '✓ Done (tap to undo)' : `Mark done · ${rx.reps}`}</button>
          ) : (
            Array.from({ length: sets }, (_, i) => i + 1).map(n => (
              <SetInput key={`${e.id}-${date}-${n}`} n={n} reps={rx.reps} type={e.log_type} label={e.result_label}
                saved={bySet.get(n)} disabled={!loggable}
                onSave={v => save(n, e.log_type === 'weight' ? { weight: v === '' ? null : Number(v) } : { result: v || null })} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SetInput({ n, reps, type, label, saved, disabled, onSave }: {
  n: number; reps: string; type: 'weight' | 'result' | 'done'; label: string | null; saved?: SetLog; disabled: boolean;
  onSave: (v: string) => Promise<void>;
}) {
  const savedVal = type === 'weight' ? (saved?.weight != null ? String(saved.weight) : '') : (saved?.result ?? '');
  const [v, setV] = useState(savedVal);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>(savedVal ? 'saved' : 'idle');
  useEffect(() => { setV(savedVal); }, [savedVal]);
  const valid = type === 'weight' ? v === '' || (/^\d+(\.\d)?$/.test(v) && Number(v) <= 2000) : v.length <= 40;
  const commit = async () => {
    if (v === savedVal || !valid) return;
    setState('saving');
    try { await onSave(v.trim()); setState('saved'); } catch { setState('error'); }
  };
  return (
    <label className="row" style={{ gap: 10 }}>
      <span className="small" style={{ width: 110, color: 'var(--muted)' }}>Set {n} · {reps}</span>
      <input className="input" style={{ flex: 1, height: 42, borderColor: valid ? undefined : 'var(--red)' }}
        inputMode={type === 'weight' ? 'decimal' : 'text'} placeholder={type === 'weight' ? 'Weight (lb)' : (label ?? 'Result')}
        value={v} disabled={disabled} onChange={ev => { setV(ev.target.value); setState('idle'); }}
        onBlur={commit} onKeyDown={ev => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }} />
      <span className="small" style={{ width: 18, color: state === 'error' ? 'var(--red)' : '#5DAE3F' }}>
        {state === 'saving' ? '…' : state === 'saved' ? '✓' : state === 'error' ? '!' : ''}
      </span>
    </label>
  );
}
