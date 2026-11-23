import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { prettyDay } from '../lib/dates';
import type { Video } from '../lib/types';

/** Unlisted videos play inside the app; "Open in YouTube" is the fallback. */
export function VideoPlayer({ video }: { video: Video }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%', borderRadius: 10, overflow: 'hidden', background: '#000' }}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${video.youtube_id}?rel=0&playsinline=1`}
          title={video.title}
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
        />
      </div>
      <a className="link small" style={{ alignSelf: 'flex-end' }} href={`https://youtu.be/${video.youtube_id}`} target="_blank" rel="noreferrer">Open in YouTube</a>
    </div>
  );
}

export const videoLabel = (v: Video) =>
  [v.recorded_on ? prettyDay(v.recorded_on, { weekday: 'short', month: 'short', day: 'numeric' }) : null, v.video_type].filter(Boolean).join(' · ') || v.title;

export function VideoRow({ v, open, onToggle, extra }: { v: Video; open: boolean; onToggle: () => void; extra?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
      <div className="row" style={{ cursor: 'pointer' }} onClick={onToggle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{videoLabel(v)}</span>
          <span className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.title}</span>
        </div>
        <span className="small" style={{ color: 'var(--gold)', flexShrink: 0 }}>{open ? 'Hide' : '▶ Watch'}</span>
      </div>
      {extra}
      {open && <VideoPlayer video={v} />}
    </div>
  );
}

/** Athlete home: their own bullpen videos, newest first. */
export function MyVideos({ personId }: { personId: string }) {
  const [rows, setRows] = useState<Video[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => { api.listVideos(personId).then(setRows).catch(() => setRows([])); }, [personId]);
  if (!rows || !rows.length) return null;
  const shown = all ? rows : rows.slice(0, 4);
  return (
    <>
      <div className="section-title">Your videos</div>
      <div className="card" style={{ gap: 8 }}>
        {shown.map(v => <VideoRow key={v.id} v={v} open={open === v.id} onToggle={() => setOpen(o => o === v.id ? null : v.id)} />)}
        {rows.length > 4 && <button className="link" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={() => setAll(a => !a)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>}
      </div>
    </>
  );
}
