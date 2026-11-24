import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { GOODS_LABELS, type GoodsItem, type GoodsSection } from '../lib/types';

const DAY_SECTIONS: GoodsSection[] = ['soft_tissue', 'correctives'];
const ANY_SECTIONS: GoodsSection[] = ['feels', 'half_plyos', 'full_plyos'];

function Item({ it, onRemove }: { it: GoodsItem; onRemove?: (it: GoodsItem) => void }) {
  const [sure, setSure] = useState(false);
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 4000); return () => clearTimeout(t); }, [sure]);
  return (
    <div className="row" style={{ alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{it.name}</div>
        <div className="small muted">
          {[it.dose, it.balls].filter(Boolean).join(' · ')}
          {it.note ? <span style={{ color: 'var(--gold)' }}>{(it.dose || it.balls) ? ' · ' : ''}{it.note}</span> : null}
        </div>
      </div>
      {it.video_url
        ? <a href={it.video_url} target="_blank" rel="noreferrer" className="small" style={{ fontWeight: 600, flexShrink: 0, paddingTop: 2 }}>Video ↗</a>
        : <span className="small muted" style={{ flexShrink: 0 }}>No video</span>}
      {onRemove && (
        <button className={`goods-x ${sure ? 'sure' : ''}`} aria-label={`Remove ${it.name}`}
          onClick={() => sure ? onRemove(it) : setSure(true)}>{sure ? 'Remove' : '✕'}</button>
      )}
    </div>
  );
}

function Section({ title, items, onRemove }: { title: string; items: GoodsItem[]; onRemove?: (it: GoodsItem) => void }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="small" style={{ fontWeight: 700, color: 'var(--gold)', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 6 }}>{title}</div>
      {items.map(it => <Item key={it.id} it={it} onRemove={onRemove} />)}
    </div>
  );
}

/** The athlete's current Goods. Used on the athlete Today screen and in the coach's player view. */
/** Day A correctives on Mon/Wed/Fri, Day B on Tue/Thu/Sat, none on Sunday. */
export function goodsDayFor(iso: string): 'A' | 'B' | null {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
  return wd === 0 ? null : wd % 2 === 1 ? 'A' : 'B';
}

/**
 * The athlete's Goods for a given day. Athletes see only that day's Day A/B correctives;
 * coaches (allDays) can flip between A and B.
 */
export function GoodsCard({ personId, title = 'The Goods', note, date, allDays, editable, plyos }: {
  personId: string; title?: string; note?: string | null; date?: string; allDays?: boolean;
  /** Today's throw: 'half' shows only half plyos, 'none' hides plyos, 'full' shows all. Leave out to show everything. */
  plyos?: 'none' | 'half' | 'full';
  /** Coaches who can edit get a remove button on each item. */
  editable?: boolean;
}) {
  const [items, setItems] = useState<GoodsItem[] | null>(null);
  const [undo, setUndo] = useState<{ ids: string[]; name: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reload = () => api.currentGoods(personId).then(setItems).catch(() => setItems([]));
  const remove = editable ? async (it: GoodsItem) => {
    setErr(null);
    try { const ids = await api.removeGoods([it.id]); setUndo({ ids, name: it.name }); await reload(); }
    catch (e) { setErr((e as Error).message); }
  } : undefined;
  const doUndo = async () => { if (!undo) return; await api.restoreGoods(undo.ids); setUndo(null); await reload(); };
  const undoBar = undo ? <div className="undo-bar small"><span>Removed {undo.name}.</span><button className="link-btn" onClick={doUndo}>Undo</button></div> : null;
  const errBox = err ? <div className="small" style={{ color: 'var(--red, #e66)' }}>{err}</div> : null;
  const autoDay = date ? goodsDayFor(date) : null;
  const [pick, setPick] = useState<'A' | 'B'>('A');
  const day = allDays || !date ? pick : autoDay;
  useEffect(() => { api.currentGoods(personId).then(setItems).catch(() => setItems([])); }, [personId]);
  if (!items) return null;
  const noteBox = note ? <div className="goods-note"><span className="goods-note-label">From Myles:</span>{note}</div> : null;
  if (!items.length) {
    return <div className="card"><h2>{title}</h2>{noteBox}{undoBar}<div className="small muted">Nothing assigned yet.</div></div>;
  }
  const by = (s: GoodsSection, d?: 'A' | 'B') => items.filter(i => i.section === s && (!d || i.day === d)).sort((a, b) => a.sort_order - b.sort_order);
  const hasDays = items.some(i => i.day === 'A' || i.day === 'B');
  return (
    <div className="card" style={{ gap: 6 }}>
      <div className="row">
        <h2>{title}</h2>
        {hasDays && (allDays || !date ? (
          <div style={{ display: 'flex', gap: 6 }}>
            {(['A', 'B'] as const).map(d => (
              <button key={d} className={`toggle ${pick === d ? 'on' : ''}`} style={{ height: 30 }} onClick={() => setPick(d)}>Day {d}</button>
            ))}
          </div>
        ) : <span className="pill-soft">{day ? `Day ${day} correctives` : 'No correctives today'}</span>)}
      </div>
      {noteBox}
      {undoBar}{errBox}
      {day && DAY_SECTIONS.map(s => <Section key={s} title={GOODS_LABELS[s]} items={by(s, day)} onRemove={remove} />)}
      {ANY_SECTIONS.filter(s => !plyos || !s.endsWith('_plyos') || (plyos === 'full') || (plyos === 'half' && s === 'half_plyos'))
        .map(s => <Section key={s} title={GOODS_LABELS[s]} items={by(s)} onRemove={remove} />)}
      {plyos === 'none' && items.some(i => i.section.endsWith('_plyos')) && <div className="small muted">No plyos today: it's an off day for your arm.</div>}
      {plyos === 'half' && items.some(i => i.section === 'full_plyos') && <div className="small muted">Half plyos today. Full plyos come back on your bigger throwing days.</div>}
    </div>
  );
}
