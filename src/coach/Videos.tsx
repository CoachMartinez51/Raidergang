import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { fullName, type Person, type Video } from '../lib/types';
import { ErrorMsg } from '../ui/common';
import { VideoRow } from '../ui/Videos';
import type { RosterData } from './CoachHome';

const TYPES = ['Bullpen', 'Live', 'Game', 'Flat Ground', 'Pulldown', 'Scrimmage', 'Drill Work'];

export function Videos({ me, data }: { me: Person; data: RosterData }) {
  const [rows, setRows] = useState<Video[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState<string>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => api.listVideos(null).then(setRows).catch(e => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const athletes = useMemo(() => data.people.filter(p => p.active && !p.is_coach)
    .sort((a, b) => Number(b.is_pitcher) - Number(a.is_pitcher) || a.last_name.localeCompare(b.last_name)), [data.people]);
  const nameOf = useMemo(() => new Map(data.people.map(p => [p.id, fullName(p)])), [data.people]);

  const inbox = (rows ?? []).filter(v => v.match_status === 'unmatched');
  const sorted = (rows ?? []).filter(v => v.match_status === 'auto' || v.match_status === 'manual')
    .filter(v => who === 'all' || v.person_id === who);

  const save = async (v: Video, patch: Parameters<typeof api.updateVideo>[1]) => {
    setError(null);
    try { await api.updateVideo(v.id, patch); await load(); } catch (e) { setError((e as Error).message); }
  };

  const recheck = async () => {
    setMsg(null);
    try { const n = await api.rematchVideos(); setMsg(n ? `${n} video${n === 1 ? '' : 's'} matched.` : 'Nothing new matched.'); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  if (!rows) return <div className="muted small">Loading…<ErrorMsg error={error} /></div>;

  return (
    <>
      <ErrorMsg error={error} />
      <div className="section-title">Inbox · titles the app couldn't read ({inbox.length})</div>
      <div className="card" style={{ gap: 10 }}>
        {!inbox.length && <div className="small muted">All caught up. New uploads to @WrightStatePitching show up here if the title doesn't name one pitcher.</div>}
        {inbox.map(v => (
          <InboxItem key={v.id} v={v} athletes={athletes} canEdit={me.coach_can_edit}
            open={open === v.id} onToggle={() => setOpen(o => o === v.id ? null : v.id)}
            onAssign={(personId, type) => save(v, { person_id: personId, match_status: 'manual', video_type: type || v.video_type })}
            onIgnore={() => save(v, { match_status: 'ignored', person_id: null })} />
        ))}
        {me.coach_can_edit && (
          <div className="row">
            <span className="small muted">Added an athlete or a nickname? Try the inbox again.</span>
            <button className="btn ghost small" onClick={recheck}>Re-check</button>
          </div>
        )}
        {msg && <div className="small muted">{msg}</div>}
      </div>

      <div className="row">
        <div className="section-title">Videos by athlete ({sorted.length})</div>
        <select className="input" style={{ maxWidth: 240, height: 38 }} value={who} onChange={e => setWho(e.target.value)}>
          <option value="all">All athletes</option>
          {athletes.map(p => <option key={p.id} value={p.id}>{fullName(p)}</option>)}
        </select>
      </div>
      <div className="card" style={{ gap: 8 }}>
        {!sorted.length && <div className="small muted">No videos yet.</div>}
        {sorted.slice(0, 200).map(v => (
          <VideoRow key={v.id} v={v} open={open === v.id} onToggle={() => setOpen(o => o === v.id ? null : v.id)}
            extra={<div className="row small">
              <span className="muted">{nameOf.get(v.person_id ?? '') ?? '—'}{v.match_status === 'manual' ? ' · sorted by a coach' : ''}</span>
              {me.coach_can_edit && <button className="link" onClick={() => save(v, { match_status: 'unmatched', person_id: null })}>Wrong athlete?</button>}
            </div>} />
        ))}
      </div>
    </>
  );
}

function InboxItem({ v, athletes, canEdit, open, onToggle, onAssign, onIgnore }: {
  v: Video; athletes: Person[]; canEdit: boolean; open: boolean; onToggle: () => void;
  onAssign: (personId: string, type: string) => void; onIgnore: () => void;
}) {
  const [pid, setPid] = useState('');
  const [type, setType] = useState(v.video_type ?? '');
  return (
    <VideoRow v={v} open={open} onToggle={onToggle} extra={
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {v.match_note && <span className="small muted">{v.match_note}</span>}
        {canEdit && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <select className="input" style={{ flex: '2 1 160px', height: 38 }} value={pid} onChange={e => setPid(e.target.value)}>
              <option value="">Whose video?</option>
              {athletes.map(p => <option key={p.id} value={p.id}>{fullName(p)}</option>)}
            </select>
            <select className="input" style={{ flex: '1 1 110px', height: 38 }} value={type} onChange={e => setType(e.target.value)}>
              <option value="">Type</option>
              {[...new Set([...TYPES, ...(v.video_type ? [v.video_type] : [])])].map(t => <option key={t}>{t}</option>)}
            </select>
            <button className="btn small" disabled={!pid} onClick={() => onAssign(pid, type)}>Save</button>
            <button className="btn ghost small" onClick={onIgnore}>Not a player video</button>
          </div>
        )}
      </div>
    } />
  );
}
