import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Category, Checkin, Drill, DrillDraft, Exercise, ExerciseDraft, Goal, GoalKind, Group, Membership, Person, PersonDraft } from './types';
import { demoApi } from './demo';

export interface Api {
  mode: 'live' | 'demo';
  /** Signed-in Google email, or null if signed out */
  sessionEmail(): Promise<string | null>;
  onAuthChange(cb: () => void): () => void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  /** Links the Google account to the roster. Null = not invited. */
  me(): Promise<Person | null>;

  listPeople(): Promise<Person[]>;
  addPerson(p: PersonDraft): Promise<Person>;
  updatePerson(id: string, patch: Partial<PersonDraft>): Promise<Person>;

  listGroups(): Promise<Group[]>;
  listMemberships(): Promise<Membership[]>;
  createGroup(name: string): Promise<Group>;
  setGroups(personId: string, groupIds: string[]): Promise<void>;

  currentGoals(personId: string): Promise<Partial<Record<GoalKind, Goal>>>;
  addGoal(personId: string, kind: GoalKind, body: string): Promise<void>;

  checkinFor(personId: string, day: string): Promise<Checkin | null>;
  saveCheckin(c: Pick<Checkin, 'person_id' | 'checkin_date' | 'bodyweight' | 'readiness' | 'note'>): Promise<Checkin>;
  checkinsOn(day: string): Promise<Checkin[]>;
  checkinHistory(personId: string, days: number): Promise<Checkin[]>;

  listCategories(): Promise<Category[]>;
  listExercises(): Promise<Exercise[]>;
  saveExercise(id: string | null, e: ExerciseDraft): Promise<Exercise>;
  listDrills(): Promise<Drill[]>;
  saveDrill(id: string | null, d: DrillDraft): Promise<Drill>;
}

const cleanName = (msg: string) => /duplicate|unique/i.test(msg) ? 'Something with that name is already in the library.' : msg;

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

function liveApi(sb: SupabaseClient): Api {
  return {
    mode: 'live',
    async sessionEmail() {
      const { data } = await sb.auth.getSession();
      return data.session?.user.email ?? null;
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange(() => cb());
      return () => data.subscription.unsubscribe();
    },
    async signIn() {
      await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
      });
    },
    async signOut() { await sb.auth.signOut(); },
    async me() {
      const id = must(await sb.rpc('claim_profile')) as string | null;
      if (!id) return null;
      return must(await sb.from('people').select('*').eq('id', id).single()) as Person;
    },

    async listPeople() {
      return must(await sb.from('people').select('*').order('last_name').order('first_name')) as Person[];
    },
    async addPerson(p) {
      return must(await sb.from('people').insert({ ...p, email: p.email.trim().toLowerCase() }).select().single()) as Person;
    },
    async updatePerson(id, patch) {
      const body = patch.email ? { ...patch, email: patch.email.trim().toLowerCase() } : patch;
      const rows = must(await sb.from('people').update(body).eq('id', id).select()) as Person[];
      if (!rows.length) throw new Error('You do not have permission to make that change.');
      return rows[0];
    },

    async listGroups() { return must(await sb.from('groups').select('id,name').order('name')) as Group[]; },
    async listMemberships() { return must(await sb.from('group_members').select('group_id,person_id')) as Membership[]; },
    async createGroup(name) { return must(await sb.from('groups').insert({ name }).select('id,name').single()) as Group; },
    async setGroups(personId, groupIds) {
      const current = (must(await sb.from('group_members').select('group_id').eq('person_id', personId)) as { group_id: string }[]).map(r => r.group_id);
      const add = groupIds.filter(g => !current.includes(g));
      const remove = current.filter(g => !groupIds.includes(g));
      if (add.length) must(await sb.from('group_members').insert(add.map(group_id => ({ group_id, person_id: personId }))));
      if (remove.length) must(await sb.from('group_members').delete().eq('person_id', personId).in('group_id', remove));
    },

    async currentGoals(personId) {
      const rows = must(await sb.from('current_goals').select('*').eq('person_id', personId)) as Goal[];
      return Object.fromEntries(rows.map(g => [g.kind, g]));
    },
    async addGoal(personId, kind, body) {
      must(await sb.from('goals').insert({ person_id: personId, kind, body }));
    },

    async checkinFor(personId, day) {
      const rows = must(await sb.from('current_checkins').select('*').eq('person_id', personId).eq('checkin_date', day)) as Checkin[];
      return rows[0] ?? null;
    },
    async saveCheckin(c) {
      return must(await sb.from('checkins').insert(c).select().single()) as Checkin;
    },
    async checkinsOn(day) {
      return must(await sb.from('current_checkins').select('*').eq('checkin_date', day)) as Checkin[];
    },
    async checkinHistory(personId, days) {
      const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      return must(await sb.from('current_checkins').select('*').eq('person_id', personId)
        .gte('checkin_date', since).order('checkin_date', { ascending: false })) as Checkin[];
    },

    async listCategories() {
      return must(await sb.from('exercise_categories').select('*').order('sort_order')) as Category[];
    },
    async listExercises() {
      return must(await sb.from('exercises').select('*').order('name').range(0, 4999)) as Exercise[];
    },
    async saveExercise(id, e) {
      const r = id ? await sb.from('exercises').update(e).eq('id', id).select().single() : await sb.from('exercises').insert(e).select().single();
      if (r.error) throw new Error(cleanName(r.error.message));
      return r.data as Exercise;
    },
    async listDrills() {
      return must(await sb.from('throwing_drills').select('*').order('name')) as Drill[];
    },
    async saveDrill(id, d) {
      const r = id ? await sb.from('throwing_drills').update(d).eq('id', id).select().single() : await sb.from('throwing_drills').insert(d).select().single();
      if (r.error) throw new Error(cleanName(r.error.message));
      return r.data as Drill;
    },
  };
}

export const api: Api = url && key ? liveApi(createClient(url, key)) : demoApi();
