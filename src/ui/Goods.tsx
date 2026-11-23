import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { GOODS_LABELS, type GoodsItem, type GoodsSection } from '../lib/types';

const DAY_SECTIONS: GoodsSection[] = ['soft_tissue', 'correctives'];
const ANY_SECTIONS: GoodsSection[] = ['feels', 'half_plyos', 'full_plyos'];

function Item({ it }: { it: GoodsItem }) {
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
    </div>
  );
}

function Section({ title, items }: { title: string; items: GoodsItem[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="small" style={{ fontWeight: 700, color: 'var(--gold)', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 6 }}>{title}</div>
      {items.map(it => <Item key={it.id} it={it} />)}
    </div>
  );
}

/** The athlete's current Goods. Used on the athlete Today screen and in the coach's player view. */
export function GoodsCard({ personId, title = 'The Goods' }: { personId: string; title?: string }) {
  const [items, setItems] = useState<GoodsItem[] | null>(null);
  const [day, setDay] = useState<'A' | 'B'>('A');
  useEffect(() => { api.currentGoods(personId).then(setItems).catch(() => setItems([])); }, [personId]);
  if (!items) return null;
  if (!items.length) {
    return <div className="card"><h2>{title}</h2><div className="small muted">Nothing assigned yet.</div></div>;
  }
  const by = (s: GoodsSection, d?: 'A' | 'B') => items.filter(i => i.section === s && (!d || i.day === d)).sort((a, b) => a.sort_order - b.sort_order);
  const hasDays = items.some(i => i.day === 'A' || i.day === 'B');
  return (
    <div className="card" style={{ gap: 6 }}>
      <div className="row">
        <h2>{title}</h2>
        {hasDays && (
          <div style={{ display: 'flex', gap: 6 }}>
            {(['A', 'B'] as const).map(d => (
              <button key={d} className={`toggle ${day === d ? 'on' : ''}`} style={{ height: 30 }} onClick={() => setDay(d)}>Day {d}</button>
            ))}
          </div>
        )}
      </div>
      {DAY_SECTIONS.map(s => <Section key={s} title={GOODS_LABELS[s]} items={by(s, day)} />)}
      {ANY_SECTIONS.map(s => <Section key={s} title={GOODS_LABELS[s]} items={by(s)} />)}
    </div>
  );
}
