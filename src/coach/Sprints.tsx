import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { addDays, isoDay } from '../lib/dates';
import { MEDAL_ICON, SPRINTS, fmtTime, mondayOf, type SprintResult, type SprintSession, type SprintType } from '../lib/sprints';
import { fullName, type Person } from '../lib/types';
import { ErrorMsg } from '../ui/common';
import { parseTime } from '../ui/Sprints';
import type { RosterData } from './CoachHome';

type View = 'week' | 'prs';

export function Sprints({ me, data }: { me: Person; data: RosterData }) {
  const [board, setBoard] = useState<SprintSession[] | null>(null);
  const [raw, setRaw] = useState<SprintResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sprint, setSprint] = useState<SprintType>('10/10');
  const [session, setSession] = useState<string>('');
  const [view, setView] = useState<View>('week');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => Promise.all([api.sprintBoard(), api.sprintResults(null)])
    .then(([b, r]) => { setBoard(b); setRaw(r); }).catch(e => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const people = useMemo(() => new Map(data.people.map(p => [p.id, p])), [data.people]);
  const sessions = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of board ?? []) if (s.sprint === sprint && (!m.has(s.session) || s.session_date > m.get(s.session)!)) m.set(s.session, s.session_date);
    return [...m.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([name]) => name);
  }, [board, sprint]);
  const current = sessions.includes(session) ? session : sessions[0] ?? '';

  if (!board) return <div className="muted small">Loading…<ErrorMsg error={error} /></div>;

  const weekRows = board.filter(s => s.sprint === sprint && s.session === current);
  const prRows = (() => {
    const m = new Map<string, SprintSession>();
    for (const s of board) if (s.sprint === sprint) { const c = m.get(s.person_id!); if (!c || s.best < c.best) m.set(s.person_id!, s); }
    return [...m.values()];
  })();
  const medalCount = (pid: string) => {
    const c: Record<string, number> = {};
    for (const s of board) if (s.person_id === pid && s.sprint === sprint && s.medal && s.final !== false) c[s.medal] = (c[s.medal] ?? 0) + 1;
    return (['gold', 'silver', 'bronze'] as const).filter(k => c[k]).map(k => `${MEDAL_ICON[k]}${c[k] > 1 ? `×${c[k]}` : ''}`).join(' ');
  };

  const currentWeek = weekRows[0]?.session_date ?? '';
  const isLive = weekRows.some(r => r.final === false);
  const entriesFor = (pid: string) => raw.filter(r => r.person_id === pid && r.sprint === sprint && mondayOf(r.run_date) === currentWeek)
    .sort((a, b) => Number(a.seconds) - Number(b.seconds));

  const remove = async (id: string) => {
    setError(null);
    try { await api.removeSprint(id); await load(); } catch (e) { setError((e as Error).message); }
  };

  const table = (rows: SprintSession[], title: string, isWeek: boolean) => {
    const sorted = [...rows].sort((a, b) => a.best - b.best);
    const times = [...new Set(sorted.map(r => r.best))];
    return (
      <div className="card" style={{ gap: 0 }}>
        <div className="row" style={{ marginBottom: 6 }}><h2 style={{ fontSize: 16 }}>{title}</h2><span className="small muted">{sorted.length} ran</span></div>
        {!sorted.length && <div className="small muted">No times yet.</div>}
        {sorted.map(r => {
          const p = people.get(r.person_id!);
          const key = `${r.person_id}`;
          return (
            <div key={key} style={{ borderTop: '1px solid var(--line)', padding: '7px 0' }}>
              <div className="row" style={{ cursor: isWeek ? 'pointer' : undefined }} onClick={() => isWeek && setOpen(o => o === key ? null : key)}>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span className="muted small" style={{ width: 18, textAlign: 'right' }}>{times.indexOf(r.best) + 1}</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{p ? fullName(p) : 'Unknown'}</span>
                  {!isWeek && <span className="small muted">{r.session}</span>}
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {isWeek ? (r.medal ? `${MEDAL_ICON[r.medal]} ` : '') : `${medalCount(r.person_id!)} `}<b>{fmtTime(r.best)}</b>
                </span>
              </div>
              {isWeek && open === key && (
                <div className="small" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 6 }}>
                  {entriesFor(r.person_id!).map(e => (
                    <span key={e.id} className="chip">
                      {fmtTime(e.seconds)} <span className="muted">· {e.source === 'sheet' ? 'fall sheet' : e.source}</span>
                      {me.coach_can_edit && <button className="link" style={{ padding: '0 0 0 6px' }} aria-label="Remove" onClick={() => remove(e.id)}>✕</button>}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const rows = view === 'week' ? weekRows : prRows;

  return (
    <>
      <ErrorMsg error={error} />
      <div className="chips" style={{ alignItems: 'center' }}>
        {SPRINTS.map(s => <button key={s} className={`toggle ${s === sprint ? 'on' : ''}`} style={{ height: 32 }} onClick={() => { setSprint(s); setSession(''); setOpen(null); }}>{s}</button>)}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className={`toggle ${view === 'week' ? 'on' : ''}`} style={{ height: 32 }} onClick={() => setView('week')}>By week</button>
          <button className={`toggle ${view === 'prs' ? 'on' : ''}`} style={{ height: 32 }} onClick={() => setView('prs')}>All-time PRs</button>
        </span>
      </div>
      {view === 'week' && (
        <select className="input" style={{ maxWidth: 260, height: 38 }} value={current} onChange={e => { setSession(e.target.value); setOpen(null); }}>
          {!sessions.length && <option value="">No {sprint} times yet</option>}
          {sessions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      )}
      {view === 'week' && isLive && <div className="msg info small"><b>Live week.</b> Standings move as times come in; medals become official at midnight Sunday.</div>}
      <div className="small muted">Medals go to the 3 fastest times each week (ties share). Pitchers and position players are ranked separately; a week needs 4+ runners.{view === 'week' ? ' Tap a name to see every rep.' : ''}</div>
      {table(rows.filter(r => r.is_pitcher), 'Pitchers', view === 'week')}
      {table(rows.filter(r => !r.is_pitcher), 'Position players', view === 'week')}
      {me.coach_can_edit && <AddTime data={data} sprint={sprint} onAdded={load} />}
    </>
  );
}

/** Coach enters a time for an athlete (e.g. read off the timing gates). */
function AddTime({ data, sprint, onAdded }: { data: RosterData; sprint: SprintType; onAdded: () => void }) {
  const today = isoDay();
  const [pid, setPid] = useState('');
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const secs = parseTime(time);
  const athletes = data.people.filter(p => p.active && !p.is_coach)
    .sort((a, b) => Number(b.is_pitcher) - Number(a.is_pitcher) || a.last_name.localeCompare(b.last_name));
  const add = async () => {
    if (!pid || secs == null) return;
    setError(null); setMsg(null);
    try {
      await api.logSprint({ person_id: pid, sprint, run_date: date, seconds: secs, source: 'coach' });
      const p = athletes.find(a => a.id === pid);
      setMsg(`Saved ${sprint} ${secs.toFixed(2)} for ${p ? fullName(p) : 'athlete'} (week of ${mondayOf(date).slice(5).replace('-', '/')}).`);
      setTime(''); onAdded();
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="card" style={{ gap: 8 }}>
      <h2 style={{ fontSize: 16 }}>Add a {sprint} time for an athlete</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select className="input" style={{ flex: '2 1 180px', height: 42 }} value={pid} onChange={e => setPid(e.target.value)}>
          <option value="">Athlete</option>
          {athletes.map(p => <option key={p.id} value={p.id}>{fullName(p)}</option>)}
        </select>
        <input className="input" type="date" style={{ flex: '1 1 140px' }} value={date} min="2026-08-01" max={addDays(today, 1)} onChange={e => setDate(e.target.value || today)} />
        <input className="input" inputMode="decimal" placeholder="e.g. 1.08" style={{ flex: '1 1 100px' }} value={time} onChange={e => setTime(e.target.value)} />
        <button className="btn" disabled={!pid || secs == null} onClick={add}>Add</button>
      </div>
      {msg && <div className="small muted">{msg}</div>}
      <ErrorMsg error={error} />
    </div>
  );
}
