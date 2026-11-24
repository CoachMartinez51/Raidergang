// Throwing program (Catch Play): day types, intensity ranges, helpers.

export type ThrowKind = 'Off' | 'Low' | 'Medium' | 'High' | 'Bullpen' | 'Live' | 'Game' | 'Recovery';
export type Plyos = 'none' | 'half' | 'full';

export interface ThrowProgram { id: string; name: string; active: boolean; }
export interface ThrowDay {
  id: string;
  program_id: string;
  day: string;            // YYYY-MM-DD
  kind: ThrowKind;
  title: string;
  sp_title: string | null;
  distance: string | null;
  catch_play: string | null;
  plyos: Plyos;
  note: string | null;
}
export type ThrowDayDraft = Omit<ThrowDay, 'id' | 'program_id' | 'day'>;
export interface ThrowAssignment { person_id: string; program_id: string; }

/** Defaults from the Coaching Database "Throwing" tab. Intensity = share of the pitcher's avg fastball. */
export const KINDS: Record<ThrowKind, { label: string; catchPlay: string | null; distance: string | null; pct: [number, number] | null; plyos: Plyos; cls: string }> = {
  Off:      { label: 'Off',      catchPlay: null,                               distance: null,                         pct: null,        plyos: 'none', cls: 'k-off' },
  Low:      { label: 'Low',      catchPlay: '10–20 min',                        distance: '60–120 ft',                  pct: [0.60, 0.70], plyos: 'half', cls: 'k-low' },
  Medium:   { label: 'Medium',   catchPlay: '20–30 min',                        distance: '120–220 ft',                 pct: [0.70, 0.80], plyos: 'full', cls: 'k-med' },
  High:     { label: 'High',     catchPlay: '20–30 min (10 min max distance)',  distance: '220 ft – max',               pct: [0.85, 0.95], plyos: 'full', cls: 'k-high' },
  Bullpen:  { label: 'Bullpen',  catchPlay: 'Catch play to comfort',            distance: 'Pitch count',                pct: [0.85, 0.95], plyos: 'full', cls: 'k-high' },
  Live:     { label: 'Live',     catchPlay: 'Catch play to comfort',            distance: 'Pitches · innings · breaks', pct: [1, 1],       plyos: 'full', cls: 'k-live' },
  Game:     { label: 'Game day', catchPlay: 'Catch play to comfort',            distance: null,                         pct: [1, 1],       plyos: 'half', cls: 'k-live' },
  Recovery: { label: 'Recovery', catchPlay: null,                               distance: null,                         pct: null,        plyos: 'none', cls: 'k-rec' },
};
export const KIND_ORDER: ThrowKind[] = ['Off', 'Low', 'Medium', 'High', 'Bullpen', 'Live', 'Game', 'Recovery'];
export const PLYO_LABEL: Record<Plyos, string> = { none: 'No plyos', half: 'Half plyos', full: 'Full plyos' };

const pctText = (p: [number, number]) => p[0] === p[1] ? `${Math.round(p[0] * 100)}%` : `${Math.round(p[0] * 100)}–${Math.round(p[1] * 100)}%`;
export function intensityText(kind: ThrowKind) { const p = KINDS[kind].pct; return p ? pctText(p) : null; }
export function mphText(kind: ThrowKind, velo: number | null | undefined) {
  const p = KINDS[kind].pct;
  if (!p || !velo) return null;
  const a = (velo * p[0]).toFixed(1), b = (velo * p[1]).toFixed(1);
  return a === b ? `${a} mph` : `${a}–${b} mph`;
}
/** The rows of the "What is MY intensity?" calculator. */
export const CALC_ROWS: { label: string; kind: ThrowKind }[] = [
  { label: 'Low', kind: 'Low' }, { label: 'Medium', kind: 'Medium' }, { label: 'High / Bullpen', kind: 'High' }, { label: 'Game day', kind: 'Game' },
];

/** Monday of the week containing iso. */
export function mondayOf(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wd = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - wd);
  return dt.toISOString().slice(0, 10);
}
export function shortTitle(d: ThrowDay) {
  if (d.kind === 'Off') return /thanksgiving|christmas|new year|holiday/i.test(d.title) ? 'Holiday' : 'Off';
  if (d.kind === 'Recovery') return 'Arm care';
  if (d.kind === 'Live') return 'Live';
  if (d.kind === 'Game') return 'Game';
  const lt = d.title.match(/long toss[^~]*~\s*(\d+(?:-\d+)?)/i);
  if (lt) return `LT ${lt[1]}`;
  if (/bullpen/i.test(d.title)) { const n = d.title.match(/(\d+(?:-\d+)?)\s*pitch/i); return n ? `Pen ${n[1]}` : 'Pen'; }
  if (/flat ground/i.test(d.title)) return 'Flat';
  if (/catch/i.test(d.title)) return 'Catch';
  return d.title.slice(0, 10);
}
