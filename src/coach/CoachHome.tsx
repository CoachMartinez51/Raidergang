import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { addDays, isoDay, prettyDay } from '../lib/dates';
import { RPE_FLAG_AT } from '../lib/rpe';
import { fullName, roleLabels, type Checkin, type Group, type Membership, type Person } from '../lib/types';
import { ErrorMsg, RpeBadge, TopBar } from '../ui/common';
import { PersonEditor } from './PersonEditor';
import { Library } from './Library';

type Tab = 'checkins' | 'roster' | 'library';

export interface RosterData { people: Person[]; groups: Group[]; members: Membership[]; }

export function CoachHome({ me }: { me: Person }) {
  const [tab, setTab] = useState<Tab>('checkins');
  const [data, setData] = useState<RosterData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Person | 'new' | null>(null);

  const reload = useCallback(async () => {
    try {
      const [people, groups, members] = await Promise.all([api.listPeople(), api.listGroups(), api.listMemberships()]);
      setData({ people, groups, members });
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const access = me.is_admin ? 'Admin' : me.coach_can_edit ? 'Coach' : 'Coach · view only';

  return (
    <div className="shell wide">
      <TopBar me={me} sub={`${access}${api.mode === 'demo' ? ' · Demo mode' : ''}`} />
      <div className="tabs">
        <button className={`tab ${tab === 'checkins' ? 'on' : ''}`} onClick={() => setTab('checkins')}>Check-ins</button>
        <button className={`tab ${tab === 'roster' ? 'on' : ''}`} onClick={() => setTab('roster')}>Roster</button>
        <button className={`tab ${tab === 'library' ? 'on' : ''}`} onClick={() => setTab('library')}>Library</button>
      </div>
      <div className="content">
        <ErrorMsg error={error} />
        {tab === 'library' ? <Library me={me} /> : !data ? <div className="muted small">Loading…</div> : tab === 'checkins'
          ? <CheckinBoard data={data} onOpen={p => setEditing(p)} />
          : <Roster me={me} data={data} onOpen={p => setEditing(p)} onAdd={() => setEditing('new')} />}
      </div>
      {editing && data && (
        <PersonEditor me={me} person={editing === 'new' ? null : editing} data={data}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
    </div>
  );
}

type Filter = 'all' | 'pitchers' | 'position' | string; // string = group id

function useFilter(data: RosterData) {
  const [filter, setFilter] = useState<Filter>('all');
  const athletes = useMemo(() => data.people.filter(p => p.active && !p.is_coach), [data.people]);
  const shown = useMemo(() => athletes.filter(p => {
    if (filter === 'all') return true;
    if (filter === 'pitchers') return p.is_pitcher;
    if (filter === 'position') return p.is_position_player;
    return data.members.some(m => m.group_id === filter && m.person_id === p.id);
  }), [athletes, filter, data.members]);
  const chips = (
    <div className="chips">
      {([['all', 'Everyone'], ['pitchers', 'Pitchers'], ['position', 'Position players']] as [Filter, string][])
        .concat(data.groups.map(g => [g.id, g.name] as [Filter, string]))
        .map(([k, label]) => <button key={k} className={`toggle ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{label}</button>)}
    </div>
  );
  return { shown, chips };
}

function CheckinBoard({ data, onOpen }: { data: RosterData; onOpen: (p: Person) => void }) {
  const [day, setDay] = useState(isoDay());
  const [rows, setRows] = useState<Checkin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { shown, chips } = useFilter(data);

  useEffect(() => { setRows(null); api.checkinsOn(day).then(setRows).catch(e => setError(e.message)); }, [day]);

  const byPerson = new Map((rows ?? []).map(c => [c.person_id, c]));
  const sorted = [...shown].sort((a, b) => {
    const ca = byPerson.get(a.id), cb = byPerson.get(b.id);
    if (!ca !== !cb) return ca ? -1 : 1;                       // checked in first
    if (ca && cb && ca.readiness !== cb.readiness) return (ca.readiness ?? 99) - (cb.readiness ?? 99); // lowest RPE first
    return a.last_name.localeCompare(b.last_name);
  });
  const done = shown.filter(p => byPerson.has(p.id));
  const flagged = done.filter(p => (byPerson.get(p.id)!.readiness ?? 99) <= RPE_FLAG_AT);
  const isToday = day === isoDay();

  return (
    <>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="btn ghost small" onClick={() => setDay(addDays(day, -1))}>‹</button>
          <span style={{ fontWeight: 600, minWidth: 130, textAlign: 'center' }}>{isToday ? 'Today' : prettyDay(day)}</span>
          <button className="btn ghost small" disabled={isToday} onClick={() => setDay(addDays(day, 1))}>›</button>
        </div>
        <span className="small muted">{done.length} of {shown.length} checked in{flagged.length ? ` · ${flagged.length} at RPE ${RPE_FLAG_AT} or below` : ''}</span>
      </div>
      {chips}
      <ErrorMsg error={error} />
      <div className="card scroll-x" style={{ padding: 6 }}>
        {!rows ? <div className="muted small" style={{ padding: 10 }}>Loading…</div> : (
          <table className="table">
            <thead><tr><th>Athlete</th><th>RPE</th><th>Weight</th><th>Note</th></tr></thead>
            <tbody>
              {sorted.map(p => {
                const c = byPerson.get(p.id);
                const low = c && (c.readiness ?? 99) <= RPE_FLAG_AT;
                return (
                  <tr key={p.id} className="click" onClick={() => onOpen(p)} style={low ? { boxShadow: 'inset 3px 0 0 #BB3A1C' } : undefined}>
                    <td><div style={{ fontWeight: 600 }}>{fullName(p)}</div><div className="small muted">{roleLabels(p).join(' · ')}</div></td>
                    <td><RpeBadge n={c?.readiness} /></td>
                    <td>{c?.bodyweight != null ? `${c.bodyweight} lb` : <span className="muted">–</span>}</td>
                    <td className="small" style={{ maxWidth: 320 }}>{c ? (c.note ?? '') : <span className="muted">Not checked in</span>}</td>
                  </tr>
                );
              })}
              {!sorted.length && <tr><td colSpan={4} className="muted small">No athletes in this view yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Roster({ me, data, onOpen, onAdd }: { me: Person; data: RosterData; onOpen: (p: Person) => void; onAdd: () => void }) {
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const term = q.trim().toLowerCase();
  const list = data.people
    .filter(p => showInactive || p.active)
    .filter(p => !term || [fullName(p), p.email, ...p.aliases].some(s => s.toLowerCase().includes(term)));
  const coaches = list.filter(p => p.is_coach);
  const athletes = list.filter(p => !p.is_coach);
  const groupNames = (id: string) => data.members.filter(m => m.person_id === id).map(m => data.groups.find(g => g.id === m.group_id)?.name).filter(Boolean).join(', ');

  const section = (title: string, rows: Person[]) => (
    <>
      <div className="section-title">{title} ({rows.length})</div>
      <div className="card scroll-x" style={{ padding: 6 }}>
        <table className="table">
          <thead><tr><th>Name</th><th>Role</th><th>Groups</th><th>Signed in</th></tr></thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.id} className="click" onClick={() => onOpen(p)} style={p.active ? undefined : { opacity: 0.5 }}>
                <td><div style={{ fontWeight: 600 }}>{fullName(p)}</div><div className="small muted">{p.email}</div></td>
                <td>{roleLabels(p).map(r => <span key={r} className={`chip ${r === 'Admin' ? 'gold' : ''}`}>{r}</span>)}{!p.active && <span className="chip">Inactive</span>}</td>
                <td className="small">{groupNames(p.id)}</td>
                <td className="small">{p.first_signed_in_at ? 'Yes' : <span className="muted">Not yet</span>}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="muted small">Nobody here yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );

  return (
    <>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <input className="input" style={{ maxWidth: 320 }} placeholder="Search name, email or alias" value={q} onChange={e => setQ(e.target.value)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`toggle ${showInactive ? 'on' : ''}`} onClick={() => setShowInactive(s => !s)}>Show inactive</button>
          {me.is_admin && <button className="btn small" onClick={onAdd}>+ Add person</button>}
        </div>
      </div>
      {section('Athletes', athletes)}
      {section('Coaches', coaches)}
    </>
  );
}
