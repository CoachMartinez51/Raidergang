import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { exName, groupBlocks, pairing, WEEKDAY_SHORT, type BlockDay, type BlockExercise, type LiftBlock, type WeekRx } from '../lib/lifts';
import type { Exercise, Person } from '../lib/types';
import { ErrorMsg } from '../ui/common';
import { PrepEditor } from '../ui/Prep';
import { DayEditor, ExerciseEditor } from './BlockEditor';

const focusLabel = (d: BlockDay) => d.focus === 'lower' ? 'Lower' : d.focus === 'upper' ? 'Upper' : 'Other';
const sameRx = (a: WeekRx | null | undefined, b: WeekRx | null | undefined) =>
  (a?.sets ?? 0) === (b?.sets ?? 0) && (a?.reps ?? '') === (b?.reps ?? '') && (a?.note ?? '') === (b?.note ?? '');

interface Draft { key: string; slot: string }

/**
 * Plan one lift day by block: Lifting Prep, then A, B, C… blocks, each row editable in place.
 * A sets/reps change carries into later weeks that still matched the old value,
 * so weeks you already progressed are left alone.
 */
export function BlockPlanner({ me, block, week, onChanged }: { me: Person; block: LiftBlock; week: number; onChanged: () => Promise<unknown> | void }) {
  const [dayId, setDayId] = useState(block.days[0]?.id ?? '');
  const [library, setLibrary] = useState<Exercise[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [panel, setPanel] = useState<'prep' | 'day' | { ex: string } | null>(null);
  const [copyArmed, setCopyArmed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = me.coach_can_edit;
  const day = block.days.find(d => d.id === dayId) ?? block.days[0];

  useEffect(() => { api.listExercises().then(setLibrary).catch(() => {}); }, []);
  useEffect(() => { setDrafts([]); setPanel(null); setCopyArmed(false); setMsg(null); }, [dayId, week, block.id]);
  useEffect(() => { if (!block.days.some(d => d.id === dayId)) setDayId(block.days[0]?.id ?? ''); }, [block, dayId]);

  const byName = useMemo(() => new Map(library.map(l => [l.name.toLowerCase(), l])), [library]);
  if (!day) return <div className="small muted">This block has no lift days yet.</div>;

  const blocks = groupBlocks<BlockExercise | (Draft & { draft: true })>([
    ...day.exercises,
    ...drafts.map(d => ({ ...d, draft: true as const })),
  ].sort((a, b) => a.slot.localeCompare(b.slot, undefined, { numeric: true })));

  const reload = async (text?: string) => { await onChanged(); if (text) setMsg(text); };

  const addTo = (letter: string) => {
    const n = blocks.find(b => b.letter === letter)?.items.length ?? 0;
    setDrafts(ds => [...ds, { key: crypto.randomUUID(), slot: `${letter}${n + 1}` }]);
  };
  const nextLetter = String.fromCharCode(Math.max(64, ...blocks.map(b => b.letter.charCodeAt(0))) + 1);

  const copyForward = async () => {
    if (!copyArmed) { setCopyArmed(true); return; }
    setCopyArmed(false); setError(null);
    try {
      let n = 0;
      for (const d of block.days) for (const e of d.exercises) {
        const src = e.weeks[week - 1] ?? null;
        const weeks = Array.from({ length: block.weeks }, (_, i) => (i < week ? e.weeks[i] ?? null : src && { ...src }));
        if (JSON.stringify(weeks) !== JSON.stringify(e.weeks)) { await api.updateBlockExercise(e.id, { weeks }); n++; }
      }
      await reload(n ? `Week ${week} copied to weeks ${week + 1}–${block.weeks} for every day (${n} exercises).` : 'Later weeks already match.');
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="planner">
      <datalist id="planner-library">{library.map(l => <option key={l.id} value={l.name} />)}</datalist>
      <div className="chips">
        {block.days.map(d => (
          <button key={d.id} className={`toggle ${d.id === day.id ? 'on' : ''}`} onClick={() => setDayId(d.id)}>
            {WEEKDAY_SHORT[d.weekday]} · {focusLabel(d)}
          </button>
        ))}
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="small muted">Editing <b style={{ color: 'var(--text)' }}>{WEEKDAY_SHORT[day.weekday]} · {day.label}, week {week}</b>. Sets/reps changes carry into later weeks that matched; use ⋯ for "this week only".</span>
        {canEdit && <button className="btn ghost small" onClick={() => setPanel(p => p === 'day' ? null : 'day')}>Day settings</button>}
      </div>
      <ErrorMsg error={error} />
      {msg && <div className="msg info">{msg}</div>}
      {panel === 'day' && <div className="grid-editor"><DayEditor block={block} day={day} week={week} onCancel={() => setPanel(null)} onSaved={async t => { setPanel(null); await reload(t); }} /></div>}

      {/* Lifting Prep */}
      <section className="plan-block">
        <div className="plan-block-head">
          <h3>LP · Lifting Prep</h3>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="pill-soft">{day.prep?.name ?? 'Lifting Prep'}</span>
            {canEdit && <button className="btn ghost small" onClick={() => setPanel(p => p === 'prep' ? null : 'prep')}>{panel === 'prep' ? 'Close' : 'Edit prep'}</button>}
          </span>
        </div>
        {panel === 'prep'
          ? <PrepEditor key={day.id} block={block} day={day} onCancel={() => setPanel(null)} onSaved={async () => { setPanel(null); await reload('Lifting Prep saved.'); }} />
          : (day.prep?.items ?? []).map((it, i) => (
            <div key={i} className="plan-prep-row"><span>{it.name}</span><span className="muted">{it.dose || 'Add sets/reps'}</span></div>
          ))}
        {day.sprints?.[week - 1] && <div className="plan-prep-row"><span><b style={{ color: 'var(--green-text)' }}>Sprints</b> · {day.sprints[week - 1]}</span></div>}
      </section>

      {blocks.map(b => (
        <section key={b.letter} className="plan-block">
          <div className="plan-block-head">
            <h3>{b.letter} block</h3>
            <span className="pill-soft">{pairing(b.items.length)}</span>
          </div>
          <div className="plan-row plan-row-labels" aria-hidden="true">
            <span /><span>Exercise (from your Library)</span><span>Sets</span><span>Reps</span><span>RIR</span><span>Cue / note</span><span />
          </div>
          {b.items.map(it => 'draft' in it
            ? <PlanRow key={it.key} block={block} day={day} week={week} slot={it.slot} ex={null} byName={byName} canEdit={canEdit}
                onSaved={async t => { setDrafts(ds => ds.filter(d => d.key !== it.key)); await reload(t); }} onDiscard={() => setDrafts(ds => ds.filter(d => d.key !== it.key))} />
            : (
              <div key={it.id}>
                <PlanRow block={block} day={day} week={week} slot={it.slot} ex={it} byName={byName} canEdit={canEdit}
                  onSaved={reload} onMore={() => setPanel(p => (typeof p === 'object' && p?.ex === it.id ? null : { ex: it.id }))} />
                {typeof panel === 'object' && panel?.ex === it.id && (
                  <div className="grid-editor">
                    <ExerciseEditor block={block} day={day} ex={it} week={week} library={library}
                      onCancel={() => setPanel(null)} onSaved={async t => { setPanel(null); await reload(t); }} />
                  </div>
                )}
              </div>
            ))}
          {canEdit && <button className="link" style={{ alignSelf: 'flex-start', padding: '6px 0' }} onClick={() => addTo(b.letter)}>+ Add to {b.letter}</button>}
        </section>
      ))}

      {canEdit && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn ghost" onClick={() => setDrafts(ds => [...ds, { key: crypto.randomUUID(), slot: `${nextLetter}1` }])}>+ Add {nextLetter} block</button>
          {week < block.weeks && (
            <button className="btn ghost" style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }} onClick={copyForward}>
              {copyArmed ? `Tap again: overwrite weeks ${week + 1}–${block.weeks}` : `Copy week ${week} to weeks ${week + 1}–${block.weeks}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PlanRow({ block, day, week, slot, ex, byName, canEdit, onSaved, onMore, onDiscard }: {
  block: LiftBlock; day: BlockDay; week: number; slot: string; ex: BlockExercise | null;
  byName: Map<string, Exercise>; canEdit: boolean;
  onSaved: (msg?: string) => Promise<void> | void; onMore?: () => void; onDiscard?: () => void;
}) {
  const cur = ex?.weeks[week - 1] ?? null;
  const init = { name: ex ? exName(ex) : '', sets: cur?.sets ? String(cur.sets) : '', reps: cur?.reps ?? '', rir: ex?.rir ?? '', cue: ex?.cue ?? '' };
  const [f, setF] = useState(init);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const initKey = JSON.stringify(init);
  useEffect(() => { setF(JSON.parse(initKey)); }, [initKey]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => { setF(v => ({ ...v, [k]: e.target.value })); setState('idle'); };

  const commit = async () => {
    if (JSON.stringify(f) === initKey) return;
    if (!f.name.trim()) { if (ex) setF(init); return; }
    const n = parseInt(f.sets, 10);
    if (f.sets.trim() && (isNaN(n) || n < 0 || n > 20)) { setErr('Sets must be 0–20'); setState('error'); return; }
    setErr(null); setState('saving');
    const match = byName.get(f.name.trim().toLowerCase());
    const rx: WeekRx | null = !isNaN(n) && n > 0 ? { sets: n, reps: f.reps.trim() || '–', ...(cur?.note ? { note: cur.note } : {}) } : null;
    const base = ex?.weeks ?? [];
    // this week, plus later weeks that still matched this week's old prescription
    const weeks = Array.from({ length: block.weeks }, (_, i) => {
      if (i === week - 1) return rx && { ...rx };
      if (i > week - 1 && (!ex || sameRx(base[i], cur))) return rx && { ...rx };
      return base[i] ?? null;
    });
    const fields = {
      slot, exercise_id: match?.id ?? null, custom_name: match ? null : f.name.trim(),
      rir: f.rir.trim() || null, cue: f.cue.trim() || null, weeks,
    };
    try {
      if (ex) {
        await api.updateBlockExercise(ex.id, fields);
      } else {
        // slot it in after the rest of its block, shifting later exercises down
        const sorted = [...day.exercises].sort((a, b) => a.sort_order - b.sort_order);
        const before = sorted.filter(e => e.slot.localeCompare(slot, undefined, { numeric: true }) < 0);
        const order = (before.at(-1)?.sort_order ?? -1) + 1;
        for (const e of sorted.filter(e => e.sort_order >= order)) await api.updateBlockExercise(e.id, { sort_order: e.sort_order + 1 });
        await api.addBlockExercise({ block_day_id: day.id, sort_order: order, rehab: null, log_type: 'weight', ...fields });
      }
      setState('saved');
      await onSaved();
    } catch (e) { setErr((e as Error).message); setState('error'); }
  };

  const inputProps = (k: keyof typeof f, label: string, extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => ({
    className: 'input', 'aria-label': `${slot} ${label}`, value: f[k], disabled: !canEdit, onChange: set(k),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') commit(); },
    ...extra,
  });

  // save once focus leaves the whole row, so moving between its boxes never interrupts typing
  const onRowBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit();
  };

  return (
    <div onBlur={onRowBlur}>
      <div className="plan-row">
        <span className="grid-slot" style={{ fontSize: 18 }}>{slot}</span>
        <input {...inputProps('name', 'exercise', { list: 'planner-library', placeholder: 'Start typing…', autoFocus: !ex })} />
        <input {...inputProps('sets', 'sets', { inputMode: 'numeric', placeholder: 'Sets' })} />
        <input {...inputProps('reps', 'reps', { placeholder: '8, 6 ea, AMRAP' })} />
        <input {...inputProps('rir', 'RIR', { placeholder: 'RIR' })} />
        <input {...inputProps('cue', 'cue', { placeholder: 'Cue / note' })} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="set-state" style={{ color: state === 'error' ? 'var(--red)' : 'var(--green-text)' }} aria-live="polite">
            {state === 'saving' ? '…' : state === 'saved' ? '✓' : state === 'error' ? '!' : ''}
          </span>
          {ex && onMore && canEdit && <button className="btn ghost small" aria-label={`More options for ${slot}`} onClick={onMore}>⋯</button>}
          {!ex && onDiscard && <button className="btn ghost small" aria-label={`Discard new ${slot}`} onClick={onDiscard}>✕</button>}
        </span>
      </div>
      {err && <div className="small" style={{ color: 'var(--red)', padding: '0 0 6px 62px' }}>{err}</div>}
    </div>
  );
}
