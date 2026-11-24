import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { exName, rxText, WEEKDAY_SHORT, type BlockDay, type BlockExercise, type LiftBlock, type WeekRx } from '../lib/lifts';
import type { Exercise, Person } from '../lib/types';
import { ErrorMsg } from '../ui/common';
import { PrepEditor } from '../ui/Prep';

type Editing =
  | { kind: 'ex'; dayId: string; ex: BlockExercise | null }
  | { kind: 'day'; dayId: string }
  | { kind: 'prep'; dayId: string }
  | null;

const focusLabel = (d: BlockDay) => d.focus === 'lower' ? 'Lower' : d.focus === 'upper' ? 'Upper' : 'Other';
const nextSlot = (d: BlockDay) => {
  const last = d.exercises[d.exercises.length - 1]?.slot ?? '';
  const m = last.match(/^([A-Z])(\d+)$/);
  return m ? `${m[1]}${Number(m[2]) + 1}` : 'A1';
};

/** One week of a block at a glance: a column per lift day, tap anything to change it. */
export function WeekGrid({ me, block, week, onChanged }: { me: Person; block: LiftBlock; week: number; onChanged: () => Promise<unknown> | void }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [library, setLibrary] = useState<Exercise[]>([]);
  const [copyArmed, setCopyArmed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = me.coach_can_edit;

  useEffect(() => { if (canEdit) api.listExercises().then(setLibrary).catch(() => {}); }, [canEdit]);
  useEffect(() => { setEditing(null); setCopyArmed(false); setMsg(null); }, [block.id, week]);

  const done = async (text?: string) => { setEditing(null); await onChanged(); if (text) setMsg(text); };

  const copyForward = async () => {
    if (!copyArmed) { setCopyArmed(true); return; }
    setCopyArmed(false); setError(null); setMsg(null);
    try {
      let n = 0;
      for (const d of block.days) for (const e of d.exercises) {
        const src = e.weeks[week - 1] ?? null;
        const weeks = Array.from({ length: block.weeks }, (_, i) => (i < week ? e.weeks[i] ?? null : src && { ...src }));
        if (JSON.stringify(weeks) !== JSON.stringify(e.weeks)) { await api.updateBlockExercise(e.id, { weeks }); n++; }
      }
      await done(n ? `Week ${week} copied to weeks ${week + 1}–${block.weeks} (${n} exercises changed).` : 'Later weeks already match.');
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <>
      <ErrorMsg error={error} />
      {msg && <div className="msg info">{msg}</div>}
      <div className="week-grid">
        {block.days.map(d => {
          const sprintLine = d.sprints?.[week - 1];
          return (
            <div key={d.id} className="card grid-day">
              <button className="grid-day-head" disabled={!canEdit} onClick={() => setEditing({ kind: 'day', dayId: d.id })}>
                <span><b>{WEEKDAY_SHORT[d.weekday]}</b> · {d.label}</span>
                <span className="pill-soft">{focusLabel(d)}</span>
              </button>
              <button className="grid-line" disabled={!canEdit} onClick={() => setEditing({ kind: 'prep', dayId: d.id })}>
                <b style={{ color: 'var(--gold)' }}>LP</b>
                <span style={{ flex: 1, minWidth: 0 }}>{d.prep?.name ?? 'Lifting Prep'} <span className="muted">· {(d.prep?.items ?? []).length} items</span></span>
                {canEdit && <span className="muted small">Edit</span>}
              </button>
              {sprintLine && <div className="grid-line small"><b style={{ color: 'var(--green-text)' }}>SPR</b><span>{sprintLine}</span></div>}
              {d.notes && <div className="small muted" style={{ padding: '2px 0 6px' }}>Note: {d.notes}</div>}
              {d.exercises.map(e => {
                const rx = rxText(e, week);
                const on = editing?.kind === 'ex' && editing.ex?.id === e.id;
                return (
                  <button key={e.id} className={`grid-cell ${on ? 'on' : ''} ${rx ? '' : 'off'}`} disabled={!canEdit}
                    onClick={() => setEditing(on ? null : { kind: 'ex', dayId: d.id, ex: e })}>
                    <span className="grid-slot">{e.slot}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 600 }}>{exName(e)}</span>
                      <span className="small muted">{rx || 'Not this week'}</span>
                    </span>
                  </button>
                );
              })}
              {canEdit && <button className="link" style={{ alignSelf: 'flex-start', padding: '8px 0 0' }} onClick={() => setEditing({ kind: 'ex', dayId: d.id, ex: null })}>+ Add exercise</button>}
              {editing && editing.dayId === d.id && (
                <div className="grid-editor">
                  {editing.kind === 'ex' && <ExerciseEditor key={editing.ex?.id ?? 'new'} block={block} day={d} ex={editing.ex} week={week} library={library}
                    onCancel={() => setEditing(null)} onSaved={done} />}
                  {editing.kind === 'day' && <DayEditor block={block} day={d} week={week} onCancel={() => setEditing(null)} onSaved={done} />}
                  {editing.kind === 'prep' && <PrepEditor key={d.id} block={block} day={d} onCancel={() => setEditing(null)} onSaved={() => done('Lifting Prep saved.')} />}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {canEdit && week < block.weeks && (
        <button className="btn ghost" onClick={copyForward}>
          {copyArmed ? `Tap again: overwrite weeks ${week + 1}–${block.weeks} with week ${week}` : `Copy week ${week} to weeks ${week + 1}–${block.weeks}`}
        </button>
      )}
    </>
  );
}

function ExerciseEditor({ block, day, ex, week, library, onCancel, onSaved }: {
  block: LiftBlock; day: BlockDay; ex: BlockExercise | null; week: number; library: Exercise[];
  onCancel: () => void; onSaved: (msg?: string) => void;
}) {
  const cur: WeekRx | null = ex?.weeks[week - 1] ?? null;
  const [slot, setSlot] = useState(ex?.slot ?? nextSlot(day));
  const [name, setName] = useState(ex ? exName(ex) : '');
  const [sets, setSets] = useState(String(cur?.sets ?? (ex ? '' : 2)));
  const [reps, setReps] = useState(cur?.reps ?? '');
  const [note, setNote] = useState(cur?.note ?? '');
  const [later, setLater] = useState(true);
  const [rir, setRir] = useState(ex?.rir ?? '');
  const [cue, setCue] = useState(ex?.cue ?? '');
  const [rehab, setRehab] = useState(ex?.rehab ?? '');
  const [logType, setLogType] = useState<BlockExercise['log_type']>(ex?.log_type ?? 'weight');
  const [busy, setBusy] = useState(false);
  const [removeArmed, setRemoveArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byName = useMemo(() => new Map(library.map(l => [l.name.toLowerCase(), l])), [library]);
  const match = byName.get(name.trim().toLowerCase());
  const n = parseInt(sets, 10);
  const valid = slot.trim() && name.trim() && (sets.trim() === '' || (!isNaN(n) && n >= 0 && n <= 20));

  const save = async () => {
    setBusy(true); setError(null);
    const rx: WeekRx | null = !isNaN(n) && n > 0 ? { sets: n, reps: reps.trim() || '–', ...(note.trim() ? { note: note.trim() } : {}) } : null;
    const base = ex?.weeks ?? [];
    const weeks = Array.from({ length: block.weeks }, (_, i) =>
      i === week - 1 || (later && i > week - 1) ? (rx && { ...rx }) : (base[i] ?? null));
    const fields = {
      slot: slot.trim().toUpperCase(), exercise_id: match?.id ?? null, custom_name: match ? null : name.trim(),
      rir: rir.trim() || null, cue: cue.trim() || null, rehab: rehab.trim() || null, log_type: logType, weeks,
    };
    try {
      if (ex) await api.updateBlockExercise(ex.id, fields);
      else await api.addBlockExercise({ block_day_id: day.id, sort_order: (day.exercises.at(-1)?.sort_order ?? 0) + 1, ...fields });
      onSaved(`${fields.slot} ${name.trim()} saved${later && week < block.weeks ? ` for weeks ${week}–${block.weeks}` : ` for week ${week}`}.`);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  const remove = async () => {
    if (!ex) return;
    if (!removeArmed) { setRemoveArmed(true); return; }
    setBusy(true); setError(null);
    try { await api.removeBlockExercise(ex.id); onSaved(`${ex.slot} ${exName(ex)} removed.`); }
    catch (e) { setError((e as Error).message); setRemoveArmed(false); }
    setBusy(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <b>{ex ? `Edit ${ex.slot}` : 'Add exercise'}</b>
      <div style={{ display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr)', gap: 8 }}>
        <label className="field">Slot<input className="input" value={slot} onChange={e => setSlot(e.target.value)} /></label>
        <label className="field">Exercise
          <input className="input" list="library-names" value={name} onChange={e => setName(e.target.value)} placeholder="Start typing…" />
        </label>
      </div>
      <datalist id="library-names">{library.map(l => <option key={l.id} value={l.name} />)}</datalist>
      {name.trim() && <span className="small" style={{ color: match ? 'var(--green-text)' : 'var(--muted)' }}>{match ? (match.video_url ? 'From the Library, with video' : 'From the Library (no video yet)') : 'Not in the Library: saved as a custom name with no video'}</span>}
      <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr', gap: 8 }}>
        <label className="field">Sets<input className="input" inputMode="numeric" value={sets} onChange={e => setSets(e.target.value)} /></label>
        <label className="field">Reps<input className="input" value={reps} onChange={e => setReps(e.target.value)} placeholder="8, 6 ea, 30 sec" /></label>
        <label className="field">RIR<input className="input" value={rir} onChange={e => setRir(e.target.value)} placeholder="2" /></label>
      </div>
      <label className="field">Note for this week (optional)<input className="input" value={note} onChange={e => setNote(e.target.value)} /></label>
      <div className="chips">
        <button className={`toggle ${!later ? 'on' : ''}`} style={{ height: 32 }} onClick={() => setLater(false)}>Week {week} only</button>
        {week < block.weeks && <button className={`toggle ${later ? 'on' : ''}`} style={{ height: 32 }} onClick={() => setLater(true)}>Weeks {week}–{block.weeks}</button>}
      </div>
      <label className="field">Cue (optional)<input className="input" value={cue} onChange={e => setCue(e.target.value)} /></label>
      <label className="field">Rehab option (optional)<input className="input" value={rehab} onChange={e => setRehab(e.target.value)} /></label>
      <label className="field">Athletes log
        <select className="input" value={logType} onChange={e => setLogType(e.target.value as BlockExercise['log_type'])}>
          <option value="weight">Weight per set</option>
          <option value="done">Done / not done</option>
          <option value="result">A result (inches, reps…)</option>
        </select>
      </label>
      <span className="small muted">Set Sets to 0 to skip it that week.</span>
      <ErrorMsg error={error} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" disabled={!valid || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        {ex && <button className="btn ghost" style={{ marginLeft: 'auto', color: 'var(--red)' }} disabled={busy} onClick={remove}>{removeArmed ? 'Tap again to remove' : 'Remove'}</button>}
      </div>
    </div>
  );
}

function DayEditor({ block, day, week, onCancel, onSaved }: {
  block: LiftBlock; day: BlockDay; week: number; onCancel: () => void; onSaved: (msg?: string) => void;
}) {
  const [label, setLabel] = useState(day.label);
  const [focus, setFocus] = useState(day.focus);
  const [notes, setNotes] = useState(day.notes ?? '');
  const [warmup, setWarmup] = useState(day.warmup ?? '');
  const [sprint, setSprint] = useState(day.sprints?.[week - 1] ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    const sprints = Array.from({ length: block.weeks }, (_, i) => (i === week - 1 ? sprint.trim() : day.sprints?.[i] ?? ''));
    try {
      await api.updateBlockDay(day.id, { label: label.trim() || day.label, focus, notes: notes.trim() || null, warmup: warmup.trim() || null, sprints });
      onSaved(`${WEEKDAY_SHORT[day.weekday]} saved.`);
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <b>{WEEKDAY_SHORT[day.weekday]} · day settings</b>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 110px', gap: 8 }}>
        <label className="field">Name<input className="input" value={label} onChange={e => setLabel(e.target.value)} /></label>
        <label className="field">Focus
          <select className="input" value={focus} onChange={e => setFocus(e.target.value as BlockDay['focus'])}>
            <option value="lower">Lower</option><option value="upper">Upper</option><option value="other">Other</option>
          </select>
        </label>
      </div>
      <label className="field">Coach note athletes see at the top<textarea className="input" rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></label>
      <label className="field">Warm-up line before A1<input className="input" value={warmup} onChange={e => setWarmup(e.target.value)} /></label>
      <label className="field">Sprints, week {week} (e.g. "10/10: 1 x 90%, 2 x 95%")<input className="input" value={sprint} onChange={e => setSprint(e.target.value)} /></label>
      <ErrorMsg error={error} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" onClick={save}>Save</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
