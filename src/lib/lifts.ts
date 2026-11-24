// Lift types + pure scheduling helpers (no database calls here).
import { addDays } from './dates';

export interface WeekRx { sets: number; reps: string; note?: string }

export interface BlockExercise {
  id: string;
  block_day_id: string;
  slot: string;
  sort_order: number;
  exercise_id: string | null;
  custom_name: string | null;
  video_url: string | null;
  rir: string | null;
  cue: string | null;
  rehab: string | null;
  log_type: 'weight' | 'done' | 'result';
  result_label: string | null;
  weeks: (WeekRx | null)[];
  exercise?: { name: string; video_url: string | null } | null;
}

export interface PrepItem { name: string; exercise_id: string | null; video_url: string | null; dose?: string | null }
export interface LiftPrep { id: string; name: string; items: PrepItem[] }

export interface BlockDay {
  id: string;
  block_id: string;
  weekday: number;            // 1 = Monday
  label: string;
  focus: 'lower' | 'upper' | 'other';
  prep_id: string | null;
  warmup: string | null;
  sprints: string[];
  notes: string | null;
  exercises: BlockExercise[];
  prep?: LiftPrep | null;
}

export interface DateMove { week: number; weekday: number; moved_to: string }

export interface LiftBlock {
  id: string;
  name: string;
  notes: string | null;
  weeks: number;
  date_moves: DateMove[];
  archived: boolean;
  days: BlockDay[];
}

export type BlockDayPatch = Partial<Pick<BlockDay, 'label' | 'focus' | 'warmup' | 'sprints' | 'notes'>>;
export type BlockExercisePatch = Partial<Pick<BlockExercise, 'slot' | 'sort_order' | 'exercise_id' | 'custom_name' | 'rir' | 'cue' | 'rehab' | 'log_type' | 'result_label' | 'weeks'>>;
export type NewBlockExercise = Pick<BlockExercise, 'block_day_id' | 'slot' | 'sort_order' | 'exercise_id' | 'custom_name' | 'rir' | 'cue' | 'rehab' | 'log_type' | 'weeks'>;

export interface Assignment { id: string; block_id: string; person_id: string; start_date: string; active: boolean }

export interface SetLog {
  id: string;
  person_id: string;
  block_exercise_id: string;
  log_date: string;
  week: number;
  set_number: number;
  weight: number | null;
  result: string | null;
  done: boolean;
  used_rehab: boolean;
  exercise_name: string;
  prescribed: string | null;
  /** A band or bodyweight used instead of a weight for this set */
  alt?: AltOption | null;
  /** AMRAP: reps done. ALAP: seconds held. */
  reps_done?: number | null;
  seconds_done?: number | null;
  created_at: string;
}

/** Options an athlete can pick in place of a weight (also band assistance, e.g. chin ups). */
export const ALT_OPTIONS = [
  'Bodyweight', 'Single Orange Band', 'Single Red Band', 'Single Green Band', 'Single Black Band',
  'Double Orange', 'Double Red', 'Double Green', 'Red & Orange', 'Green & Red',
] as const;
export type AltOption = (typeof ALT_OPTIONS)[number];

/** AMRAP = log reps done; ALAP = log seconds held. */
export const amountMode = (reps: string | null | undefined): 'reps' | 'seconds' | null =>
  !reps ? null : /amrap/i.test(reps) ? 'reps' : /alap/i.test(reps) ? 'seconds' : null;

/** Anything logged on this set? */
export const setHasValue = (l: SetLog) =>
  l.done || l.weight != null || !!l.result || !!l.alt || l.reps_done != null || l.seconds_done != null;

/** Short text for one set: "185", "Red Band", "135 × 12", "45 sec". */
export function setText(l: SetLog): string {
  if (l.done && l.weight == null && !l.alt && l.reps_done == null && l.seconds_done == null && !l.result) return '✓';
  const main = l.alt ?? (l.weight != null ? String(l.weight) : l.result ?? '');
  const amt = l.reps_done != null ? `${l.reps_done} reps` : l.seconds_done != null ? `${l.seconds_done} sec` : '';
  return [main, amt].filter(Boolean).join(main && amt ? ' × ' : '');
}

export interface RehabSwitch { id: string; person_id: string; block_exercise_id: string; active: boolean }

export const WEEKDAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAY_LONG = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const exName = (e: BlockExercise) => e.exercise?.name ?? e.custom_name ?? 'Exercise';
// The Library's link wins, so fixing a video in the Library updates every lift that uses it.
export const exVideo = (e: BlockExercise) => e.exercise?.video_url || e.video_url || null;

export const isoWeekday = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  return wd === 0 ? 7 : wd;
};

const daysBetween = (a: string, b: string) => {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
};

/** Which week of the block a date falls in (1-based), or null if outside the block. */
export function weekOf(start: string, weeks: number, date: string): number | null {
  const n = daysBetween(start, date);
  if (n < 0) return null;
  const w = Math.floor(n / 7) + 1;
  return w <= weeks ? w : null;
}

/** The calendar date a block day lands on in a given week, after holiday moves. */
export function dateFor(start: string, block: Pick<LiftBlock, 'date_moves'>, week: number, weekday: number): string {
  const moved = block.date_moves.find(m => m.week === week && m.weekday === weekday);
  return moved ? moved.moved_to : addDays(start, (week - 1) * 7 + (weekday - 1));
}

export interface Scheduled { assignment: Assignment; block: LiftBlock; week: number; day: BlockDay | null }

/** Finds the lift for a date: the newest active assignment whose block covers it. */
export function scheduleFor(date: string, assignments: Assignment[], blocks: LiftBlock[]): Scheduled | null {
  const sorted = [...assignments].filter(a => a.active).sort((a, b) => b.start_date.localeCompare(a.start_date));
  for (const a of sorted) {
    const block = blocks.find(b => b.id === a.block_id);
    if (!block) continue;
    // a date can belong to the week before if a moved day spills over (e.g. Saturday)
    const week = weekOf(a.start_date, block.weeks, date);
    if (!week) continue;
    const day = block.days.find(d => dateFor(a.start_date, block, week, d.weekday) === date) ?? null;
    return { assignment: a, block, week, day };
  }
  return null;
}

export function prescription(e: BlockExercise, week: number): WeekRx | null {
  return e.weeks[week - 1] ?? null;
}

export function rxText(e: BlockExercise, week: number): string {
  const w = prescription(e, week);
  if (!w) return '';
  const base = w.sets > 1 || /^\d/.test(w.reps) ? `${w.sets} x ${w.reps}` : w.reps;
  return [base, e.rir].filter(Boolean).join(' · ');
}

/** A, B, C… blocks from slots (A1, A2 → block A), in order. */
export function groupBlocks<T extends { slot: string }>(items: T[]): { letter: string; items: T[] }[] {
  const out: { letter: string; items: T[] }[] = [];
  for (const it of items) {
    const letter = (it.slot.match(/^[A-Za-z]+/)?.[0] ?? '?').toUpperCase();
    const g = out.find(b => b.letter === letter);
    if (g) g.items.push(it); else out.push({ letter, items: [it] });
  }
  return out;
}
/** How a block's exercises are paired, from how many it has. */
export const pairing = (n: number) => (n >= 3 ? 'Circuit' : n === 2 ? 'Superset' : 'Straight sets');
