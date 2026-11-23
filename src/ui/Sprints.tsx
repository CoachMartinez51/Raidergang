import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { addDays, isoDay, prettyDay } from '../lib/dates';
import { scheduleFor } from '../lib/lifts';
import { MEDAL_ICON, SPRINTS, fmtTime, mondayOf, sessionName, sprintOfWeek, type SprintResult, type SprintSession, type SprintType } from '../lib/sprints';
import type { Person } from '../lib/types';
import { ErrorMsg } from './common';

const FIRST_DAY = '2026-08-01';

export const parseTime = (t: string): number | null => {
  const n = parseFloat(t.replace(',', '.'));
  return !isNaN(n) && n >= 0.7 && n <= 2.5 ? Math.round(n * 100) / 100 : null;
};

/** Athlete home: PRs, medals, and logging this week's sprint. */
export function SprintCard({ me }: { me: Person }) {
  const today = isoDay();
  const [rows, setRows] = useState<SprintResult[] | null>(null);
  const [hist, setHist] = useState<SprintSession[]>([]);
  const [sprint, setSprint] = useState<SprintType>('10/10');
  const [suggested, setSuggested] = useState<SprintType | null>(null);
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cheer, setCheer] = useState<string | null>(null);
  const [allHistory, setAllHistory] = useState(false);

  const reload = useCallback(() => Promise.all([api.sprintResults(me.id), api.sprintHistory(me.id)])
    .then(([r, h]) => { setRows(r); setHist(h); }).catch(e => setError(e.message)), [me.id]);

  useEffect(() => {
    reload();
    // default to this week's timed sprint from the lift block
    Promise.all([api.listBlocks(), api.assignmentsFor(me.id)]).then(([blocks, asg]) => {
      const s = scheduleFor(today, asg, blocks);
      const t = s ? sprintOfWeek(s.block, s.week) : null;
      if (t) { setSuggested(t); setSprint(t); }
    }).catch(() => { /* no block: keep the default */ });
  }, [me.id, today, reload]);

  const prs = useMemo(() => {
    const m = new Map<SprintType, SprintResult>();
    for (const r of rows ?? []) { const cur = m.get(r.sprint); if (!cur || Number(r.seconds) < Number(cur.seconds)) m.set(r.sprint, r); }
    return m;
  }, [rows]);
  const medals = useMemo(() => {
    const m = new Map<SprintType, Record<string, number>>();
    for (const h of hist) if (h.medal) { const c = m.get(h.sprint) ?? {}; c[h.medal] = (c[h.medal] ?? 0) + 1; m.set(h.sprint, c); }
    return m;
  }, [hist]);

  if (!rows) return error ? <ErrorMsg error={error} /> : null;

  const week = mondayOf(date);
  const thisWeek = rows.filter(r => r.sprint === sprint && !r.session_label && mondayOf(r.run_date) === week)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const latest = hist[0];
  const secs = parseTime(time);

  const add = async () => {
    if (secs == null) return;
    setBusy(true); setError(null); setCheer(null);
    const oldPr = prs.get(sprint);
    try {
      await api.logSprint({ person_id: me.id, sprint, run_date: date, seconds: secs });
      setTime('');
      if (!oldPr || secs < Number(oldPr.seconds)) setCheer(`New ${sprint} PR: ${fmtTime(secs)} 🔥`);
      await reload();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const remove = async (id: string) => {
    setError(null);
    try { await api.removeSprint(id); await reload(); } catch (e) { setError((e as Error).message); }
  };

  const shown = allHistory ? hist : hist.slice(0, 6);

  return (
    <>
      <div className="section-title">Sprints</div>
      <div className="card" style={{ gap: 12 }}>
        {latest?.medal && (
          <div className="msg info" style={{ fontWeight: 600 }}>
            {MEDAL_ICON[latest.medal]} {latest.medal[0].toUpperCase() + latest.medal.slice(1)} on the {latest.sprint} · {latest.session} ({fmtTime(latest.best)})
          </div>
        )}

        <div className="sprint-prs">
          {SPRINTS.map(s => {
            const pr = prs.get(s); const m = medals.get(s);
            return (
              <div key={s} className={`sprint-pr ${s === sprint ? 'on' : ''}`} onClick={() => setSprint(s)}>
                <span className="small muted">{s} PR</span>
                <span className="pr-time">{pr ? fmtTime(pr.seconds) : '—'}</span>
                <span className="small muted">{pr ? sessionName(pr) : 'No time yet'}</span>
                {m && <span className="small">{(['gold', 'silver', 'bronze'] as const).filter(k => m[k]).map(k => `${MEDAL_ICON[k]}${m[k] > 1 ? `×${m[k]}` : ''}`).join(' ')}</span>}
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="row">
            <h2 style={{ fontSize: 16 }}>Log a time</h2>
            {suggested && <span className="small muted">This week: {suggested}</span>}
          </div>
          <div className="chips">
            {SPRINTS.map(s => <button key={s} className={`toggle ${s === sprint ? 'on' : ''}`} style={{ height: 32 }} onClick={() => setSprint(s)}>{s}</button>)}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="input" type="date" style={{ flex: '1 1 140px' }} value={date} min={FIRST_DAY} max={addDays(today, 1)}
              onChange={e => setDate(e.target.value || today)} aria-label="Date" />
            <input className="input" inputMode="decimal" placeholder="Time, e.g. 1.08" style={{ flex: '1 1 120px' }} value={time}
              onChange={e => setTime(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} aria-label="Time in seconds" />
            <button className="btn" disabled={secs == null || busy} onClick={add}>Add</button>
          </div>
          <span className="small muted">Log each timed rep. Your best one counts. Late is fine: pick the day you ran.</span>
          {cheer && <div className="msg info">{cheer}</div>}
          <ErrorMsg error={error} />
          {thisWeek.length > 0 && (
            <div className="small" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <span className="muted">{sprint} week of {prettyDay(week, { month: 'short', day: 'numeric' })}:</span>
              {thisWeek.map(r => (
                <span key={r.id} className="chip">
                  {fmtTime(r.seconds)}
                  {r.source === 'app' && <button className="link" style={{ padding: '0 0 0 6px' }} aria-label="Remove" onClick={() => remove(r.id)}>✕</button>}
                </span>
              ))}
            </div>
          )}
        </div>

        {hist.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 style={{ fontSize: 16 }}>History</h2>
            {shown.map(h => (
              <div key={`${h.sprint}|${h.session}`} className="row small" style={{ borderTop: '1px solid var(--line)', paddingTop: 4 }}>
                <span><b>{h.sprint}</b> <span className="muted">· {h.session}</span></span>
                <span>{h.medal ? `${MEDAL_ICON[h.medal]} ` : ''}{fmtTime(h.best)}</span>
              </div>
            ))}
            {hist.length > 6 && <button className="link" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={() => setAllHistory(a => !a)}>{allHistory ? 'Show less' : `Show all ${hist.length}`}</button>}
          </div>
        )}
      </div>
    </>
  );
}
