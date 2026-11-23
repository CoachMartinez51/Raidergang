import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { isoDay, prettyDay } from '../lib/dates';
import type { Checkin, Goal, GoalKind, Person } from '../lib/types';
import { ErrorMsg, RpeBadge, RpePicker, TopBar } from '../ui/common';
import { GoodsCard } from '../ui/Goods';

export function AthleteHome({ me }: { me: Person }) {
  const today = isoDay();
  const [version, setVersion] = useState(0);
  return (
    <div className="shell">
      <TopBar me={me} sub={prettyDay(today, { weekday: 'short', month: 'short', day: 'numeric' })} />
      <div className="content">
        <CheckinCard me={me} day={today} onSaved={() => setVersion(v => v + 1)} />
        {me.is_pitcher && <Objectives me={me} />}
        <div className="section-title">Today's agenda</div>
        {me.is_pitcher && <GoodsCard personId={me.id} />}
        <div className="card">
          <div className="muted small">
            {me.is_pitcher
              ? 'Warm-up, Lift Prep, The Meatshack and throwing will show here once your coaches publish your program.'
              : 'Lift Prep and The Meatshack will show here once your coaches publish your program.'}
          </div>
        </div>
        <RecentCheckins key={version} me={me} />
      </div>
    </div>
  );
}

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
          <button className="link" onClick={startEdit}>Edit</button>
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

function RecentCheckins({ me }: { me: Person }) {
  const [rows, setRows] = useState<Checkin[]>([]);
  useEffect(() => { api.checkinHistory(me.id, 30).then(setRows).catch(() => {}); }, [me.id]);
  if (!rows.length) return null;
  return (
    <>
      <div className="section-title">Last 30 days</div>
      <div className="card" style={{ gap: 8 }}>
        {rows.map(c => (
          <div className="row small" key={c.id}>
            <span className="muted" style={{ width: 90 }}>{prettyDay(c.checkin_date)}</span>
            <span style={{ flex: 1 }}>{c.bodyweight ?? '–'} lb{c.note ? <span className="muted"> · {c.note.length > 40 ? c.note.slice(0, 40) + '…' : c.note}</span> : null}</span>
            <RpeBadge n={c.readiness} />
          </div>
        ))}
      </div>
    </>
  );
}
