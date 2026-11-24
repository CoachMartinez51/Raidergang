import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { isoDay, prettyDay } from '../lib/dates';
import { scheduleFor, setHasValue, type Assignment, type LiftBlock, type SetLog } from '../lib/lifts';
import { RPE_FLAG_AT } from '../lib/rpe';
import type { ThrowAssignment, ThrowDay, ThrowLog } from '../lib/throwing';
import { fullName, type Checkin, type Person } from '../lib/types';
import { RpeBadge } from '../ui/common';
import { Medalists } from '../ui/Sprints';
import type { RosterData } from './CoachHome';

interface DayData {
  checkins: Checkin[];
  blocks: LiftBlock[]; assigns: Assignment[]; logs: SetLog[];
  throwAssign: ThrowAssignment[]; throwPlan: Map<string, ThrowDay>; throwLogs: ThrowLog[];
}

/** Coach → Today: the whole day on one screen. Tap a name to open his card. */
export function CoachToday({ me, data, onOpen, go }: {
  me: Person; data: RosterData; onOpen: (p: Person) => void; go: (tab: 'checkins' | 'lifts' | 'throwing' | 'sprints') => void;
}) {
  const today = isoDay();
  const [d, setD] = useState<DayData | null>(null);
  useEffect(() => {
    const safe = <T,>(p: Promise<T>, empty: T) => p.catch(() => empty);
    Promise.all([
      safe(api.checkinsOn(today), [] as Checkin[]),
      safe(api.listBlocks(), [] as LiftBlock[]), safe(api.assignmentsFor(null), [] as Assignment[]),
      safe(api.setLogs({ from: today, to: today }), [] as SetLog[]),
      safe(api.throwAssignments(), [] as ThrowAssignment[]),
      safe(api.throwPrograms().then(ps => Promise.all(ps.map(p => api.throwDays(p.id, today, today)))).then(x => x.flat()), [] as ThrowDay[]),
      safe(api.throwLogs({ personId: null, from: today, to: today }), [] as ThrowLog[]),
    ]).then(([checkins, blocks, assigns, logs, throwAssign, days, throwLogs]) =>
      setD({ checkins, blocks, assigns, logs, throwAssign, throwPlan: new Map(days.map(x => [x.program_id, x])), throwLogs }));
  }, [today]);

  const athletes = data.people.filter(p => p.active && !p.is_coach).sort((a, b) => a.last_name.localeCompare(b.last_name));
  if (!d) return <div className="small muted">Loading today…</div>;

  // Check-ins
  const ci = new Map(d.checkins.map(c => [c.person_id, c]));
  const notIn = athletes.filter(p => !ci.has(p.id));
  const low = athletes.filter(p => (ci.get(p.id)?.readiness ?? 99) <= RPE_FLAG_AT);

  // Lifts
  const lifting = athletes.map(p => {
    const s = scheduleFor(today, d.assigns.filter(a => a.person_id === p.id), d.blocks);
    return { p, s, n: d.logs.filter(l => l.person_id === p.id && setHasValue(l)).length };
  }).filter(r => r.s?.day);
  const liftedN = lifting.filter(r => r.n > 0).length;

  // Throwing
  const throwers = athletes.filter(p => p.is_pitcher).map(p => {
    const pid = d.throwAssign.find(a => a.person_id === p.id)?.program_id;
    const day = pid ? d.throwPlan.get(pid) ?? null : null;
    return { p, day, log: d.throwLogs.find(l => l.person_id === p.id) ?? null };
  }).filter(r => r.day && r.day.kind !== 'Off');
  const thrownN = throwers.filter(r => r.log?.done).length;
  const notes = d.throwLogs.filter(l => l.feel);

  const Name = ({ p, extra }: { p: Person; extra?: React.ReactNode }) => (
    <button className="name-chip" onClick={() => onOpen(p)}>{fullName(p)}{extra}</button>
  );
  const Stat = ({ n, of, label }: { n: number; of: number; label: string }) => (
    <div className="stat"><b>{n}<span className="muted"> / {of}</span></b><span>{label}</span></div>
  );

  return (
    <>
      <div className="row"><h2 style={{ margin: 0, fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 22 }}>{prettyDay(today, { weekday: 'long', month: 'short', day: 'numeric' })}</h2></div>
      <div className="stat-row">
        <Stat n={athletes.length - notIn.length} of={athletes.length} label="checked in" />
        <Stat n={liftedN} of={lifting.length} label="lifted" />
        <Stat n={thrownN} of={throwers.length} label="threw (checked off)" />
      </div>

      <div className="card" style={{ gap: 10 }}>
        <div className="row"><h2>Check-ins</h2><button className="link-btn" onClick={() => go('checkins')}>All check-ins ›</button></div>
        {low.length > 0 && (
          <div className="flag-box">
            <span className="small" style={{ fontWeight: 700 }}>RPE {RPE_FLAG_AT} or below</span>
            <div className="chips">{low.map(p => <Name key={p.id} p={p} extra={<RpeBadge n={ci.get(p.id)!.readiness} />} />)}</div>
          </div>
        )}
        {notIn.length ? (
          <>
            <span className="small muted">Not checked in yet ({notIn.length})</span>
            <div className="chips">{notIn.map(p => <Name key={p.id} p={p} />)}</div>
          </>
        ) : <span className="small" style={{ color: 'var(--green-text)' }}>✓ Everyone has checked in.</span>}
      </div>

      <div className="card" style={{ gap: 10 }}>
        <div className="row"><h2>Lifts</h2><button className="link-btn" onClick={() => go('lifts')}>Who lifted ›</button></div>
        {!lifting.length ? <span className="small muted">No lift scheduled today.</span> : (
          <>
            <span className="small muted">{lifting[0].s!.block.name} · Week {lifting[0].s!.week} · {lifting[0].s!.day!.label}</span>
            {lifting.some(r => !r.n) ? (
              <>
                <span className="small muted">Haven't logged a set yet ({lifting.filter(r => !r.n).length})</span>
                <div className="chips">{lifting.filter(r => !r.n).map(r => <Name key={r.p.id} p={r.p} />)}</div>
              </>
            ) : <span className="small" style={{ color: 'var(--green-text)' }}>✓ Everyone has logged.</span>}
          </>
        )}
      </div>

      <div className="card" style={{ gap: 10 }}>
        <div className="row"><h2>Throwing</h2><button className="link-btn" onClick={() => go('throwing')}>Throw logs ›</button></div>
        {!throwers.length ? <span className="small muted">Nobody is scheduled to throw today.</span> : throwers.some(r => !r.log?.done) && (
          <>
            <span className="small muted">Not checked off yet ({throwers.filter(r => !r.log?.done).length})</span>
            <div className="chips">{throwers.filter(r => !r.log?.done).map(r => <Name key={r.p.id} p={r.p} />)}</div>
          </>
        )}
        {notes.length > 0 && <span className="small muted">How it felt</span>}
        {notes.map(l => {
          const p = data.people.find(x => x.id === l.person_id);
          return (
            <div key={l.id} className="log-row" style={{ borderTop: 'none', paddingTop: 0 }}>
              <button className="link-btn" style={{ alignSelf: 'flex-start', padding: 0, color: 'var(--text)' }} onClick={() => p && onOpen(p)}>{p ? fullName(p) : 'Athlete'}</button>
              <div className="feel">"{l.feel}"</div>
            </div>
          );
        })}
      </div>

      <Medalists me={me} />
    </>
  );
}
