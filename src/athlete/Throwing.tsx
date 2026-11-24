import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { addDays, isoDay, prettyDay } from '../lib/dates';
import { CALC_ROWS, dayChip, dayCls, INTENSITY_FROM, intensityText, KINDS, mondayOf, mphText, PLYO_LABEL, shortTitle, showIntensity, type ThrowDay, type ThrowLog, type ThrowProgram } from '../lib/throwing';
import type { Person } from '../lib/types';

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const monthStart = (iso: string) => iso.slice(0, 8) + '01';
function monthEnd(iso: string) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
const shiftMonth = (iso: string, n: number) => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
};

/** Today's throwing day for the athlete (used by the agenda and Pre-Throw). undefined = loading, null = nothing. */
export function useThrowToday(personId: string) {
  const today = isoDay();
  const [state, setState] = useState<{ program: ThrowProgram | null; day: ThrowDay | null; log: ThrowLog | null } | undefined>(undefined);
  useEffect(() => {
    Promise.all([api.myThrowing(personId, today, today), api.throwLogs({ personId, from: today, to: today }).catch(() => [] as ThrowLog[])])
      .then(([r, logs]) => setState({ program: r.program, day: r.days[0] ?? null, log: logs[0] ?? null }))
      .catch(() => setState({ program: null, day: null, log: null }));
  }, [personId, today]);
  return state;
}

/** The athlete's Throwing tab: today's throw, this week, their intensity numbers, and the month. */
export function ThrowingTab({ me, goPreThrow }: { me: Person; goPreThrow: () => void }) {
  const today = isoDay();
  const [month, setMonth] = useState(monthStart(today));
  const [sel, setSel] = useState(today);
  const [program, setProgram] = useState<ThrowProgram | null | undefined>(undefined);
  const [days, setDays] = useState<Map<string, ThrowDay>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  const velo = me.throw_velo != null ? Number(me.throw_velo) : null;

  // Load the shown month plus this week (which can straddle months).
  const from = useMemo(() => [mondayOf(today), mondayOf(month)].sort()[0], [today, month]);
  const to = useMemo(() => [addDays(mondayOf(today), 6), addDays(mondayOf(monthEnd(month)), 6)].sort().reverse()[0], [today, month]);
  useEffect(() => {
    api.myThrowing(me.id, from, to).then(r => {
      setProgram(r.program);
      setDays(prev => { const m = new Map(prev); r.days.forEach(d => m.set(d.day, d)); return m; });
    }).catch(e => { setErr((e as Error).message); setProgram(null); });
  }, [me.id, from, to]);

  if (program === undefined) return <div className="card"><h2>Catch Play</h2><div className="small muted">Loading…</div></div>;
  if (!program) return (
    <div className="card"><h2>Catch Play</h2>
      <div className="small muted">{err ? `Couldn't load your throwing program (${err}).` : 'No throwing program assigned yet. Coach will add you.'}</div>
    </div>
  );

  const d = days.get(sel) ?? null;
  const week = Array.from({ length: 7 }, (_, i) => addDays(mondayOf(today), i));
  return (
    <>
      <div className="row"><span className="small muted">Winter Arm Build-Up</span><span className="pill-soft gold">{program.name}</span></div>
      <DayHero d={d} date={sel} today={today} />
      {d && d.kind !== 'Off' && d.kind !== 'Recovery' && <DayDetail d={d} velo={velo} goPreThrow={goPreThrow} />}
      {d && d.kind !== 'Off' && sel <= today && <ThrowLogCard me={me} d={d} />}

      <div className="card" style={{ gap: 10 }}>
        <div className="row"><h2>This week</h2>{sel !== today && <button className="link-btn" onClick={() => setSel(today)}>Back to today</button>}</div>
        <div className="throw-week">
          {week.map((iso, i) => {
            const x = days.get(iso);
            return (
              <button key={iso} className={`throw-wd ${x ? dayCls(x) : 'k-none'} ${iso === sel ? 'sel' : ''}`} onClick={() => setSel(iso)}
                aria-label={`${WD[i]} ${prettyDay(iso)}: ${x ? x.title : 'nothing planned'}`}>
                <span className="wd">{WD[i]}</span><span className="dn">{Number(iso.slice(8))}</span><span className="lab">{x ? shortTitle(x) : '–'}</span>
              </button>
            );
          })}
        </div>
        <Legend intensity={showIntensity(week[0]) || showIntensity(week[6])} />
      </div>

      {today >= INTENSITY_FROM && <div className="card" style={{ gap: 4 }}>
        <div className="row"><h2>What is MY intensity?</h2><span className="small muted">{velo ? `Avg fastball ${velo} mph` : ''}</span></div>
        {velo ? CALC_ROWS.map(r => (
          <div key={r.label} className="kv"><span>{r.label} · {intensityText(r.kind)}</span><b>{mphText(r.kind, velo)}</b></div>
        )) : <div className="small muted">Your fall average fastball isn't in yet. Coach will add it, then your mph ranges show here.</div>}
        {velo && <div className="small muted" style={{ marginTop: 6 }}>Based on your average fastball from the fall (Trackman).</div>}
      </div>}

      <MonthCard month={month} days={days} sel={sel} today={today} onPick={setSel}
        onPrev={() => setMonth(m => shiftMonth(m, -1))} onNext={() => setMonth(m => shiftMonth(m, 1))} />
    </>
  );
}

function DayHero({ d, date, today }: { d: ThrowDay | null; date: string; today: string }) {
  const when = `${date === today ? 'TODAY · ' : ''}${prettyDay(date, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}`;
  if (!d) return <div className="throw-hero k-none"><div className="eyebrow">{when}</div><div className="t">Nothing planned</div></div>;
  return (
    <div className={`throw-hero ${dayCls(d)}`}>
      <div className="row"><span className="eyebrow">{when}</span><span className={`kchip ${dayCls(d)}`}>{dayChip(d)}</span></div>
      <div className="t">{d.sp_title && d.sp_title !== d.title ? 'Live outing' : d.title}</div>
      {d.sp_title && d.sp_title !== d.title && (
        <div className="roles"><div><b>Relievers:</b> {d.title.replace(/^RP:\s*/i, '')}</div><div><b>Starters:</b> {d.sp_title.replace(/^SP:\s*/i, '')}</div></div>
      )}
      {d.note && <div className="n">{d.note}</div>}
    </div>
  );
}

function DayDetail({ d, velo, goPreThrow }: { d: ThrowDay; velo: number | null; goPreThrow: () => void }) {
  const it = showIntensity(d.day) ? intensityText(d.kind) : null;
  const mph = showIntensity(d.day) ? mphText(d.kind, velo) : null;
  return (
    <div className="card" style={{ gap: 0 }}>
      <h2 style={{ marginBottom: 4 }}>Your throw</h2>
      {d.catch_play && <div className="kv"><span>Catch play</span><b>{d.catch_play}</b></div>}
      {d.distance && <div className="kv"><span>Distance</span><b>{d.distance}</b></div>}
      {it && <div className="kv"><span>Intensity</span><b>{it}{mph && <span className="kv-sub">{mph} for you</span>}</b></div>}
      <div className="kv"><span>Plyos</span><b>{PLYO_LABEL[d.plyos]}{d.plyos !== 'none' && <button className="link-btn" onClick={goPreThrow}>See them ›</button>}</b></div>
    </div>
  );
}

function Legend({ intensity }: { intensity: boolean }) {
  if (!intensity) return (
    <div className="chips" style={{ gap: 6 }}><span className="kchip k-throw">Throw</span><span className="kchip k-off">Off</span></div>
  );
  return (
    <div className="chips" style={{ gap: 6 }}>
      {(['Off', 'Low', 'Medium', 'High'] as const).map(k => <span key={k} className={`kchip ${KINDS[k].cls}`}>{KINDS[k].label}</span>)}
    </div>
  );
}

function MonthCard({ month, days, sel, today, onPick, onPrev, onNext }: {
  month: string; days: Map<string, ThrowDay>; sel: string; today: string;
  onPick: (iso: string) => void; onPrev: () => void; onNext: () => void;
}) {
  const first = month;
  const lead = (new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7;
  const n = Number(monthEnd(month).slice(8));
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => month.slice(0, 8) + String(i + 1).padStart(2, '0'))];
  while (cells.length % 7) cells.push(null);
  return (
    <div className="card" style={{ gap: 10 }}>
      <div className="row">
        <button className="btn ghost small" aria-label="Previous month" onClick={onPrev}>‹</button>
        <h2>{prettyDay(month, { month: 'long', year: 'numeric' })}</h2>
        <button className="btn ghost small" aria-label="Next month" onClick={onNext}>›</button>
      </div>
      <div className="throw-month">
        {WD.map(w => <span key={w} className="mh">{w[0]}</span>)}
        {cells.map((iso, i) => {
          if (!iso) return <span key={i} />;
          const x = days.get(iso);
          return (
            <button key={iso} className={`md ${x ? dayCls(x) : 'k-none'} ${iso === sel ? 'sel' : ''} ${iso === today ? 'today' : ''}`}
              aria-label={`${prettyDay(iso)}: ${x ? x.title : 'nothing planned'}`} onClick={() => { onPick(iso); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
              {Number(iso.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Check off the throw and say how it felt. Saved for the coaches. */
function ThrowLogCard({ me, d }: { me: Person; d: ThrowDay }) {
  const [log, setLog] = useState<ThrowLog | null | undefined>(undefined);
  const [done, setDone] = useState(false);
  const [feel, setFeel] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setLog(undefined); setEditing(false); setErr(null);
    api.throwLogs({ personId: me.id, from: d.day, to: d.day }).then(r => {
      const l = r[0] ?? null; setLog(l); setDone(l?.done ?? false); setFeel(l?.feel ?? '');
    }).catch(() => setLog(null));
  }, [me.id, d.day]);
  if (log === undefined) return null;

  const submit = async () => {
    if (!done && !feel.trim()) { setErr('Check the box or add a note first.'); return; }
    setBusy(true); setErr(null);
    try {
      const saved = await api.logThrow({ person_id: me.id, day: d.day, program_id: d.program_id, title: d.title, done, feel: feel.trim() || null });
      setLog(saved); setEditing(false);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  if (log && !editing) return (
    <div className="card throw-log saved" style={{ gap: 8 }}>
      <div className="row">
        <h2>{log.done ? 'Throw done' : 'Throw logged'}</h2>
        {log.done ? <span className="pill-green">✓ Done</span> : <span className="pill-soft">Not done</span>}
      </div>
      {log.feel ? <div className="feel">"{log.feel}"</div> : <div className="small muted">No notes.</div>}
      <button className="link-btn" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={() => setEditing(true)}>Edit</button>
    </div>
  );
  return (
    <div className="card throw-log" style={{ gap: 10 }}>
      <h2>Log your throw</h2>
      <label className="check-row">
        <input type="checkbox" checked={done} onChange={e => setDone(e.target.checked)} />
        <span>{d.day === isoDay() ? "I finished today's throw" : 'I finished this throw'}</span>
      </label>
      <label className="field">How did it feel? <span className="muted">(optional)</span>
        <textarea className="input" rows={3} maxLength={1000} value={feel} onChange={e => setFeel(e.target.value)}
          placeholder="Arm felt loose, a little tight in the forearm early, ball was coming out good at the end…" />
      </label>
      {err && <div className="small" style={{ color: '#FF9C9C' }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Submit'}</button>
        {log && <button className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>}
      </div>
      <span className="small muted">Your coaches see this. Late is fine: pick the day on the calendar below.</span>
    </div>
  );
}
