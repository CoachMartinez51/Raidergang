import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { addDays, isoDay, prettyDay } from '../lib/dates';
import { scheduleFor, setHasValue, type BlockDay, type Scheduled, type SetLog } from '../lib/lifts';
import { rpeColor, rpeText } from '../lib/rpe';
import { sprintOfWeek, fmtTime, type SprintResult } from '../lib/sprints';
import type { Checkin, Goal, GoalKind, GoodsItem, Person } from '../lib/types';
import { ErrorMsg, RpeBadge, RpePicker, TopBar } from '../ui/common';
import { GoodsCard, goodsDayFor } from '../ui/Goods';
import { LiftToday } from './Lift';
import { ThrowingTab, useThrowToday } from './Throwing';
import { dayChip, PLYO_LABEL } from '../lib/throwing';
import { MyVideos } from '../ui/Videos';
import { MedalTeaser, Medalists, SprintCard } from '../ui/Sprints';
import { ReminderCard } from '../ui/Reminders';
import { ProgressTab } from './Progress';

type Tab = 'today' | 'throw' | 'lift' | 'me';
/** Agenda steps point at a tab, optionally a spot on it. */
type Target = Tab | `${Tab}#${string}`;

export function AthleteHome({ me, preview }: { me: Person; preview?: { onExit: () => void } }) {
  const today = isoDay();
  const [tab, setTab] = useState<Tab>('today');
  const [version, setVersion] = useState(0);
  const go = (t: Target) => {
    const [tb, anchor] = t.split('#') as [Tab, string | undefined];
    setTab(tb);
    if (anchor) setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
    else window.scrollTo(0, 0);
  };
  const tabs: [Tab, string][] = [['today', 'Today'], ...(me.is_pitcher ? [['throw', 'Throw'] as [Tab, string]] : []), ['lift', 'Lift'], ['me', 'Me']];

  return (
    <div className="shell">
      {preview && (
        <div className="preview-bar">
          <span>Previewing as <b>{me.first_name} {me.last_name}</b>. Nothing you tap is saved.</span>
          <button className="btn small" onClick={preview.onExit}>Exit preview</button>
        </div>
      )}
      <TopBar me={me} sub={prettyDay(today, { weekday: 'short', month: 'short', day: 'numeric' })} />
      <nav className="tabs tabs-even" aria-label="Sections">
        {tabs.map(([k, label]) => (
          <button key={k} className={`tab ${tab === k ? 'on' : ''}`} aria-current={tab === k ? 'page' : undefined} onClick={() => go(k)}>{label}</button>
        ))}
      </nav>
      <div className="content">
        {tab === 'today' && (
          <>
            <CheckinCard me={me} day={today} onSaved={() => setVersion(v => v + 1)} />
            <ReminderCard />
            <Agenda key={version} me={me} go={go} />
            {me.is_pitcher && <Objectives me={me} />}
            <MedalTeaser me={me} onOpen={() => go('me#medalists')} />
          </>
        )}
        {tab === 'throw' && (
          <>
            <ThrowingTab me={me} goods={<PreThrowGoods me={me} today={today} />} />
            <NextButton label="Next: Today's lift" onClick={() => go('lift')} />
          </>
        )}
        {tab === 'lift' && (
          <>
            <LiftToday me={me} />
            <div id="sprints" className="anchor"><SprintCard me={me} /></div>
          </>
        )}
        {tab === 'me' && (
          <>
            <WeekStrip key={version} me={me} />
            <ProgressTab me={me} />
            <div id="medalists" className="anchor"><Medalists me={me} /></div>
            <div id="videos" className="anchor"><MyVideos personId={me.id} showEmpty /></div>
          </>
        )}
      </div>
    </div>
  );
}

/** Pre-Throw: the Goods, showing half or full plyos to match today's throw. */
function PreThrowGoods({ me, today }: { me: Person; today: string }) {
  const t = useThrowToday(me.id);
  if (t === undefined) return <div className="card"><h2>The Goods</h2><div className="small muted">Loading…</div></div>;
  return <GoodsCard personId={me.id} note={me.goods_note} date={today} plyos={t.day ? t.day.plyos : undefined} />;
}

function NextButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button className="btn next-btn" onClick={onClick}>{label} →</button>;
}

// ---------------------------------------------------------------------
// Today's agenda: Pre-Throw → Catch Play → Sprints → Lift
// ---------------------------------------------------------------------
interface AgendaData { sched: Scheduled | null; goods: GoodsItem[]; logs: SetLog[]; sprints: SprintResult[] }

const liftTitle = (d: BlockDay) =>
  d.focus === 'lower' ? "Today's Lower Body Lift" : d.focus === 'upper' ? "Today's Upper Body Lift" : `Today's lift: ${d.label}`;

function Agenda({ me, go }: { me: Person; go: (t: Target) => void }) {
  const today = isoDay();
  const throwToday = useThrowToday(me.id);
  const [d, setD] = useState<AgendaData | null>(null);
  useEffect(() => {
    Promise.all([
      api.listBlocks(), api.assignmentsFor(me.id), api.currentGoods(me.id).catch(() => [] as GoodsItem[]),
      api.setLogs({ personId: me.id, from: today, to: today }), api.sprintResults(me.id).catch(() => [] as SprintResult[]),
    ]).then(([blocks, asg, goods, logs, sprints]) => setD({ sched: scheduleFor(today, asg, blocks), goods, logs, sprints }))
      .catch(() => setD({ sched: null, goods: [], logs: [], sprints: [] }));
  }, [me.id, today]);

  if (!d) return <div className="card"><h2>Today's agenda</h2><div className="small muted">Loading…</div></div>;

  const day = d.sched?.day ?? null;
  const week = d.sched?.week ?? 1;
  const sprint = day && d.sched ? (day.sprints?.[week - 1] ? sprintOfWeek(d.sched.block, week) : null) : null;
  const sprintToday = sprint ? d.sprints.filter(r => r.sprint === sprint && r.run_date === today) : [];
  const bestToday = sprintToday.length ? Math.min(...sprintToday.map(r => Number(r.seconds))) : null;

  const totalSets = day ? day.exercises.reduce((n, e) => n + (e.weeks[week - 1]?.sets ?? 0), 0) : 0;
  const doneSets = day ? new Set(d.logs.filter(l => day.exercises.some(e => e.id === l.block_exercise_id) && setHasValue(l))
    .map(l => `${l.block_exercise_id}|${l.set_number}`)).size : 0;
  const gDay = goodsDayFor(today);
  const goodsCount = d.goods.filter(g => g.day === gDay || (g.day !== 'A' && g.day !== 'B')).length;

  const steps: { title: string; sub: string; status?: string; done?: boolean; dim?: boolean; tab: Target }[] = [];
  if (goodsCount || me.is_pitcher) steps.push({ title: 'Pre-Throw', sub: d.goods.length ? `The Goods · ${gDay ? `Day ${gDay} · ` : ''}${goodsCount} items` : 'The Goods · nothing assigned yet', tab: 'throw#goods' });
  const td = throwToday?.day ?? null;
  if (me.is_pitcher || td) {
    if (throwToday === undefined) steps.push({ title: 'Catch Play', sub: 'Loading…', dim: true, tab: 'throw' });
    else if (!throwToday.program) steps.push({ title: 'Catch Play', sub: 'No throwing program assigned yet', dim: true, tab: 'throw' });
    else if (!td || td.kind === 'Off') steps.push({ title: 'Catch Play', sub: td && /holiday|thanksgiving|christmas|new year/i.test(td.title + ' ' + (td.note ?? '')) ? 'Holiday · no throwing' : 'Off today · full rest', status: 'Off', dim: true, tab: 'throw' });
    else steps.push({
      title: 'Catch Play', sub: [td.sp_title && td.sp_title !== td.title ? 'Live outing' : td.title, PLYO_LABEL[td.plyos]].join(' · '),
      status: throwToday.log?.done ? 'Done' : dayChip(td), done: !!throwToday.log?.done, tab: 'throw',
    });
  }
  if (sprint) steps.push({
    title: `Sprints · ${sprint}`, sub: day!.sprints[week - 1].replace(/^\s*\d+\s*\/\s*10\s*:?\s*/, '') || 'Log your best rep',
    status: bestToday != null ? `Best ${fmtTime(bestToday)}` : 'Log time', done: bestToday != null, tab: 'lift#sprints',
  });
  if (day) steps.push({
    title: liftTitle(day), sub: [d.sched!.block.name + ` · Wk ${week}`, day.prep?.name].filter(Boolean).join(' · '),
    status: totalSets ? (doneSets >= totalSets ? 'Done' : `${doneSets} / ${totalSets} sets`) : undefined, done: totalSets > 0 && doneSets >= totalSets, tab: 'lift',
  });
  else steps.push({ title: 'No lift today', sub: d.sched ? 'Rest up. Tap to look at the week.' : 'No lift block assigned yet', dim: true, tab: 'lift' });

  return (
    <div className="card" style={{ gap: 0 }}>
      <div className="row" style={{ marginBottom: 4 }}>
        <h2>Today's agenda</h2>
        {d.sched && <span className="small muted">{d.sched.block.name} · Week {week}</span>}
      </div>
      {steps.map((s, i) => (
        <button key={s.title} className="agenda-step" onClick={() => go(s.tab)}>
          <span className={`step-num ${s.done ? 'done' : i === 0 ? 'first' : ''}`} aria-hidden="true">
            {s.done ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg> : i + 1}
          </span>
          <span style={{ flex: 1, minWidth: 0, opacity: s.dim ? 0.75 : 1 }}>
            <span className="step-title">{s.title}</span>
            <span className="small muted" style={{ display: 'block' }}>{s.sub}</span>
          </span>
          {s.status && <span className={`step-status ${s.done ? 'done' : ''}`}>{s.status}</span>}
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------
function CheckinCard({ me, day, onSaved }: { me: Person; day: string; onSaved: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState<Checkin | null>(null);
  const [editing, setEditing] = useState(false);
  const [weight, setWeight] = useState('');
  const [rpe, setRpe] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.checkinFor(me.id, day).then(c => { setSaved(c); setLoaded(true); }).catch(e => setError(e.message));
  }, [me.id, day]);

  const startEdit = () => {
    setWeight(saved?.bodyweight?.toString() ?? '');
    setRpe(saved?.readiness ?? 0);
    setNote(saved?.note ?? '');
    setEditing(true);
  };

  const w = parseFloat(weight);
  const weightOk = weight.trim() !== '' && !isNaN(w) && w >= 80 && w <= 450;
  const canSave = rpe > 0 && weightOk && !busy;

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const c = await api.saveCheckin({ person_id: me.id, checkin_date: day, bodyweight: Math.round(w * 10) / 10, readiness: rpe, note: note.trim() || null });
      setSaved(c); setEditing(false); onSaved();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  if (!loaded) return <div className="card"><h2>Daily check-in</h2><div className="muted small">Loading…</div><ErrorMsg error={error} /></div>;

  if (saved && !editing) {
    return (
      <div className="card">
        <div className="row">
          <h2>Daily check-in</h2>
          <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="pill-green">✓ Done</span>
            <button className="link" onClick={startEdit}>Edit</button>
          </span>
        </div>
        <div className="row" style={{ justifyContent: 'flex-start', gap: 14, fontSize: 15 }}>
          <span><b>{saved.bodyweight}</b> lb{me.goal_weight ? <span className="muted small"> · goal {me.goal_weight}</span> : null}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>RPE <RpeBadge n={saved.readiness} /></span>
        </div>
        {saved.note && <div className="small muted">{saved.note}</div>}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="row"><h2>Daily check-in</h2>{me.goal_weight && <span className="small muted">Goal: {me.goal_weight}</span>}</div>
      <label className="field">Bodyweight (lb)
        <input className="input" inputMode="decimal" placeholder="e.g. 201.4" value={weight} onChange={e => setWeight(e.target.value)} />
      </label>
      <span className="small muted">RPE</span>
      <RpePicker value={rpe} onChange={setRpe} />
      <label className="field">Note (optional)
        <input className="input" style={{ fontSize: 15 }} placeholder="Sleep, soreness, where you weighed in" value={note} maxLength={500} onChange={e => setNote(e.target.value)} />
      </label>
      <ErrorMsg error={error} />
      <div style={{ display: 'flex', gap: 8 }}>
        {saved && <button className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>}
        <button className="btn" style={{ flex: 1 }} disabled={!canSave} onClick={submit}>{busy ? 'Saving…' : 'Save check-in'}</button>
      </div>
    </div>
  );
}

const KINDS: [GoalKind, string][] = [['body', 'BODY'], ['ball', 'BALL'], ['game', 'GAME']];

function Objectives({ me }: { me: Person }) {
  const [goals, setGoals] = useState<Partial<Record<GoalKind, Goal>> | null>(null);
  useEffect(() => { api.currentGoals(me.id).then(setGoals).catch(() => setGoals({})); }, [me.id]);
  if (!goals) return null;
  return (
    <div className="card">
      <h2>Your objectives</h2>
      {KINDS.map(([k, label]) => (
        <div className="goal" key={k}>
          <b>{label}</b>
          <span className={goals[k] ? '' : 'muted'}>{goals[k]?.body ?? 'Not set yet. Your coach will add this with you.'}</span>
        </div>
      ))}
    </div>
  );
}

/** The past 7 days at a glance: RPE colour and bodyweight per day. */
function WeekStrip({ me }: { me: Person }) {
  const today = isoDay();
  const [rows, setRows] = useState<Checkin[] | null>(null);
  useEffect(() => { api.checkinHistory(me.id, 6).then(setRows).catch(() => setRows([])); }, [me.id]);
  if (!rows) return null;
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const by = new Map(rows.map(c => [c.checkin_date, c]));
  return (
    <div className="card">
      <div className="row"><h2>This past week</h2><span className="small muted">RPE · weight</span></div>
      <div className="week-strip">
        {days.map(dt => {
          const c = by.get(dt);
          return (
            <div key={dt} className="week-day">
              <span className="small muted">{prettyDay(dt, { weekday: 'short' })}</span>
              {c?.readiness
                ? <span className="week-rpe" style={{ background: rpeColor(c.readiness), color: rpeText(c.readiness) }}>{c.readiness}</span>
                : <span className="week-rpe empty" aria-label="No check-in" />}
              <span className="small">{c?.bodyweight ?? (dt === today ? 'Today' : '–')}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
