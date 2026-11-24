import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { addDays, isoDay, prettyDay } from '../lib/dates';
import { scheduleFor } from '../lib/lifts';
import { MEDAL_ICON, SPRINTS, fmtTime, mondayOf, sessionName, sprintOfWeek, type SpotlightRow, type SprintResult, type SprintSession, type SprintType } from '../lib/sprints';
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
  const [takeover, setTakeover] = useState<{ sprint: SprintType; old: number; now: number } | null>(null);

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
    for (const h of hist) if (h.medal && h.final !== false) { const c = m.get(h.sprint) ?? {}; c[h.medal] = (c[h.medal] ?? 0) + 1; m.set(h.sprint, c); }
    return m;
  }, [hist]);

  if (!rows) return error ? <ErrorMsg error={error} /> : null;

  // how much faster than their first recorded week on each sprint
  const firstOf = new Map<SprintType, SprintSession>();
  for (const h of hist) { const f = firstOf.get(h.sprint); if (!f || h.session_date < f.session_date) firstOf.set(h.sprint, h); }
  const myMedals = hist.filter(h => h.medal && h.final !== false);
  const totals = (['gold', 'silver', 'bronze'] as const).map(k => [k, myMedals.filter(h => h.medal === k).length] as const);

  const week = mondayOf(date);
  const thisWeek = rows.filter(r => r.sprint === sprint && !r.session_label && mondayOf(r.run_date) === week)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const latest = hist.find(h => h.final !== false);
  const liveNow = hist.find(h => h.final === false && h.medal);
  const secs = parseTime(time);

  const add = async () => {
    if (secs == null) return;
    setBusy(true); setError(null); setCheer(null);
    const oldPr = prs.get(sprint);
    try {
      await api.logSprint({ person_id: me.id, sprint, run_date: date, seconds: secs });
      setTime('');
      if (oldPr && secs < Number(oldPr.seconds)) setTakeover({ sprint, old: Number(oldPr.seconds), now: secs });
      else if (!oldPr) setCheer(`First ${sprint} time logged: ${fmtTime(secs)}. That's your PR to beat.`);
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
        {liveNow?.medal && (
          <div className="msg info" style={{ fontWeight: 600 }}>
            {MEDAL_ICON[liveNow.medal]} You're in {liveNow.medal} position on the {liveNow.sprint} this week ({fmtTime(liveNow.best)}). Hold it until Sunday night.
          </div>
        )}
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
                {(() => {
                  const f = firstOf.get(s);
                  const drop = pr && f ? Math.round((f.best - Number(pr.seconds)) * 100) / 100 : 0;
                  return drop > 0 ? <span className="faster">−{fmtTime(drop)} since {f!.session}</span> : null;
                })()}
                {m && <span className="small">{(['gold', 'silver', 'bronze'] as const).filter(k => m[k]).map(k => `${MEDAL_ICON[k]}${m[k] > 1 ? `×${m[k]}` : ''}`).join(' ')}</span>}
              </div>
            );
          })}
        </div>

        <div className="medal-case">
          <div className="row">
            <h2 style={{ fontSize: 16 }}>Medal case</h2>
            <span className="small">{totals.map(([k, n]) => <span key={k} style={{ marginLeft: 8, opacity: n ? 1 : 0.4 }}>{MEDAL_ICON[k]} {n}</span>)}</span>
          </div>
          {myMedals.length
            ? <div className="chips">{myMedals.map(h => <span key={`${h.sprint}|${h.session}`} className={`medal-chip ${h.medal}`}>{MEDAL_ICON[h.medal!]} {h.sprint} · {h.session} · {fmtTime(h.best)}</span>)}</div>
            : <span className="small muted">No medals yet. Top 3 times each testing week earn gold, silver and bronze.</span>}
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
                <span>{h.medal && h.final !== false ? `${MEDAL_ICON[h.medal]} ` : ''}{fmtTime(h.best)}</span>
              </div>
            ))}
            {hist.length > 6 && <button className="link" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={() => setAllHistory(a => !a)}>{allHistory ? 'Show less' : `Show all ${hist.length}`}</button>}
          </div>
        )}
      </div>
      {takeover && <PrTakeover {...takeover} name={me.first_name} onClose={() => setTakeover(null)} />}
    </>
  );
}

/** Full-screen moment when an athlete beats their PR. */
function PrTakeover({ sprint, old, now, name, onClose }: { sprint: SprintType; old: number; now: number; name: string; onClose: () => void }) {
  const drop = Math.round((old - now) * 100) / 100;
  useEffect(() => {
    const t = window.setTimeout(() => document.getElementById('pr-close')?.focus(), 50);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="pr-takeover" role="dialog" aria-modal="true" aria-labelledby="pr-title" onClick={onClose}>
      <div className="pr-burst" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <span key={i} style={{ ['--i' as string]: i }} />)}</div>
      <div className="pr-inner" onClick={e => e.stopPropagation()}>
        <span className="pr-kicker">{sprint}</span>
        <h1 id="pr-title" className="pr-title">NEW PR</h1>
        <div className="pr-time">{fmtTime(now)}</div>
        <div className="pr-from">was {fmtTime(old)} · <b>{fmtTime(drop)} faster</b></div>
        <p className="pr-line">You got faster, {name}. Keep stacking.</p>
        <button id="pr-close" className="btn pr-btn" onClick={onClose}>Let's go</button>
      </div>
    </div>
  );
}

/** "The Medalists" + Most Improved for the latest testing week. Whole team sees it. */
export function Medalists({ me }: { me: Person }) {
  const [rows, setRows] = useState<SpotlightRow[] | null>(null);
  useEffect(() => { api.sprintSpotlight().then(setRows).catch(() => setRows([])); }, []);
  if (!rows || !rows.length) return null;
  const live = rows.filter(r => r.status === 'live');
  const official = rows.filter(r => r.status === 'official');
  return (
    <div className="card medalists">
      <h2>The Medalists</h2>
      {live.length > 0 && <Board me={me} rows={live} live />}
      {official.length > 0 && <Board me={me} rows={official} />}
    </div>
  );
}

function Board({ me, rows, live }: { me: Person; rows: SpotlightRow[]; live?: boolean }) {
  const { sprint, session } = rows[0];
  const pools = [
    { title: 'Pitchers', list: rows.filter(r => r.is_pitcher) },
    { title: 'Position players', list: rows.filter(r => !r.is_pitcher) },
  ].filter(p => p.list.length);
  return (
    <div className={`board ${live ? 'live' : ''}`}>
      <div className="row">
        <span className="board-title">{live ? <><span className="live-dot" aria-hidden="true" />This week · live</> : 'Official medals'}</span>
        <span className="small muted">{sprint} · {session}</span>
      </div>
      {live && <span className="small muted">Log a faster time to knock someone off. Final at midnight Sunday.</span>}
      {pools.map(p => {
        const top = p.list.filter(r => r.rk <= 3).sort((a, b) => a.rk - b.rk || a.last_name.localeCompare(b.last_name));
        const short = top.length > 0 && top[0].runners < 4;
        return (
          <div key={p.title} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pools.length > 1 && <span className="small muted" style={{ letterSpacing: 1, textTransform: 'uppercase' }}>{p.title}</span>}
            {top.map(r => (
              <div key={r.person_id} className={`medal-row ${r.medal ?? ''} ${r.person_id === me.id ? 'me' : ''}`}>
                <span style={{ fontSize: 20, width: 26, textAlign: 'center' }} aria-label={r.medal ?? `Place ${r.rk}`}>{r.medal ? MEDAL_ICON[r.medal] : <b className="muted">{r.rk}</b>}</span>
                <span style={{ flex: 1, fontWeight: 600 }}>{r.first_name} {r.last_name}{r.person_id === me.id ? ' (you)' : ''}</span>
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTime(r.best)}</b>
              </div>
            ))}
            {short && <span className="small muted">{top[0].runners} logged so far. Medals need at least 4 times.</span>}
            {p.list.filter(r => r.most_improved).map(r => (
              <div key={`mi-${r.person_id}`} className={`medal-row improved ${r.person_id === me.id ? 'me' : ''}`}>
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--green-text)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17l6-6 4 4 6-7" /><path d="M14 8h6v6" /></svg>
                <span style={{ flex: 1 }}><b>Most Improved</b> · {r.first_name} {r.last_name}{r.person_id === me.id ? ' (you)' : ''}</span>
                <span className="small" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTime(r.prev_best!)} → <b>{fmtTime(r.best)}</b></span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
