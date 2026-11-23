import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Category, Checkin, GoodsItem, Drill, DrillDraft, Exercise, ExerciseDraft, Goal, GoalKind, Group, LibrarySync, Membership, Person, PersonDraft, Video, VideoPatch } from './types';
import { demoApi } from './demo';
import { addDays, isoDay } from './dates';
import type { SprintResult, SprintSession, SprintType } from './sprints';
import type { Assignment, BlockDay, LiftBlock, LiftPrep, PrepItem, RehabSwitch, SetLog } from './lifts';

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

  currentGoods(personId: string): Promise<GoodsItem[]>;

  listBlocks(): Promise<LiftBlock[]>;
  savePrep(block: LiftBlock, day: BlockDay, items: PrepItem[]): Promise<LiftPrep>;
  assignmentsFor(personId: string | null): Promise<Assignment[]>;
  assignBlock(blockId: string, personIds: string[], startDate: string): Promise<number>;
  endAssignment(id: string): Promise<void>;
  rehabSwitches(personId: string | null): Promise<RehabSwitch[]>;
  setRehab(personId: string, blockExerciseId: string, on: boolean): Promise<void>;
  setLogs(opts: { personId?: string; from: string; to: string; blockExerciseIds?: string[] }): Promise<SetLog[]>;
  logSet(row: Omit<SetLog, 'id' | 'created_at'>): Promise<SetLog>;

  listCategories(): Promise<Category[]>;
  listExercises(): Promise<Exercise[]>;
  saveExercise(id: string | null, e: ExerciseDraft): Promise<Exercise>;
  listDrills(): Promise<Drill[]>;
  saveDrill(id: string | null, d: DrillDraft): Promise<Drill>;
  lastLibrarySync(): Promise<LibrarySync | null>;

  /** personId = one athlete; null = everything a coach can see */
  listVideos(personId: string | null): Promise<Video[]>;
  updateVideo(id: string, patch: VideoPatch): Promise<void>;
  rematchVideos(): Promise<number>;

  /** Raw times (not removed). personId null = everyone a coach can see. */
  sprintResults(personId: string | null): Promise<SprintResult[]>;
  logSprint(r: { person_id: string; sprint: SprintType; run_date: string; seconds: number; source?: 'app' | 'coach' }): Promise<SprintResult>;
  removeSprint(id: string): Promise<void>;
  /** Best per testing week with medals: one athlete, or the whole team for coaches. */
  sprintHistory(personId: string): Promise<SprintSession[]>;
  sprintBoard(): Promise<SprintSession[]>;
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
      const since = addDays(isoDay(), -days);
      return must(await sb.from('current_checkins').select('*').eq('person_id', personId)
        .gte('checkin_date', since).order('checkin_date', { ascending: false })) as Checkin[];
    },

    async currentGoods(personId) {
      return must(await sb.from('current_goods').select('*').eq('person_id', personId).order('sort_order')) as GoodsItem[];
    },

    async listBlocks() {
      const rows = must(await sb.from('lift_blocks')
        .select('*, days:block_days(*, prep:lift_preps(*), exercises:block_exercises(*, exercise:exercises(name, video_url)))')
        .order('name')) as LiftBlock[];
      for (const b of rows) {
        b.days.sort((a, c) => a.weekday - c.weekday);
        for (const d of b.days) d.exercises.sort((a, c) => a.sort_order - c.sort_order);
      }
      // Lifting Prep items: use the Library's current video link
      const ids = [...new Set(rows.flatMap(b => b.days.flatMap(d => (d.prep?.items ?? []).map(i => i.exercise_id).filter(Boolean))))] as string[];
      if (ids.length) {
        const vids = must(await sb.from('exercises').select('id, video_url').in('id', ids)) as { id: string; video_url: string | null }[];
        const m = new Map(vids.map(v => [v.id, v.video_url]));
        for (const b of rows) for (const d of b.days) for (const i of d.prep?.items ?? []) if (i.exercise_id && m.get(i.exercise_id)) i.video_url = m.get(i.exercise_id)!;
      }
      return rows;
    },
    async savePrep(block, day, items) {
      if (day.prep_id) {
        return must(await sb.from('lift_preps').update({ items }).eq('id', day.prep_id).select().single()) as LiftPrep;
      }
      const name = `${block.name} · ${['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day.weekday]} Lifting Prep`;
      const prep = must(await sb.from('lift_preps').insert({ name, items }).select().single()) as LiftPrep;
      must(await sb.from('block_days').update({ prep_id: prep.id }).eq('id', day.id));
      return prep;
    },
    async assignmentsFor(personId) {
      let q = sb.from('block_assignments').select('*').eq('active', true);
      if (personId) q = q.eq('person_id', personId);
      return must(await q) as Assignment[];
    },
    async assignBlock(blockId, personIds, startDate) {
      if (!personIds.length) return 0;
      const rows = personIds.map(person_id => ({ block_id: blockId, person_id, start_date: startDate }));
      const r = must(await sb.from('block_assignments').upsert(rows, { onConflict: 'block_id,person_id,start_date', ignoreDuplicates: true }).select('id')) as { id: string }[];
      return r.length;
    },
    async endAssignment(id) { must(await sb.from('block_assignments').update({ active: false }).eq('id', id)); },
    async rehabSwitches(personId) {
      let q = sb.from('rehab_switches').select('*').eq('active', true);
      if (personId) q = q.eq('person_id', personId);
      return must(await q) as RehabSwitch[];
    },
    async setRehab(personId, blockExerciseId, on) {
      if (on) must(await sb.from('rehab_switches').insert({ person_id: personId, block_exercise_id: blockExerciseId }));
      else must(await sb.from('rehab_switches').update({ active: false }).eq('person_id', personId).eq('block_exercise_id', blockExerciseId).eq('active', true));
    },
    async setLogs({ personId, from, to, blockExerciseIds }) {
      let q = sb.from('current_set_logs').select('*').gte('log_date', from).lte('log_date', to);
      if (personId) q = q.eq('person_id', personId);
      if (blockExerciseIds?.length) q = q.in('block_exercise_id', blockExerciseIds);
      return must(await q.order('log_date', { ascending: false }).range(0, 4999)) as SetLog[];
    },
    async logSet(row) {
      return must(await sb.from('set_logs').insert(row).select().single()) as SetLog;
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
    async lastLibrarySync() {
      const rows = must(await sb.from('library_sync_log').select('*').order('ran_at', { ascending: false }).limit(1)) as LibrarySync[];
      return rows[0] ?? null;
    },

    async listVideos(personId) {
      let q = sb.from('videos').select('id,youtube_id,title,published_at,recorded_on,video_type,person_id,match_status,match_note');
      if (personId) q = q.eq('person_id', personId).in('match_status', ['auto', 'manual']);
      return must(await q.order('recorded_on', { ascending: false }).order('published_at', { ascending: false }).range(0, 1999)) as Video[];
    },
    async updateVideo(id, patch) {
      const rows = must(await sb.from('videos').update(patch).eq('id', id).select('id')) as { id: string }[];
      if (!rows.length) throw new Error('You do not have permission to change that video.');
    },
    async rematchVideos() { return must(await sb.rpc('rematch_videos')) as number; },

    async sprintResults(personId) {
      let q = sb.from('sprint_results').select('*').is('retired_at', null);
      if (personId) q = q.eq('person_id', personId);
      return must(await q.order('run_date', { ascending: false }).range(0, 9999)) as SprintResult[];
    },
    async logSprint(r) {
      return must(await sb.from('sprint_results').insert({ source: 'app', ...r }).select().single()) as SprintResult;
    },
    async removeSprint(id) {
      const rows = must(await sb.from('sprint_results').update({ retired_at: new Date().toISOString() }).eq('id', id).select('id')) as { id: string }[];
      if (!rows.length) throw new Error('That time could not be removed.');
    },
    async sprintHistory(personId) { return must(await sb.rpc('sprint_history', { p_person: personId })) as SprintSession[]; },
    async sprintBoard() { return must(await sb.rpc('sprint_board')) as SprintSession[]; },
  };
}

const realApi: Api = url && key ? liveApi(createClient(url, key)) : demoApi();

/**
 * Coach "Preview as athlete": while on, every write is skipped.
 * Check-ins and set logs come back looking saved so the screens behave
 * normally, but nothing reaches the database.
 */
let previewing = false;
export function setPreviewing(on: boolean) { previewing = on; }
const WRITES = new Set<string>([
  'signOut', 'addPerson', 'updatePerson', 'createGroup', 'setGroups', 'addGoal', 'saveCheckin',
  'savePrep', 'assignBlock', 'endAssignment', 'setRehab', 'logSet', 'saveExercise', 'saveDrill',
  'updateVideo', 'rematchVideos', 'logSprint', 'removeSprint',
]);
const fakeSaved = (row: object) => ({
  id: `preview-${Math.random().toString(36).slice(2)}`, created_at: new Date().toISOString(),
  recorded_at: new Date().toISOString(), ...row,
});
export const api: Api = new Proxy(realApi, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (previewing && typeof prop === 'string' && WRITES.has(prop)) {
      return async (arg?: object) => (prop === 'saveCheckin' || prop === 'logSet' || prop === 'logSprint') ? fakeSaved({ retired_at: null, ...(arg ?? {}) }) : undefined;
    }
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
