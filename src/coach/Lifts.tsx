import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { addDays, isoDay, prettyDay } from '../lib/dates';
import {
  exName, isoWeekday, rxText, scheduleFor, setHasValue, setText, WEEKDAY_LONG,
  type Assignment, type LiftBlock, type SetLog,
} from '../lib/lifts';
import { fullName, type Person } from '../lib/types';
import { ErrorMsg } from '../ui/common';
import { BlockPlanner } from './BlockPlanner';
import { PrintBlock } from '../ui/PrintBlock';
import type { RosterData } from './CoachHome';

type View = 'today' | 'blocks';

export function Lifts({ me, data }: { me: Person; data: RosterData }) {
  const [view, setView] = useState<View>('today');
  const [blocks, setBlocks] = useState<LiftBlock[] | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = () => Promise.all([api.listBlocks(), api.assignmentsFor(null)])
    .then(([b, a]) => { setBlocks(b); setAssignments(a); }).catch(e => setError(e.message));
  useEffect(() => { reload(); }, []);

  return (
    <>
      <div className="chips">
        <button className={`toggle ${view === 'today' ? 'on' : ''}`} onClick={() => setView('today')}>Who lifted</button>
        <button className={`toggle ${view === 'blocks' ? 'on' : ''}`} onClick={() => setView('blocks')}>Blocks & assigning</button>
      </div>
      <ErrorMsg error={error} />
      {!blocks ? <div className="small muted">Loading…</div> : view === 'today'
        ? <WhoLifted data={data} blocks={blocks} assignments={assignments} />
        : <Blocks me={me} data={data} blocks={blocks} assignments={assignments} onChanged={reload} />}
    </>
  );
}

function WhoLifted({ data, blocks, assignments }: { data: RosterData; blocks: LiftBlock[]; assignments: Assignment[] }) {
  const [day, setDay] = useState(isoDay());
  const [logs, setLogs] = useState<SetLog[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { setLogs(null); api.setLogs({ from: day, to: day }).then(setLogs).catch(() => setLogs([])); }, [day]);

  const athletes = data.people.filter(p => p.active && !p.is_coach);
  const rows = athletes.map(p => {
    const s = scheduleFor(day, assignments.filter(a => a.person_id === p.id), blocks);
    const mine = (logs ?? []).filter(l => l.person_id === p.id);
    const total = s?.day ? s.day.exercises.reduce((n, e) => n + (e.weeks[s.week - 1] ? (e.log_type === 'done' ? 1 : e.weeks[s.week - 1]!.sets) : 0), 0) : 0;
    const logged = mine.filter(setHasValue).length;
    return { p, s, mine, total, logged };
  }).filter(r => r.s?.day).sort((a, b) => (b.logged / (b.total || 1)) - (a.logged / (a.total || 1)) || a.p.last_name.localeCompare(b.p.last_name));
  const isToday = day === isoDay();

  return (
    <>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="btn ghost small" onClick={() => setDay(addDays(day, -1))}>‹</button>
          <span style={{ fontWeight: 600, minWidth: 130, textAlign: 'center' }}>{isToday ? 'Today' : prettyDay(day)}</span>
          <button className="btn ghost small" disabled={isToday} onClick={() => setDay(addDays(day, 1))}>›</button>
        </div>
        <span className="small muted">{rows.filter(r => r.logged > 0).length} of {rows.length} have logged</span>
      </div>
      {!rows.length && <div className="card small muted">No lift scheduled on {prettyDay(day)}.</div>}
      {rows.length > 0 && (
        <div className="card scroll-x" style={{ padding: 6 }}>
          <table className="table">
            <thead><tr><th>Athlete</th><th>Lift</th><th>Sets logged</th></tr></thead>
            <tbody>
              {rows.map(({ p, s, mine, total, logged }) => (
                <Fragment key={p.id}>
                  <tr key={p.id} className="click" onClick={() => setOpen(o => (o === p.id ? null : p.id))}>
                    <td style={{ fontWeight: 600 }}>{fullName(p)}</td>
                    <td className="small">{s!.block.name} · Wk {s!.week} · {s!.day!.label}</td>
                    <td>
                      <span className="chip" style={logged >= total && total ? { background: '#14241A', color: '#A9DDB5' } : logged ? { background: 'var(--gold-soft)', color: 'var(--gold)' } : undefined}>
                        {logged}/{total}
                      </span>
                    </td>
                  </tr>
                  {open === p.id && (
                    <tr key={p.id + '-d'}><td colSpan={3} style={{ background: '#151813' }}>
                      {s!.day!.exercises.map(e => {
                        const ls = mine.filter(l => l.block_exercise_id === e.id).sort((a, b) => a.set_number - b.set_number);
                        const vals = ls.map(setText).filter(v => v !== '');
                        return (
                          <div key={e.id} className="row small" style={{ padding: '4px 0' }}>
                            <span><b style={{ color: 'var(--gold)' }}>{e.slot}</b> {exName(e)} <span className="muted">· {rxText(e, s!.week)}</span>{ls.some(l => l.used_rehab) ? <span className="chip gold" style={{ marginLeft: 6 }}>Rehab</span> : null}</span>
                            <span style={{ fontWeight: 600 }}>{vals.length ? vals.join(', ') : <span className="muted">–</span>}</span>
                          </div>
                        );
                      })}
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const nextMonday = () => { const t = isoDay(); const wd = isoWeekday(t); return addDays(t, wd === 1 ? 0 : 8 - wd); };

function Blocks({ me, data, blocks, assignments, onChanged }: {
  me: Person; data: RosterData; blocks: LiftBlock[]; assignments: Assignment[]; onChanged: () => void;
}) {
  const [blockId, setBlockId] = useState(blocks[0]?.id ?? '');
  const block = blocks.find(b => b.id === blockId);
  const [week, setWeek] = useState(1);

  // assigning
  const [start, setStart] = useState(nextMonday());
  const [assigning, setAssigning] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const athletes = data.people.filter(p => p.active && !p.is_coach);
  const inGroup = (gid: string) => data.members.filter(m => m.group_id === gid).map(m => m.person_id);
  const pick = (ids: string[]) => setSel(s => { const all = ids.every(i => s.includes(i)); return all ? s.filter(x => !ids.includes(x)) : [...new Set([...s, ...ids])]; });
  const assigned = useMemo(() => block ? assignments.filter(a => a.block_id === block.id) : [], [assignments, block]);
  const starts = [...new Set(assigned.map(a => a.start_date))].sort();
  const [sure, setSure] = useState<string | null>(null);
  const onBlock = new Set(assigned.map(a => a.person_id)).size;
  // Default a new assignment to the block's main start date, so one more athlete joins the team's week.
  const mainStart = starts.slice().sort((a, b) => assigned.filter(x => x.start_date === b).length - assigned.filter(x => x.start_date === a).length)[0];

  if (!block) return <div className="card small muted">No blocks yet.</div>;
  const assign = async () => {
    setBusy(true); setMsg(null);
    try {
      const n = await api.assignBlock(block.id, sel, start);
      const skipped = sel.length - n;
      setMsg(`Assigned ${n} athlete${n === 1 ? '' : 's'} starting ${prettyDay(start)}.${skipped ? ` ${skipped} already on this block (skipped).` : ''}`);
      setSel([]); onChanged();
    }
    catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };

  return (
    <>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div className="chips">
          {blocks.map(b => <button key={b.id} className={`toggle ${b.id === blockId ? 'on' : ''}`} onClick={() => { setBlockId(b.id); setWeek(1); }}>{b.name}</button>)}
        </div>
        <button className="btn ghost small" onClick={() => setPrinting(true)}>Print / PDF</button>
      </div>
      {printing && <PrintBlock block={block} startDate={starts[0]} onClose={() => setPrinting(false)} />}
      {block.notes && <div className="small muted">{block.notes}</div>}
      <div className="chips">
        {Array.from({ length: block.weeks }, (_, i) => i + 1).map(w => <button key={w} className={`toggle ${w === week ? 'on' : ''}`} onClick={() => setWeek(w)}>Week {w}</button>)}
      </div>
      {me.coach_can_edit && (
        <div className="shared-banner">
          <b>Editing {block.name}</b> · changes here show up for {onBlock ? `all ${onBlock} athlete${onBlock === 1 ? '' : 's'} on this block` : 'everyone you assign to it'}.
          To change one player only, open his roster card → Lift block → Make his own copy.
        </div>
      )}
      <BlockPlanner me={me} block={block} week={week} onChanged={onChanged} />

      <div className="section-title">Assign {block.name}</div>
      <div className="card">
        <div className="small muted">Currently assigned:{!starts.length && ' nobody'}</div>
        {starts.map(st => {
          const here = assigned.filter(a => a.start_date === st);
          const few = here.length <= 5;
          return (
            <div key={st} className="start-row">
              <span className="small"><b>{here.length} athlete{here.length === 1 ? '' : 's'}</b> starting {prettyDay(st)}</span>
              {few && here.map(a => {
                const p = data.people.find(x => x.id === a.person_id);
                return (
                  <span key={a.id} className="start-chip">
                    {p ? fullName(p) : 'Athlete'}
                    {me.coach_can_edit && <button aria-label={`Remove ${p ? fullName(p) : 'athlete'}'s ${prettyDay(st)} start`}
                      onClick={async () => { if (sure !== a.id) { setSure(a.id); return; } await api.endAssignment(a.id); setSure(null); onChanged(); }}>
                      {sure === a.id ? 'Remove?' : '✕'}</button>}
                  </span>
                );
              })}
            </div>
          );
        })}
        {me.coach_can_edit && !assigning ? (
          <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => { setStart(mainStart && mainStart >= addDays(isoDay(), -60) ? mainStart : nextMonday()); setMsg(null); setAssigning(true); }}>Assign athletes…</button>
        ) : me.coach_can_edit ? (
          <>
            <label className="field" style={{ maxWidth: 220 }}>Week 1 starts (Monday)
              <input className="input" type="date" value={start} onChange={e => setStart(e.target.value)} />
            </label>
            <div className="chips">
              <button className="toggle" onClick={() => pick(athletes.map(p => p.id))}>Everyone</button>
              <button className="toggle" onClick={() => pick(athletes.filter(p => p.is_pitcher).map(p => p.id))}>Pitchers</button>
              <button className="toggle" onClick={() => pick(athletes.filter(p => p.is_position_player).map(p => p.id))}>Position players</button>
              {data.groups.map(g => <button key={g.id} className="toggle" onClick={() => pick(inGroup(g.id))}>{g.name}</button>)}
              <button className="toggle" onClick={() => setSel([])}>Clear</button>
            </div>
            <div className="chips">
              {athletes.map(p => (
                <button key={p.id} className={`toggle ${sel.includes(p.id) ? 'on' : ''}`} style={{ height: 30 }} onClick={() => pick([p.id])}>{fullName(p)}</button>
              ))}
            </div>
            {msg && <div className="msg info">{msg}</div>}
            <button className="btn" disabled={!sel.length || busy || isoWeekday(start) !== 1} onClick={assign}>
              {isoWeekday(start) !== 1 ? 'Pick a Monday' : `Assign to ${sel.length} athlete${sel.length === 1 ? '' : 's'}`}
            </button>
            <span className="small muted">Anyone already on this block is skipped. To move one athlete to a new start date, remove his start first.</span>
            <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => { setAssigning(false); setSel([]); }}>Done</button>
          </>
        ) : <span className="small muted">You have view-only access.</span>}
      </div>
    </>
  );
}

/** Rehab switches for one athlete, used in the coach's player view. */
export function RehabPanel({ me, person }: { me: Person; person: Person }) {
  const [blocks, setBlocks] = useState<LiftBlock[] | null>(null);
  const [assign, setAssign] = useState<Assignment[]>([]);
  const [on, setOn] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([api.listBlocks(), api.assignmentsFor(person.id), api.rehabSwitches(person.id)])
      .then(([b, a, r]) => { setBlocks(b); setAssign(a); setOn(r.map(x => x.block_exercise_id)); }).catch(() => setBlocks([]));
  }, [person.id]);
  if (!blocks) return null;
  // current or next block for this athlete
  const today = isoDay();
  const current = scheduleFor(today, assign, blocks)?.block
    ?? blocks.find(b => assign.some(a => a.block_id === b.id && a.start_date >= today));
  if (!current) return null;
  const withRehab = current.days.flatMap(d => d.exercises.filter(e => e.rehab).map(e => ({ d, e })));
  if (!withRehab.length) return null;
  const toggle = async (id: string) => {
    setBusy(id);
    const isOn = on.includes(id);
    try { await api.setRehab(person.id, id, !isOn); setOn(o => isOn ? o.filter(x => x !== id) : [...o, id]); } catch { /* ignore */ }
    setBusy(null);
  };
  return (
    <div className="card" style={{ gap: 8 }}>
      <h2>Rehab options · {current.name}</h2>
      <span className="small muted">Switch an exercise to its rehab option for this athlete only.</span>
      {withRehab.map(({ d, e }) => (
        <div key={e.id} className="row small" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          <span><b>{WEEKDAY_LONG[d.weekday].slice(0, 3)} {e.slot}</b> {exName(e)}<div className="muted">{e.rehab}</div></span>
          <button className={`toggle ${on.includes(e.id) ? 'on' : ''}`} disabled={!me.coach_can_edit || busy === e.id} onClick={() => toggle(e.id)}>
            {on.includes(e.id) ? 'Rehab on' : 'Off'}
          </button>
        </div>
      ))}
    </div>
  );
}
