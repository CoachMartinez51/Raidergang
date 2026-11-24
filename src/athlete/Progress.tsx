import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { addDays, isoDay, prettyDay } from '../lib/dates';
import type { Checkin, Person } from '../lib/types';
import { parseGoal, WeightChart } from '../ui/WeightChart';

/** Progress tab: every weigh-in on one line graph, with the goal shaded, like the fall reports. */
export function ProgressTab({ me }: { me: Person }) {
  const [rows, setRows] = useState<Checkin[] | null>(null);
  useEffect(() => { api.checkinHistory(me.id, 3650).then(setRows).catch(() => setRows([])); }, [me.id]);

  const pts = (rows ?? []).filter(c => c.bodyweight != null)
    .sort((a, b) => a.checkin_date.localeCompare(b.checkin_date))
    .map(c => ({ d: c.checkin_date, w: Number(c.bodyweight) }));
  const g = parseGoal(me.goal_weight);
  const first = pts[0], last = pts[pts.length - 1];
  const weekAgo = addDays(isoDay(), -6);
  const recent = pts.filter(p => p.d >= weekAgo);
  const avg7 = recent.length ? Math.round(recent.reduce((s, p) => s + p.w, 0) / recent.length * 10) / 10 : null;
  const change = first && last ? Math.round((last.w - first.w) * 10) / 10 : 0;
  const goalText = g ? (g[0] === g[1] ? `${g[0]} lb` : `${g[0]}–${g[1]} lb`) : null;
  let status: string | null = null;
  if (g && last) {
    const w = avg7 ?? last.w;
    status = w < g[0] ? `${Math.round((g[0] - w) * 10) / 10} lb under your goal` : w > g[1] ? `${Math.round((w - g[1]) * 10) / 10} lb over your goal` : 'In your goal range';
  }

  return (
    <>
      <div className="card" style={{ gap: 10 }}>
        <h2>Body weight</h2>
        {!rows ? <div className="small muted">Loading…</div> : !pts.length ? (
          <div className="small muted">No weigh-ins yet. Log your weight on the Today tab and it starts your graph.</div>
        ) : (
          <>
            <div style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 28, fontWeight: 700 }}>
              {first.w} <span className="muted" style={{ fontWeight: 500 }}>→</span> {last.w}<span className="small muted"> lb</span>
            </div>
            <div className="progress-stats">
              <div><span>Change</span><b>{change > 0 ? '+' : ''}{change} lb</b><i>since {prettyDay(first.d, { month: 'short', day: 'numeric', year: 'numeric' })}</i></div>
              <div><span>7-day average</span><b>{avg7 != null ? `${avg7} lb` : '–'}</b><i>{recent.length} weigh-in{recent.length === 1 ? '' : 's'} this week</i></div>
              <div><span>Goal</span><b>{goalText ?? 'Not set'}</b><i>{status ?? (goalText ? '' : 'Coach sets this')}</i></div>
              <div><span>Weigh-ins</span><b>{pts.length}</b><i>all time</i></div>
            </div>
          </>
        )}
      </div>
      <WeightChart personId={me.id} goal={me.goal_weight} title="Every weigh-in" initial="all" />
    </>
  );
}
