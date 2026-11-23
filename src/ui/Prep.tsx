import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { BlockDay, LiftBlock, PrepItem } from '../lib/lifts';
import type { Exercise } from '../lib/types';
import { ErrorMsg } from './common';

/** Read-only Lifting Prep list (used by athletes and in the coach's block view). */
export function PrepList({ day, week, compact }: { day: BlockDay; week: number; compact?: boolean }) {
  const items = day.prep?.items ?? [];
  const sprint = day.focus === 'lower' ? day.sprints[week - 1] : '';
  if (!items.length && !sprint && !day.warmup) return <div className="small muted">No Lifting Prep set for this day.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map((it, i) => (
        <div key={i} className="row small" style={{ borderBottom: '1px solid var(--line)', padding: compact ? '4px 0' : '7px 0' }}>
          <span style={{ fontWeight: it.exercise_id || it.video_url ? 600 : 400, color: it.exercise_id || it.video_url ? 'var(--text)' : 'var(--muted)' }}>
            {it.name}{it.dose ? <span className="muted" style={{ fontWeight: 400 }}> · {it.dose}</span> : null}
          </span>
          {it.video_url && <a href={it.video_url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, flexShrink: 0 }}>Video ↗</a>}
        </div>
      ))}
      {sprint && <div className="msg info" style={{ display: 'flex', gap: 8, marginTop: 8 }}><b>Sprints</b><span>{sprint}</span></div>}
      {day.warmup && <div className="small muted" style={{ marginTop: 8 }}>{day.warmup}</div>}
    </div>
  );
}

let libCache: Exercise[] | null = null;

/** Coach editor for one day's Lifting Prep. */
export function PrepEditor({ block, day, onSaved, onCancel }: { block: LiftBlock; day: BlockDay; onSaved: () => void; onCancel: () => void }) {
  const [items, setItems] = useState<PrepItem[]>(() => (day.prep?.items ?? []).map(i => ({ ...i })));
  const [lib, setLib] = useState<Exercise[]>(libCache ?? []);
  const [q, setQ] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!libCache) api.listExercises().then(l => { libCache = l; setLib(l); }).catch(() => {}); }, []);

  const term = q.trim().toLowerCase();
  const results = useMemo(() => !term ? [] : lib.filter(e => e.active && (e.name.toLowerCase().includes(term) || e.old_names.some(o => o.toLowerCase().includes(term)))).slice(0, 8), [lib, term]);

  const move = (i: number, d: -1 | 1) => setItems(x => { const y = [...x]; const j = i + d; if (j < 0 || j >= y.length) return y; [y[i], y[j]] = [y[j], y[i]]; return y; });
  const set = (i: number, patch: Partial<PrepItem>) => setItems(x => x.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const addEx = (e: Exercise) => { setItems(x => [...x, { name: e.name, exercise_id: e.id, video_url: e.video_url, dose: '' }]); setQ(''); };
  const addText = () => { const t = text.trim(); if (!t) return; setItems(x => [...x, { name: t, exercise_id: null, video_url: null, dose: '' }]); setText(''); };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.savePrep(block, day, items.map(i => ({ name: i.name.trim(), exercise_id: i.exercise_id, video_url: i.video_url, dose: i.dose?.trim() || null })).filter(i => i.name));
      onSaved();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input className="input" style={{ flex: 2, height: 38, fontSize: 14, fontWeight: it.exercise_id ? 600 : 400 }} value={it.name} onChange={e => set(i, { name: e.target.value })} />
          <input className="input" style={{ flex: 1, height: 38, fontSize: 14 }} placeholder="Sets/reps" value={it.dose ?? ''} onChange={e => set(i, { dose: e.target.value })} />
          <button className="btn ghost small" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
          <button className="btn ghost small" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
          <button className="btn ghost small" onClick={() => setItems(x => x.filter((_, k) => k !== i))} aria-label="Remove">✕</button>
        </div>
      ))}
      {!items.length && <div className="small muted">No drills yet. Add from the Library or type a line.</div>}
      <div style={{ position: 'relative' }}>
        <input className="input" placeholder="+ Add drill from Library (search)" value={q} onChange={e => setQ(e.target.value)} />
        {results.length > 0 && (
          <div className="card" style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, top: '100%', padding: 4, gap: 0, maxHeight: 280, overflowY: 'auto' }}>
            {results.map(e => (
              <button key={e.id} className="lib-row" style={{ background: 'none', border: 'none', color: 'var(--text)', textAlign: 'left', width: '100%' }} onClick={() => addEx(e)}>
                <b style={{ fontSize: 14 }}>{e.name}</b> <span className="small muted">· {e.subcategory ?? e.category}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="input" placeholder="+ Add a text line (e.g. Circuit (3 rounds))" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addText(); }} />
        <button className="btn ghost small" style={{ height: 44 }} onClick={addText}>Add</button>
      </div>
      <ErrorMsg error={error} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save Lifting Prep'}</button>
      </div>
      <span className="small muted">Changes show for every athlete on this block day.</span>
    </div>
  );
}
