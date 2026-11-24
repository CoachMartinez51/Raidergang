import { addDays, isoDay } from './dates';
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
  /** 1 = fastest that week (ties share). */
  rk?: number;
  /** false while the week is still going (live); true after midnight Sunday. Only final medals are official. */
  final?: boolean;
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

/** Same rules as the database: every time in the same Mon–Sun week counts together (sheet or app),
 *  best per week, ties share, pitchers and position players apart, medals need 4+ runners,
 *  and a week is final once its Sunday has passed. */
export function computeSessions(rows: SprintResult[], isPitcher: (personId: string) => boolean | null): SprintSession[] {
  const today = isoDay();
  const labels = new Map<string, string>();
  for (const r of rows) if (!r.retired_at && r.session_label) labels.set(`${r.sprint}|${mondayOf(r.run_date)}`, r.session_label);
  const best = new Map<string, SprintSession & { key: string; pool: string }>();
  for (const r of rows) {
    if (r.retired_at) continue;
    const pitch = isPitcher(r.person_id);
    if (pitch === null) continue;
    const wk = mondayOf(r.run_date);
    const k = `${r.person_id}|${r.sprint}|${wk}`;
    const cur = best.get(k);
    if (!cur) best.set(k, {
      person_id: r.person_id, is_pitcher: pitch, sprint: r.sprint,
      session: labels.get(`${r.sprint}|${wk}`) ?? sessionName({ session_label: null, run_date: r.run_date }),
      session_date: wk, best: Number(r.seconds), runners: 0, medal: null, final: addDays(wk, 7) <= today, key: wk, pool: pitch ? 'P' : 'X',
    });
    else cur.best = Math.min(cur.best, Number(r.seconds));
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
      const rk = times.indexOf(s.best) + 1;
      const { key: _k, pool: _p, ...rest } = s;
      out.push({ ...rest, runners: g.length, rk, medal: g.length >= 4 && rk <= 3 ? (['gold', 'silver', 'bronze'] as Medal[])[rk - 1] : null });
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

/** "The Medalists": this week's live board and the last official (finished) week, each with Most Improved. */
export interface SpotlightRow {
  status: 'live' | 'official';
  sprint: SprintType;
  session: string;
  session_date: string;
  is_pitcher: boolean;
  person_id: string;
  first_name: string;
  last_name: string;
  best: number;
  rk: number;
  runners: number;
  medal: Medal | null;
  prev_best: number | null;
  improved_by: number | null;
  most_improved: boolean;
}

/** Same rules as the database's sprint_spotlight(), for demo mode. */
export function computeSpotlight(sessions: SprintSession[], names: Map<string, { first_name: string; last_name: string }>): SpotlightRow[] {
  const weeks = new Map<string, { sprint: SprintType; date: string; final: boolean; medals: boolean; n: number }>();
  for (const s of sessions) {
    const k = `${s.sprint}|${s.session_date}`;
    const w = weeks.get(k) ?? { sprint: s.sprint, date: s.session_date, final: !!s.final, medals: false, n: 0 };
    w.medals ||= !!s.medal; w.n++; weeks.set(k, w);
  }
  const all = [...weeks.values()];
  const official = all.filter(w => w.final && w.medals).sort((a, b) => b.date.localeCompare(a.date))[0];
  const live = all.filter(w => !w.final).sort((a, b) => b.date.localeCompare(a.date) || b.n - a.n)[0];
  const out: SpotlightRow[] = [];
  for (const [status, w] of [['official', official], ['live', live]] as const) {
    if (!w) continue;
    const cur = sessions.filter(s => s.sprint === w.sprint && s.session_date === w.date);
    const rows: SpotlightRow[] = cur.map(c => {
      const prev = sessions.filter(y => y.person_id === c.person_id && y.sprint === c.sprint && y.session_date < c.session_date)
        .sort((a, b) => b.session_date.localeCompare(a.session_date))[0];
      const imp = prev && prev.best > c.best ? Math.round((prev.best - c.best) * 100) / 100 : null;
      const n = names.get(c.person_id!) ?? { first_name: '?', last_name: '' };
      return { status, sprint: c.sprint, session: c.session, session_date: c.session_date, is_pitcher: !!c.is_pitcher, person_id: c.person_id!, ...n,
        best: c.best, rk: c.rk ?? 99, runners: c.runners, medal: c.medal, prev_best: prev?.best ?? null, improved_by: imp, most_improved: false };
    });
    for (const pool of [true, false]) {
      const top = Math.max(0, ...rows.filter(r => r.is_pitcher === pool && r.improved_by).map(r => r.improved_by!));
      for (const r of rows) if (r.is_pitcher === pool && top > 0 && r.improved_by === top) r.most_improved = true;
    }
    out.push(...rows.filter(r => r.rk <= 3 || r.most_improved));
  }
  return out.sort((a, b) => a.status.localeCompare(b.status) || Number(b.is_pitcher) - Number(a.is_pitcher) || a.best - b.best);
}
