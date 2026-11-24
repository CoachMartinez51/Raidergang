import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { addDays, isoDay, prettyDay } from '../lib/dates';
import { scheduleFor, weekOf, type Assignment, type LiftBlock } from '../lib/lifts';
import type { Person } from '../lib/types';
import { ErrorMsg } from '../ui/common';

/** On the roster card: which lift block(s) he's on and from when, with a way to take one off. */
export function PlayerBlocks({ me, person }: { me: Person; person: Person }) {
  const ro = !me.coach_can_edit;
  const [asg, setAsg] = useState<Assignment[] | null>(null);
  const [blocks, setBlocks] = useState<LiftBlock[]>([]);
  const [sure, setSure] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => Promise.all([api.assignmentsFor(person.id), api.listBlocks()])
    .then(([a, b]) => { setAsg(a.filter(x => x.active).sort((x, y) => y.start_date.localeCompare(x.start_date))); setBlocks(b); })
    .catch(e => setError((e as Error).message));
  useEffect(() => { load(); }, [person.id]);
  if (!asg) return null;

  const today = isoDay();
  const now = scheduleFor(today, asg, blocks);
  const nextMon = addDays(today, ((8 - new Date(today + 'T12:00:00Z').getUTCDay()) % 7) || 7);
  const next = scheduleFor(nextMon, asg, blocks);
  const makeCopy = async (a: Assignment) => {
    const b = blocks.find(x => x.id === a.block_id); if (!b) return;
    if (copying !== a.id) { setCopying(a.id); return; }
    setError(null);
    try {
      const id = await api.copyBlock(b.id, `${b.name} · ${person.last_name}`);
      await api.endAssignment(a.id);
      await api.assignBlock(id, [person.id], a.start_date);
      setCopying(null); setMsg(`${person.first_name} now has his own copy: "${b.name} · ${person.last_name}". Edit it in Lifts → Blocks; only he sees the changes.`);
      await load();
    } catch (e) { setError((e as Error).message); }
  };
  const remove = async (id: string) => {
    if (sure !== id) { setSure(id); return; }
    setError(null);
    try { await api.endAssignment(id); setSure(null); await load(); } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="card" style={{ gap: 8 }}>
      <h2>Lift block</h2>
      {!asg.length ? <div className="small muted">Not on a lift block.</div> : (
        <>
          <div className="small">
            Today: <b>{now ? `${now.block.name} · Week ${now.week}` : 'no lift block'}</b>
            {next && (!now || next.assignment.id !== now.assignment.id || next.week !== now.week) && <> · next Monday: <b>{next.block.name} · Week {next.week}</b></>}
          </div>
          {asg.some(a => asg.some(b => b.id !== a.id && b.block_id === a.block_id)) && (
            <div className="msg info small">He has two starts on the same block. The newest one restarts him at Week 1 on that date. Remove the one you don't want.</div>
          )}
          {asg.map(a => {
            const b = blocks.find(x => x.id === a.block_id);
            const wk = b ? weekOf(a.start_date, b.weeks, today) : null;
            return (
              <div key={a.id} className="log-row">
                <div className="row">
                  <span style={{ fontWeight: 600 }}>{b?.name ?? 'Block'}</span>
                  {!ro && <button className={`goods-x ${sure === a.id ? 'sure' : ''}`} onClick={() => remove(a.id)}>{sure === a.id ? 'Remove this start' : '✕'}</button>}
                </div>
                <span className="small muted">Starts {prettyDay(a.start_date, { weekday: 'short', month: 'short', day: 'numeric' })}
                  {a.start_date > today ? ' (hasn\'t started yet)' : wk ? ` · Week ${wk} now` : ' · finished'}</span>
                {!ro && b && !b.name.endsWith(` · ${person.last_name}`) && (
                  <button className="link-btn" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={() => makeCopy(a)}>
                    {copying === a.id ? `Tap again: copy ${b.name} just for ${person.first_name}` : 'Make his own copy'}
                  </button>
                )}
              </div>
            );
          })}
          {msg && <div className="small" style={{ color: 'var(--green-text)' }}>{msg}</div>}
          <div className="small muted">Removing a start doesn't delete anything he logged. "Make his own copy" moves him to a private copy of the block (same start date), so you can change his lift without touching the team's. His past logs stay on the original.</div>
        </>
      )}
      <ErrorMsg error={error} />
    </div>
  );
}
