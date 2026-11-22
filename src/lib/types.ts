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
}

export type PersonDraft = Omit<Person, 'id' | 'auth_user_id' | 'first_signed_in_at'>;

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
  readiness: number;
  note: string | null;
  created_at: string;
}

export const emptyPerson = (): PersonDraft => ({
  email: '', first_name: '', last_name: '', aliases: [], trackman_pitcher_id: null,
  is_pitcher: false, is_position_player: false, is_individual_pro: false,
  is_coach: false, coach_can_edit: true, is_admin: false, active: true,
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
