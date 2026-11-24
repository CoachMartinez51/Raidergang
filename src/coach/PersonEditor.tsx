import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { prettyDay } from '../lib/dates';
import { emptyPerson, fullName, type Checkin, type Goal, type GoalKind, type Person, type PersonDraft } from '../lib/types';
import { ErrorMsg, RpeBadge } from '../ui/common';
import type { RosterData } from './CoachHome';
import { GoodsCard } from '../ui/Goods';
import { WeightChart } from '../ui/WeightChart';
import { RehabPanel } from './Lifts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KINDS: [GoalKind, string][] = [['body', 'BODY'], ['ball', 'BALL'], ['game', 'GAME']];

export function PersonEditor({ me, person, data, onClose, onSaved }: {
  me: Person; person: Person | null; data: RosterData; onClose: () => void; onSaved: () => void;
}) {
  const isNew = !person;
  const canEdit = me.coach_can_edit;
  const isAdmin = me.is_admin;
  const [d, setD] = useState<PersonDraft>(() => person ? { ...person } : emptyPerson());
  const [aliases, setAliases] = useState((person?.aliases ?? []).join(', '));
  const [groupIds, setGroupIds] = useState<string[]>(() => person ? data.members.filter(m => m.person_id === person.id).map(m => m.group_id) : []);
  const [groups, setGroups] = useState(data.groups);
  const [newGroup, setNewGroup] = useState('');
  const [goals, setGoals] = useState<Partial<Record<GoalKind, Goal>>>({});
  const [goalText, setGoalText] = useState<Record<GoalKind, string>>({ body: '', ball: '', game: '' });
  const [history, setHistory] = useState<Checkin[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!person) return;
    api.currentGoals(person.id).then(g => {
      setGoals(g);
      setGoalText({ body: g.body?.body ?? '', ball: g.ball?.body ?? '', game: g.game?.body ?? '' });
    }).catch(() => {});
    api.checkinHistory(person.id, 30).then(setHistory).catch(() => {});
  }, [person]);

  const set = <K extends keyof PersonDraft>(k: K, v: PersonDraft[K]) => setD(x => ({ ...x, [k]: v }));
  const isSelf = person?.id === me.id;
  const valid = d.first_name.trim() && d.last_name.trim() && EMAIL_RE.test(d.email.trim())
    && (d.is_coach || d.is_pitcher || d.is_position_player || d.is_individual_pro);

  const addGroup = async () => {
    const name = newGroup.trim(); if (!name) return;
    try { const g = await api.createGroup(name); setGroups(gs => [...gs, g]); setGroupIds(ids => [...ids, g.id]); setNewGroup(''); }
    catch (e) { setError((e as Error).message); }
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const draft: PersonDraft = {
        ...d,
        first_name: d.first_name.trim(), last_name: d.last_name.trim(), email: d.email.trim().toLowerCase(),
        aliases: aliases.split(',').map(s => s.trim()).filter(Boolean),
        trackman_pitcher_id: d.trackman_pitcher_id?.trim() || null,
        goal_weight: d.goal_weight?.trim() || null,
        goods_note: d.goods_note?.trim() || null,
        coach_can_edit: d.is_coach ? d.coach_can_edit || d.is_admin : true,
        is_admin: d.is_coach && d.is_admin,
      };
      const saved = isNew ? await api.addPerson(draft) : await api.updatePerson(person!.id, draft);
      await api.setGroups(saved.id, groupIds);
      if (draft.is_pitcher) {
        for (const [k] of KINDS) {
          const t = goalText[k].trim();
          if (t && t !== (goals[k]?.body ?? '')) await api.addGoal(saved.id, k, t);
        }
      }
      onSaved();
    } catch (e) {
      const m = (e as Error).message;
      setError(/duplicate|unique/i.test(m) ? 'That email is already on the roster.' : m);
    }
    setBusy(false);
  };

  const Toggle = ({ on, label, onClick, disabled }: { on: boolean; label: string; onClick: () => void; disabled?: boolean }) => (
    <button type="button" className={`toggle ${on ? 'on' : ''}`} disabled={disabled} onClick={onClick} style={disabled ? { opacity: 0.6, cursor: 'default' } : undefined}>{label}</button>
  );

  const ro = !canEdit;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div className="drawer" style={{ width: '100%', maxWidth: 520, height: '100%', overflowY: 'auto', background: 'var(--bg)', borderLeft: '1px solid var(--line)', padding: 'calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 40px)', display: 'flex', flexDirection: 'column', gap: 14 }}
        onClick={e => e.stopPropagation()}>
        <div className="row">
          <h2 style={{ margin: 0, fontFamily: "'Space Grotesk', Inter, sans-serif" }}>{isNew ? 'Add person' : fullName(person!)}</h2>
          <button className="btn ghost small close-btn" onClick={onClose}>Close</button>
        </div>
        {ro && <div className="msg info">You have view-only access.</div>}

        <div className="card">
          <div className="grid2">
            <label className="field">First name<input className="input" disabled={ro} value={d.first_name} onChange={e => set('first_name', e.target.value)} /></label>
            <label className="field">Last name<input className="input" disabled={ro} value={d.last_name} onChange={e => set('last_name', e.target.value)} /></label>
          </div>
          <label className="field">Gmail they'll sign in with
            <input className="input" type="email" autoCapitalize="none" disabled={ro || (!isNew && !isAdmin)} value={d.email} onChange={e => set('email', e.target.value)} />
          </label>
          <label className="field">Other spellings (comma separated)
            <input className="input" disabled={ro} placeholder="e.g. Galuski, Galusky" value={aliases} onChange={e => setAliases(e.target.value)} />
          </label>
          <label className="field">Goal weight (optional)
            <input className="input" disabled={ro} placeholder="e.g. 204-207" value={d.goal_weight ?? ''} onChange={e => set('goal_weight', e.target.value)} />
          </label>
          <label className="field">Note at the top of their Goods (optional)
            <textarea className="input" rows={2} maxLength={1000} disabled={ro} placeholder="e.g. Get after it this winter" value={d.goods_note ?? ''} onChange={e => set('goods_note', e.target.value)} />
          </label>
          <label className="field">Trackman pitcher ID (optional)
            <input className="input" disabled={ro} value={d.trackman_pitcher_id ?? ''} onChange={e => set('trackman_pitcher_id', e.target.value)} />
          </label>
        </div>

        <div className="card">
          <span className="small muted">Athlete roles</span>
          <div className="chips">
            <Toggle disabled={ro} on={d.is_pitcher} label="Pitcher" onClick={() => set('is_pitcher', !d.is_pitcher)} />
            <Toggle disabled={ro} on={d.is_position_player} label="Position player" onClick={() => set('is_position_player', !d.is_position_player)} />
            <Toggle disabled={ro} on={d.is_individual_pro} label="Individual/Pro" onClick={() => set('is_individual_pro', !d.is_individual_pro)} />
          </div>
          <span className="small muted">Groups</span>
          <div className="chips">
            {groups.map(g => (
              <Toggle key={g.id} disabled={ro} on={groupIds.includes(g.id)} label={g.name}
                onClick={() => setGroupIds(ids => ids.includes(g.id) ? ids.filter(x => x !== g.id) : [...ids, g.id])} />
            ))}
          </div>
          {!ro && (
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" placeholder="New group name" value={newGroup} onChange={e => setNewGroup(e.target.value)} />
              <button className="btn ghost small" style={{ height: 44 }} onClick={addGroup}>Add</button>
            </div>
          )}
        </div>

        {isAdmin && (
          <div className="card">
            <span className="small muted">Coach access (admin only)</span>
            <div className="chips">
              <Toggle on={d.is_coach} label="Coach" disabled={isSelf} onClick={() => set('is_coach', !d.is_coach)} />
              {d.is_coach && <Toggle on={d.coach_can_edit} label="Can edit programs" disabled={d.is_admin} onClick={() => set('coach_can_edit', !d.coach_can_edit)} />}
              {d.is_coach && <Toggle on={d.is_admin} label="Admin" disabled={isSelf} onClick={() => set('is_admin', !d.is_admin)} />}
            </div>
            {!isNew && (
              <div className="row">
                <span className="small muted">{d.active ? 'Active: can sign in' : 'Inactive: cannot sign in, history kept'}</span>
                <Toggle on={d.active} label={d.active ? 'Active' : 'Inactive'} disabled={isSelf} onClick={() => set('active', !d.active)} />
              </div>
            )}
          </div>
        )}

        {d.is_pitcher && (
          <div className="card">
            <h2>Objectives</h2>
            <span className="small muted">Edits are saved as new versions; old goals stay in history.</span>
            {KINDS.map(([k, label]) => (
              <label key={k} className="field">{label}
                <textarea className="input" disabled={ro} value={goalText[k]} onChange={e => setGoalText(t => ({ ...t, [k]: e.target.value }))} />
              </label>
            ))}
          </div>
        )}

        <ErrorMsg error={error} />
        {!ro && <button className="btn" disabled={!valid || busy} onClick={save}>{busy ? 'Saving…' : isNew ? 'Add to roster' : 'Save changes'}</button>}
        {!valid && !ro && <span className="small muted">Needs a first and last name, a valid email, and at least one role.</span>}

        {!isNew && !person!.is_coach && <WeightChart personId={person!.id} goal={d.goal_weight} />}
        {!isNew && person!.is_pitcher && <GoodsCard personId={person!.id} note={d.goods_note} editable={!ro} />}
        {!isNew && !person!.is_coach && <RehabPanel me={me} person={person!} />}

        {!isNew && !d.is_coach && (
          <div className="card" style={{ gap: 8 }}>
            <h2>Check-ins · last 30 days</h2>
            {!history.length && <span className="small muted">None yet.</span>}
            {history.map(c => (
              <div key={c.id} className="row small">
                <span className="muted" style={{ width: 90 }}>{prettyDay(c.checkin_date)}</span>
                <span style={{ width: 70 }}>{c.bodyweight ?? '–'} lb</span>
                <span style={{ flex: 1 }} className="muted">{c.note ?? ''}</span>
                <RpeBadge n={c.readiness} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
