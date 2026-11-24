export type GoalKind = 'body' | 'ball' | 'game';

export interface Person {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  aliases: string[];
  trackman_pitcher_id: string | null;
  is_pitcher: boolean;
  is_position_player: boolean;
  is_individual_pro: boolean;
  is_coach: boolean;
  coach_can_edit: boolean;
  is_admin: boolean;
  active: boolean;
  auth_user_id: string | null;
  first_signed_in_at: string | null;
  goal_weight: string | null;
  /** Coach's note shown at the top of the athlete's Goods */
  goods_note: string | null;
  /** Average fall fastball (mph); drives the throwing intensity ranges. Set from the Throwing tab. */
  throw_velo?: number | null;
}

export type PersonDraft = Omit<Person, 'id' | 'auth_user_id' | 'first_signed_in_at' | 'throw_velo'>;

export interface Group { id: string; name: string; }
export interface Membership { group_id: string; person_id: string; }

export interface Goal {
  id: string;
  person_id: string;
  kind: GoalKind;
  body: string;
  created_at: string;
}

export interface Checkin {
  id: string;
  person_id: string;
  checkin_date: string; // YYYY-MM-DD
  bodyweight: number | null;
  readiness: number | null;
  note: string | null;
  created_at: string;
  source?: 'app' | 'sheet_import';
}

export const emptyPerson = (): PersonDraft => ({
  email: '', first_name: '', last_name: '', aliases: [], trackman_pitcher_id: null,
  is_pitcher: false, is_position_player: false, is_individual_pro: false,
  is_coach: false, coach_can_edit: true, is_admin: false, active: true, goal_weight: null, goods_note: null,
});

export const fullName = (p: Pick<Person, 'first_name' | 'last_name'>) => `${p.first_name} ${p.last_name}`.trim();
export const initials = (p: Pick<Person, 'first_name' | 'last_name'>) =>
  `${p.first_name[0] ?? ''}${p.last_name[0] ?? ''}`.toUpperCase();

export const roleLabels = (p: Person): string[] => {
  const r: string[] = [];
  if (p.is_pitcher) r.push('Pitcher');
  if (p.is_position_player) r.push('Position player');
  if (p.is_individual_pro) r.push('Individual/Pro');
  if (p.is_coach) r.push(p.is_admin ? 'Admin' : p.coach_can_edit ? 'Coach' : 'Coach (view only)');
  return r;
};

export interface Category { category: string; subcategory: string; sort_order: number; }

export interface Exercise {
  id: string;
  name: string;
  category: string;
  subcategory: string | null;
  body_area: string | null;
  video_url: string | null;
  also_fits: string | null;
  /** Extra "Category > Subcategory" places picked in the app (the sheet sync never touches these) */
  extra_fits?: string[];
  old_names: string[];
  active: boolean;
}
export type ExerciseDraft = Omit<Exercise, 'id'>;

export const DRILL_TYPES = ['Stationary', 'Dynamic', 'Finisher', 'Athletic'] as const;
export const DRILL_FOCUS = [
  'Direction', 'Back Leg', 'Front Leg', 'Arm Action', 'Athleticism', 'Drift', 'Relaxation / Early Extension', 'Front Side',
] as const;

/** Everywhere an exercise fits: the sheet's "Also Fits" (split on ;) plus the app's extra picks. */
export const fitsOf = (e: Pick<Exercise, 'also_fits' | 'extra_fits'>) => [...new Set([
  ...(e.also_fits ?? '').split(';').map(s => s.trim()).filter(s => s.includes('>')).map(s => s.replace(/\s*>\s*/, ' > ')),
  ...(e.extra_fits ?? []),
])];

export interface NewGoodsItem {
  person_id: string;
  day: 'A' | 'B' | 'any';
  section: GoodsSection;
  exercise_id: string | null;
  drill_id: string | null;
  dose: string | null;
  balls: string | null;
  note: string | null;
  sort_order: number;
}

export interface Drill {
  id: string;
  name: string;
  drill_type: (typeof DRILL_TYPES)[number];
  reps: string | null;
  ball_type: string | null;
  video_url: string | null;
  also_fits: string | null;
  /** What the drill targets: coaches only */
  focus?: string[];
  old_names: string[];
  active: boolean;
}
export type DrillDraft = Omit<Drill, 'id'>;

export type GoodsSection = 'soft_tissue' | 'correctives' | 'feels' | 'half_plyos' | 'full_plyos';
export interface GoodsItem {
  id: string;
  person_id: string;
  day: 'A' | 'B' | 'any';
  section: GoodsSection;
  sort_order: number;
  name: string;
  dose: string | null;
  balls: string | null;
  note: string | null;
  video_url: string | null;
}
export const GOODS_LABELS: Record<GoodsSection, string> = {
  soft_tissue: 'Soft tissue', correctives: 'Correctives', feels: 'Feels (pre-throw)',
  half_plyos: 'Half plyos', full_plyos: 'Full plyos',
};

export type VideoStatus = 'auto' | 'manual' | 'unmatched' | 'ignored';
export interface Video {
  id: string;
  youtube_id: string;
  title: string;
  published_at: string | null;
  recorded_on: string | null;   // YYYY-MM-DD
  video_type: string | null;
  person_id: string | null;
  match_status: VideoStatus;
  match_note: string | null;
}
export type VideoPatch = Partial<Pick<Video, 'person_id' | 'match_status' | 'video_type' | 'recorded_on'>>;

export interface LibrarySync {
  ran_at: string;
  ex_in_sheet: number; ex_added: number; ex_updated: number;
  drills_in_sheet: number; drills_added: number; drills_updated: number;
  app_only: number;
  skipped: { tab: string; name: string; why: string }[];
}
