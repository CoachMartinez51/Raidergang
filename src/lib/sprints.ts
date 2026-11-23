import { addDays } from './dates';
import type { LiftBlock } from './lifts';

export const SPRINTS = ['5/10', '10/10', '15/10', '20/10'] as const;
export type SprintType = (typeof SPRINTS)[number];
export type Medal = 'gold' | 'silver' | 'bronze';

export interface SprintResult {
  id: string;
  person_id: string;
  sprint: SprintType;
  run_date: string;
  session_label: string | null;
  seconds: number;
  source: 'app' | 'coach' | 'sheet';
  retired_at: string | null;
  created_at: string;
}

/** One athlete's best time in one testing week, with any medal. */
export interface SprintSession {
  person_id?: string;
  is_pitcher?: boolean;
  sprint: SprintType;
  session: string;
  session_date: string;
  best: number;
  runners: number;
  medal: Medal | null;
}

export const MEDAL_ICON: Record<Medal, string> = { gold: '🥇', silver: '🥈', bronze: '🥉' };
export const fmtTime = (n: number) => Number(n).toFixed(2);

/** Monday of the week a date falls in. */
export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
  return addDays(iso, -((wd + 6) % 7));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const sessionName = (r: Pick<SprintResult, 'session_label' | 'run_date'>) => {
  if (r.session_label) return r.session_label;
  const [, m, d] = mondayOf(r.run_date).split('-').map(Number);
  return `Week of ${MONTHS[m - 1]} ${d}`;
};

/** Same rules as the database: best per week, ties share, pitchers and position players apart, 4+ runners. */
export function computeSessions(rows: SprintResult[], isPitcher: (personId: string) => boolean | null): SprintSession[] {
  const best = new Map<string, SprintSession & { key: string; pool: string }>();
  for (const r of rows) {
    if (r.retired_at) continue;
    const pitch = isPitcher(r.person_id);
    if (pitch === null) continue;
    const key = r.session_label ?? mondayOf(r.run_date);
    const k = `${r.person_id}|${r.sprint}|${key}`;
    const cur = best.get(k);
    if (!cur) best.set(k, { person_id: r.person_id, is_pitcher: pitch, sprint: r.sprint, session: sessionName(r), session_date: r.run_date, best: Number(r.seconds), runners: 0, medal: null, key, pool: pitch ? 'P' : 'X' });
    else { cur.best = Math.min(cur.best, Number(r.seconds)); if (r.run_date < cur.session_date) cur.session_date = r.run_date; }
  }
  const groups = new Map<string, (SprintSession & { key: string; pool: string })[]>();
  for (const s of best.values()) {
    const g = `${s.sprint}|${s.key}|${s.pool}`;
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }
  const out: SprintSession[] = [];
  for (const g of groups.values()) {
    const times = [...new Set(g.map(s => s.best))].sort((a, b) => a - b);
    for (const s of g) {
      const rk = times.indexOf(s.best);
      const { key: _k, pool: _p, ...rest } = s;
      out.push({ ...rest, runners: g.length, medal: g.length >= 4 && rk < 3 ? (['gold', 'silver', 'bronze'] as Medal[])[rk] : null });
    }
  }
  return out.sort((a, b) => b.session_date.localeCompare(a.session_date) || a.sprint.localeCompare(b.sprint) || a.best - b.best);
}

/** The timed sprint in a lift block's week, from the lower-day sprint lines ("10/10: 1 x 90%..."). */
export function sprintOfWeek(block: LiftBlock, week: number): SprintType | null {
  for (const d of block.days) {
    const line = d.sprints?.[week - 1];
    const m = line?.match(/^\s*(5|10|15|20)\s*\/\s*10/);
    if (m) return `${m[1]}/10` as SprintType;
  }
  return null;
}
