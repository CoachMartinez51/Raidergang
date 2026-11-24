import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { addDays, isoDay, prettyDay } from '../lib/dates';
import type { SetLog } from '../lib/lifts';

const W = 360, H = 220, PAD = { l: 38, r: 8, t: 14, b: 24 };

/** "3 x 6 · RIR 2" → { reps: 6, rir: 2 } (first number of a range; AMRAP/ALAP → null) */
function parsePrescribed(p: string | null): { reps: number | null; rir: number } {
  if (!p) return { reps: null, rir: 0 };
  const m = p.match(/x\s*(\d+)/i);
  const r = p.match(/RIR\s*(\d+)/i);
  return { reps: m ? Number(m[1]) : null, rir: r ? Number(r[1]) : 0 };
}

interface DayPoint { d: string; t: number; top: number; est: number | null; reps: number | null; }

/** Per lift: heaviest set each day, plus an estimated max (Epley, counting reps left in the tank). */
function buildSeries(logs: SetLog[]) {
  const by = new Map<string, Map<string, DayPoint>>();
  for (const l of logs) {
    if (l.weight == null || Number(l.weight) <= 0 || l.alt || l.used_rehab) continue;
    const w = Number(l.weight);
    const { reps, rir } = parsePrescribed(l.prescribed);
    const est = reps && reps <= 12 ? Math.round(w * (1 + (reps + rir) / 30)) : null;
    const m = by.get(l.exercise_name) ?? new Map<string, DayPoint>();
    const cur = m.get(l.log_date);
    if (!cur || w > cur.top) m.set(l.log_date, { d: l.log_date, t: Date.parse(l.log_date), top: w, est, reps });
    by.set(l.exercise_name, m);
  }
  return new Map([...by].map(([k, m]) => [k, [...m.values()].sort((a, b) => a.t - b.t)]));
}

/** Lift weights over time for one athlete, one lift at a time. */
export function LiftChart({ personId, title = 'Lifts over time' }: { personId: string; title?: string }) {
  const [logs, setLogs] = useState<SetLog[] | null>(null);
  const [lift, setLift] = useState<string>('');
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    api.setLogs({ personId, from: addDays(isoDay(), -730), to: isoDay() }).then(setLogs).catch(() => setLogs([]));
  }, [personId]);

  const series = useMemo(() => buildSeries(logs ?? []), [logs]);
  const options = useMemo(() => [...series].filter(([, p]) => p.length >= 1)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([k, p]) => ({ name: k, n: p.length })), [series]);
  const cur = lift && series.has(lift) ? lift : options[0]?.name ?? '';
  const pts = series.get(cur) ?? [];
  useEffect(() => setHover(null), [cur]);

  if (!logs) return <div className="card"><h2>{title}</h2><div className="small muted">Loading…</div></div>;
  if (!options.length) return <div className="card"><h2>{title}</h2><div className="small muted">No weights logged yet. Every set logged on the Lift tab shows up here.</div></div>;

  const picker = (
    <select className="input" aria-label="Lift" value={cur} onChange={e => setLift(e.target.value)}>
      {options.map(o => <option key={o.name} value={o.name}>{o.name} ({o.n} day{o.n === 1 ? '' : 's'})</option>)}
    </select>
  );
  const first = pts[0], last = pts[pts.length - 1];
  const best = pts.reduce((a, p) => p.top > a.top ? p : a, pts[0]);
  const bestEst = Math.max(0, ...pts.map(p => p.est ?? 0)) || null;
  const change = last.top - first.top;

  const header = (
    <div className="lift-stats">
      <div><span>Last top set</span><b>{last.top} lb</b><i>{prettyDay(last.d, { month: 'short', day: 'numeric' })}{last.reps ? ` · ${last.reps} reps` : ''}</i></div>
      <div><span>Heaviest</span><b>{best.top} lb</b><i>{prettyDay(best.d, { month: 'short', day: 'numeric' })}</i></div>
      <div><span>Est. max</span><b>{bestEst ? `${bestEst} lb` : '–'}</b><i>{bestEst ? 'from reps + RIR' : 'needs a rep target'}</i></div>
      <div><span>Change</span><b>{change > 0 ? '+' : ''}{change} lb</b><i>since {prettyDay(first.d, { month: 'short', day: 'numeric' })}</i></div>
    </div>
  );
  if (pts.length < 2) return <div className="card" style={{ gap: 10 }}><h2>{title}</h2>{picker}{header}<div className="small muted">One day logged so far. The line starts after the next one.</div></div>;

  const t0 = first.t, t1 = last.t;
  const vals = pts.flatMap(p => [p.top, p.est ?? p.top]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const padV = Math.max(5, (hi - lo) * 0.12); lo = Math.max(0, Math.floor((lo - padV) / 5) * 5); hi = Math.ceil((hi + padV) / 5) * 5;
  const x = (t: number) => PAD.l + (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const span = hi - lo, step = span <= 40 ? 10 : span <= 100 ? 20 : span <= 200 ? 40 : 50;
  const ticks: number[] = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const line = (get: (p: DayPoint) => number | null) => pts.filter(p => get(p) != null)
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(get(p)!).toFixed(1)}`).join(' ');
  const hasEst = pts.filter(p => p.est != null).length >= 2;
  const pick = (clientX: number) => {
    const r = svgRef.current?.getBoundingClientRect(); if (!r) return;
    const px = ((clientX - r.left) / r.width) * W;
    let bi = 0, bd = Infinity; pts.forEach((p, i) => { const dd = Math.abs(x(p.t) - px); if (dd < bd) { bd = dd; bi = i; } });
    setHover(bi);
  };
  const hp = hover != null ? pts[hover] : null;

  return (
    <div className="card" style={{ gap: 10 }}>
      <h2>{title}</h2>
      {picker}
      {header}
      <div className="chart-legend small">
        <span><i style={{ background: 'var(--gold)' }} />Top set</span>
        {hasEst && <span><i className="dash" />Est. max</span>}
      </div>
      <div style={{ position: 'relative' }}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: 'block', touchAction: 'pan-y' }}
          aria-label={`${cur}: top set ${first.top} lb on ${prettyDay(first.d)} to ${last.top} lb on ${prettyDay(last.d)}`}
          onPointerMove={e => pick(e.clientX)} onPointerDown={e => pick(e.clientX)} onPointerLeave={() => setHover(null)}>
          {ticks.map(v => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
              <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{v}</text>
            </g>
          ))}
          <text x={PAD.l} y={H - 6} fontSize="11" fill="var(--muted)">{prettyDay(first.d, { month: 'short', day: 'numeric' })}</text>
          <text x={W - PAD.r} y={H - 6} fontSize="11" fill="var(--muted)" textAnchor="end">{prettyDay(last.d, { month: 'short', day: 'numeric' })}</text>
          {hasEst && <path d={line(p => p.est)} fill="none" stroke="var(--green-text)" strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" />}
          <path d={line(p => p.top)} fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {pts.map(p => <circle key={p.d} cx={x(p.t)} cy={y(p.top)} r="3" fill="var(--gold)" stroke="var(--card)" strokeWidth="1.5" />)}
          {hp && <line x1={x(hp.t)} x2={x(hp.t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />}
          {hp && <circle cx={x(hp.t)} cy={y(hp.top)} r="5" fill="var(--gold)" stroke="var(--card)" strokeWidth="2" />}
        </svg>
        {hp && (
          <div className="chart-tip" style={{ left: `${(x(hp.t) / W) * 100}%` }}>
            <b>{hp.top} lb</b>{hp.reps ? ` × ${hp.reps}` : ''}{hp.est ? <span className="muted"> · est. max {hp.est}</span> : null}
            <span className="muted"> · {prettyDay(hp.d, { month: 'short', day: 'numeric' })}</span>
          </div>
        )}
      </div>
      <span className="small muted">Heaviest set each day. Bands, bodyweight and rehab sets aren't counted.</span>
    </div>
  );
}
