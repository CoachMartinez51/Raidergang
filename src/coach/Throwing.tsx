import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { addDays, isoDay, prettyDay } from '../lib/dates';
import { intensityText, KIND_ORDER, KINDS, mondayOf, PLYO_LABEL, type Plyos, type ThrowAssignment, type ThrowDay, type ThrowDayDraft, type ThrowKind, type ThrowProgram } from '../lib/throwing';
import { fullName, type Person } from '../lib/types';
import { ErrorMsg } from '../ui/common';
import type { RosterData } from './CoachHome';

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKS = 3;

/** Coach → Throwing: build programs on a calendar (like the sheet), assign pitchers, set their velo. */
export function Throwing({ me, data }: { me: Person; data: RosterData }) {
  const ro = !me.coach_can_edit;
  const [programs, setPrograms] = useState<ThrowProgram[] | null>(null);
  const [assign, setAssign] = useState<ThrowAssignment[]>([]);
  const [pid, setPid] = useState<string | null>(null);
  const [start, setStart] = useState(mondayOf(isoDay()));
  const [days, setDays] = useState<Map<string, ThrowDay>>(new Map());
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState<'calendar' | 'assign'>('calendar');
  const [error, setError] = useState<string | null>(null);

  const reloadMeta = () => Promise.all([api.throwPrograms(), api.throwAssignments()]).then(([p, a]) => {
    setPrograms(p); setAssign(a); setPid(x => x ?? p[0]?.id ?? null);
  }).catch(e => setError((e as Error).message));
  useEffect(() => { reloadMeta(); }, []);

  const end = addDays(start, WEEKS * 7 - 1);
  useEffect(() => {
    if (!pid) return;
    api.throwDays(pid, start, end).then(rows => setDays(new Map(rows.map(r => [r.day, r])))).catch(e => setError((e as Error).message));
  }, [pid, start, end]);

  if (error && !programs) return <ErrorMsg error={error.includes('throw_') ? 'Throwing isn\'t set up yet. Run stage10_throwing.sql in Supabase.' : error} />;
  if (!programs) return <div className="muted small">Loading…</div>;

  const count = (id: string) => assign.filter(a => a.program_id === id).length;
  const program = programs.find(p => p.id === pid) ?? null;

  const copy = async () => {
    if (!program) return;
    const name = window.prompt(`Copy ${program.name} as…`, `${program.name} (copy)`);
    if (!name?.trim()) return;
    try { const id = await api.copyThrowProgram(program.id, name.trim()); await reloadMeta(); setPid(id); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 22 }}>Throwing programs</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className={`toggle ${view === 'calendar' ? 'on' : ''}`} onClick={() => setView('calendar')}>Calendar</button>
          <button className={`toggle ${view === 'assign' ? 'on' : ''}`} onClick={() => setView('assign')}>Assign pitchers · velo</button>
          {!ro && view === 'calendar' && program && <button className="btn ghost small" onClick={copy}>Copy {program.name}…</button>}
        </div>
      </div>
      <ErrorMsg error={error} />

      {view === 'assign' ? (
        <AssignView ro={ro} data={data} programs={programs} assign={assign} onChanged={reloadMeta} />
      ) : (
        <>
          <div className="chips">
            {programs.map(p => (
              <button key={p.id} className={`toggle ${p.id === pid ? 'on' : ''}`} onClick={() => { setPid(p.id); setSel(null); }}>
                {p.name} · {count(p.id)}
              </button>
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn ghost small" onClick={() => setStart(s => addDays(s, -7 * WEEKS))}>‹ Earlier</button>
            <span style={{ fontWeight: 600 }}>{prettyDay(start, { month: 'short', day: 'numeric' })} – {prettyDay(end, { month: 'short', day: 'numeric' })}</span>
            <button className="btn ghost small" onClick={() => setStart(s => addDays(s, 7 * WEEKS))}>Later ›</button>
            <button className="btn ghost small" onClick={() => setStart(mondayOf(isoDay()))}>This week</button>
          </div>

          <div className="card scroll-x" style={{ padding: 10 }}>
            <div className="tcal">
              {WD.map(w => <span key={w} className="tcal-h">{w}</span>)}
              {Array.from({ length: WEEKS * 7 }, (_, i) => addDays(start, i)).map(iso => {
                const d = days.get(iso);
                return (
                  <button key={iso} className={`tcell ${d ? KINDS[d.kind].cls : 'k-none'} ${iso === sel ? 'sel' : ''}`} onClick={() => setSel(iso)}>
                    <span className="tc-top"><b>{prettyDay(iso, { month: 'numeric', day: 'numeric' })}</b>{d && <span>{KINDS[d.kind].label}</span>}</span>
                    <span className="tc-title">{d ? (d.sp_title && d.sp_title !== d.title ? 'Live (RP / SP)' : d.title) : '—'}</span>
                    {d && (d.distance || d.catch_play) && <span className="tc-sub">{[d.distance, d.kind !== 'Off' ? intensityText(d.kind) : null].filter(Boolean).join(' · ')}</span>}
                    {d && d.plyos !== 'none' && <span className="tc-ply">{PLYO_LABEL[d.plyos]}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {sel && program && (
            <DayEditor key={`${program.id}|${sel}`} ro={ro} program={program} date={sel} day={days.get(sel) ?? null}
              onSaved={d => setDays(m => new Map(m).set(d.day, d))} onClose={() => setSel(null)} />
          )}
          <DayTypes />
        </>
      )}
    </>
  );
}

function DayEditor({ ro, program, date, day, onSaved, onClose }: {
  ro: boolean; program: ThrowProgram; date: string; day: ThrowDay | null; onSaved: (d: ThrowDay) => void; onClose: () => void;
}) {
  const blank: ThrowDayDraft = { kind: 'Off', title: 'Off', sp_title: null, distance: null, catch_play: null, plyos: 'none', note: null };
  const [d, setD] = useState<ThrowDayDraft>(() => day ? { kind: day.kind, title: day.title, sp_title: day.sp_title, distance: day.distance, catch_play: day.catch_play, plyos: day.plyos, note: day.note } : blank);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ThrowDayDraft>(k: K, v: ThrowDayDraft[K]) => { setD(x => ({ ...x, [k]: v })); setMsg(null); };

  // Changing the type fills in that type's catch play and plyos (you can still change them).
  const pickKind = (k: ThrowKind) => setD(x => ({
    ...x, kind: k, catch_play: KINDS[k].catchPlay, plyos: KINDS[k].plyos,
    title: x.title === KINDS[x.kind].label || x.title === 'Off' || !x.title ? KINDS[k].label : x.title,
  }));

  const save = async () => {
    if (!d.title.trim()) { setError('Give the day a title athletes will see.'); return; }
    setBusy(true); setError(null);
    try {
      const saved = await api.saveThrowDay(program.id, date, {
        ...d, title: d.title.trim(), sp_title: d.sp_title?.trim() || null, distance: d.distance?.trim() || null,
        catch_play: d.catch_play?.trim() || null, note: d.note?.trim() || null,
      });
      onSaved(saved); setMsg('Saved');
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="card" style={{ gap: 10, borderColor: 'var(--gold)' }}>
      <div className="row">
        <h2>{prettyDay(date, { weekday: 'short', month: 'short', day: 'numeric' })} · {program.name}</h2>
        <button className="btn ghost small" onClick={onClose}>Close</button>
      </div>
      <div className="grid2">
        <label className="field">Type
          <select className={`input ${KINDS[d.kind].cls}`} disabled={ro} value={d.kind} onChange={e => pickKind(e.target.value as ThrowKind)}>
            {KIND_ORDER.map(k => <option key={k} value={k}>{KINDS[k].label}</option>)}
          </select>
        </label>
        <label className="field">Plyos
          <select className="input" disabled={ro} value={d.plyos} onChange={e => set('plyos', e.target.value as Plyos)}>
            {(['none', 'half', 'full'] as const).map(p => <option key={p} value={p}>{PLYO_LABEL[p]}</option>)}
          </select>
        </label>
      </div>
      <label className="field">Title athletes see
        <input className="input" disabled={ro} maxLength={160} value={d.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Long toss ~150 ft (peak)" />
      </label>
      {(d.kind === 'Live' || d.sp_title) && (
        <label className="field">Starters' version (optional, if different)
          <input className="input" disabled={ro} maxLength={160} value={d.sp_title ?? ''} onChange={e => set('sp_title', e.target.value)} placeholder="e.g. SP: LIVE — 65-75 pitches · 4-5 innings" />
        </label>
      )}
      <div className="grid2">
        <label className="field">Distance
          <input className="input" disabled={ro} maxLength={40} value={d.distance ?? ''} onChange={e => set('distance', e.target.value)} placeholder={KINDS[d.kind].distance ?? ''} />
        </label>
        <label className="field">Catch play
          <input className="input" disabled={ro} maxLength={60} value={d.catch_play ?? ''} onChange={e => set('catch_play', e.target.value)} placeholder={KINDS[d.kind].catchPlay ?? ''} />
        </label>
      </div>
      <label className="field">Note
        <textarea className="input" rows={2} disabled={ro} maxLength={500} value={d.note ?? ''} onChange={e => set('note', e.target.value)} />
      </label>
      <div className="small muted">Intensity for this type: {intensityText(d.kind) ?? 'none'} of each pitcher's average fastball. Athletes see their own mph.</div>
      <ErrorMsg error={error} />
      {!ro && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : day ? 'Save day' : 'Add day'}</button>
          {msg && <span className="small" style={{ color: 'var(--green-text)' }}>{msg}</span>}
        </div>
      )}
    </div>
  );
}

function DayTypes() {
  return (
    <div className="card scroll-x" style={{ gap: 6 }}>
      <div className="row"><h2>Day types</h2><span className="small muted">From the Throwing tab in the Coaching Database. Any day can override these.</span></div>
      <table className="table">
        <thead><tr><th>Type</th><th>Catch play</th><th>Distance</th><th>Intensity</th><th>Plyos</th></tr></thead>
        <tbody>
          {KIND_ORDER.map(k => (
            <tr key={k}>
              <td><span className={`kchip ${KINDS[k].cls}`}>{KINDS[k].label}</span></td>
              <td>{KINDS[k].catchPlay ?? '—'}</td><td>{KINDS[k].distance ?? '—'}</td>
              <td>{intensityText(k) ?? '—'}</td><td className="muted">{PLYO_LABEL[KINDS[k].plyos]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AssignView({ ro, data, programs, assign, onChanged }: {
  ro: boolean; data: RosterData; programs: ThrowProgram[]; assign: ThrowAssignment[]; onChanged: () => void;
}) {
  const pitchers = useMemo(() => data.people.filter(p => p.active && !p.is_coach && p.is_pitcher)
    .sort((a, b) => a.last_name.localeCompare(b.last_name)), [data.people]);
  const [velo, setVelo] = useState<Record<string, string>>(() =>
    Object.fromEntries(pitchers.map(p => [p.id, p.throw_velo != null ? String(p.throw_velo) : ''])));
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cur = (id: string) => assign.find(a => a.person_id === id)?.program_id ?? null;

  const move = async (p: Person, programId: string | null) => {
    setError(null);
    try { await api.setThrowProgram(p.id, programId); onChanged(); }
    catch (e) { setError((e as Error).message); }
  };
  const saveVelo = async (p: Person) => {
    const raw = velo[p.id]?.trim() ?? '';
    const mph = raw ? Number(raw) : null;
    if (mph != null && (!isFinite(mph) || mph < 50 || mph > 105)) { setError(`${fullName(p)}: enter a velo between 50 and 105.`); return; }
    if ((p.throw_velo ?? null) == mph) return;
    setError(null);
    try { await api.setThrowVelo(p.id, mph); p.throw_velo = mph; setSaved(p.id); setTimeout(() => setSaved(s => s === p.id ? null : s), 1500); }
    catch (e) { setError((e as Error).message); }
  };
  const noVelo = pitchers.filter(p => !velo[p.id]).length;

  return (
    <div className="card" style={{ gap: 4 }}>
      <div className="small muted" style={{ marginBottom: 6 }}>
        Pick each pitcher's program. Avg FB velo is their fall average fastball; their Low / Medium / High mph ranges come from it.
        {noVelo ? ` ${noVelo === 1 ? '1 pitcher still needs' : `${noVelo} pitchers still need`} a velo.` : ''}
      </div>
      <ErrorMsg error={error} />
      {pitchers.map(p => (
        <div key={p.id} className="assign-row">
          <span className="nm">{fullName(p)}</span>
          <label className="velo">
            <input className="input" inputMode="decimal" aria-label={`${fullName(p)} average fastball`} disabled={ro} placeholder="mph"
              value={velo[p.id] ?? ''} onChange={e => setVelo(v => ({ ...v, [p.id]: e.target.value }))} onBlur={() => saveVelo(p)} />
            {saved === p.id && <span className="small" style={{ color: 'var(--green-text)' }}>✓</span>}
          </label>
          <span className="seg">
            {programs.map(pr => (
              <button key={pr.id} disabled={ro} className={cur(p.id) === pr.id ? 'on' : ''} onClick={() => move(p, pr.id)}>{pr.name}</button>
            ))}
            <button disabled={ro} className={!cur(p.id) ? 'on' : ''} onClick={() => move(p, null)}>None</button>
          </span>
        </div>
      ))}
    </div>
  );
}
