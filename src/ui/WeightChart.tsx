import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { prettyDay } from '../lib/dates';
import type { Checkin } from '../lib/types';

type Range = 30 | 90 | 365;

/** "204-207" or "205" → [low, high] */
export function parseGoal(goal: string | null | undefined): [number, number] | null {
  if (!goal) return null;
  const nums = goal.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
  if (!nums.length) return null;
  return [Math.min(...nums), Math.max(...nums)];
}

const W = 640, H = 220, PAD = { l: 40, r: 12, t: 14, b: 26 };

/** Bodyweight over time with the goal range shaded. Tap or drag to read a day. */
export function WeightChart({ personId, goal, title = 'Bodyweight trend' }: { personId: string; goal?: string | null; title?: string }) {
  const [range, setRange] = useState<Range>(30);
  const [rows, setRows] = useState<Checkin[] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    setRows(null); setHover(null);
    api.checkinHistory(personId, range - 1).then(r => setRows(r)).catch(() => setRows([]));
  }, [personId, range]);

  const pts = useMemo(() => (rows ?? []).filter(c => c.bodyweight != null)
    .sort((a, b) => a.checkin_date.localeCompare(b.checkin_date))
    .map(c => ({ d: c.checkin_date, w: Number(c.bodyweight), t: Date.parse(c.checkin_date) })), [rows]);
  const g = parseGoal(goal);

  const tabs = (
    <div style={{ display: 'flex', gap: 6 }} role="group" aria-label="Time range">
      {([30, 90, 365] as Range[]).map(r => (
        <button key={r} className={`toggle ${range === r ? 'on' : ''}`} style={{ height: 30, padding: '0 10px' }} aria-pressed={range === r} onClick={() => setRange(r)}>
          {r === 365 ? '1 yr' : `${r} d`}
        </button>
      ))}
    </div>
  );

  if (!rows) return <div className="card"><div className="row"><h2>{title}</h2>{tabs}</div><div className="small muted">Loading…</div></div>;
  if (pts.length < 2) return <div className="card"><div className="row"><h2>{title}</h2>{tabs}</div><div className="small muted">Needs at least two weigh-ins in this range.</div></div>;

  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const ws = pts.map(p => p.w).concat(g ? [g[0], g[1]] : []);
  let lo = Math.floor(Math.min(...ws) - 1), hi = Math.ceil(Math.max(...ws) + 1);
  if (hi - lo < 6) { const mid = (hi + lo) / 2; lo = Math.floor(mid - 3); hi = Math.ceil(mid + 3); }
  const x = (t: number) => PAD.l + (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r));
  const y = (w: number) => PAD.t + (1 - (w - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const step = (hi - lo) <= 8 ? 2 : (hi - lo) <= 16 ? 4 : 5;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.w).toFixed(1)}`).join(' ');

  const first = pts[0], last = pts[pts.length - 1];
  const change = Math.round((last.w - first.w) * 10) / 10;
  const inGoal = g ? last.w >= g[0] && last.w <= g[1] : null;
  const summary = `${last.w} lb on ${prettyDay(last.d, { month: 'short', day: 'numeric' })}, ${change === 0 ? 'no change' : `${change > 0 ? 'up' : 'down'} ${Math.abs(change)} lb`} since ${prettyDay(first.d, { month: 'short', day: 'numeric' })}${g ? `; goal ${g[0]}${g[1] !== g[0] ? `–${g[1]}` : ''}` : ''}`;

  const pick = (clientX: number) => {
    const svg = svgRef.current; if (!svg) return;
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    let best = 0, bd = Infinity;
    pts.forEach((p, i) => { const dd = Math.abs(x(p.t) - px); if (dd < bd) { bd = dd; best = i; } });
    setHover(best);
  };
  const hp = hover != null ? pts[hover] : null;

  return (
    <div className="card" style={{ gap: 8 }}>
      <div className="row"><h2>{title}</h2>{tabs}</div>
      <div className="row" style={{ justifyContent: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 26, fontWeight: 700 }}>{last.w}<span className="small muted"> lb</span></span>
        <span className="small" style={{ color: 'var(--muted)' }}>{change > 0 ? '+' : ''}{change} lb in this range</span>
        {inGoal != null && <span className={inGoal ? 'pill-green' : 'pill-soft'}>{inGoal ? 'In goal range' : `Goal ${g![0]}${g![1] !== g![0] ? `–${g![1]}` : ''}`}</span>}
      </div>
      <div style={{ position: 'relative' }}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${title}: ${summary}`}
          style={{ display: 'block', touchAction: 'pan-y' }}
          onPointerMove={e => pick(e.clientX)} onPointerDown={e => pick(e.clientX)} onPointerLeave={() => setHover(null)}>
          {g && <rect x={PAD.l} width={W - PAD.l - PAD.r} y={y(g[1] + (g[0] === g[1] ? 0.5 : 0))} height={Math.max(2, y(g[0] - (g[0] === g[1] ? 0.5 : 0)) - y(g[1] + (g[0] === g[1] ? 0.5 : 0)))} fill="var(--green)" opacity="0.28" />}
          {ticks.map(v => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
              <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">{v}</text>
            </g>
          ))}
          <text x={PAD.l} y={H - 6} fontSize="12" fill="var(--muted)">{prettyDay(first.d, { month: 'short', day: 'numeric' })}</text>
          <text x={W - PAD.r} y={H - 6} fontSize="12" fill="var(--muted)" textAnchor="end">{prettyDay(last.d, { month: 'short', day: 'numeric' })}</text>
          {g && <text x={W - PAD.r - 4} y={y(g[1]) - 5} fontSize="11" fill="var(--green-text)" textAnchor="end">Goal</text>}
          <path d={path} fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(last.t)} cy={y(last.w)} r="4.5" fill="var(--gold)" stroke="var(--card)" strokeWidth="2" />
          {hp && (
            <g>
              <line x1={x(hp.t)} x2={x(hp.t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />
              <circle cx={x(hp.t)} cy={y(hp.w)} r="5" fill="var(--gold)" stroke="var(--card)" strokeWidth="2" />
            </g>
          )}
        </svg>
        {hp && (
          <div className="chart-tip" style={{ left: `${(x(hp.t) / W) * 100}%` }}>
            <b>{hp.w} lb</b><span className="muted"> · {prettyDay(hp.d, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          </div>
        )}
      </div>
      <span className="small muted">Tap or drag on the line to read a day.</span>
    </div>
  );
}
