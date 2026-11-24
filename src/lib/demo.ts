import { computeSessions, computeSpotlight, type SprintResult } from './sprints';
// Demo mode: runs entirely in the browser with sample data, used until the
// app is connected to Supabase. Nothing here leaves the device.
import type { Api } from './api';
import type { Assignment, LiftBlock, RehabSwitch, SetLog } from './lifts';
import type { Category, Checkin, GoodsItem, Drill, Exercise, Goal, Group, Membership, Person } from './types';
import { addDays, isoDay } from './dates';
import { KINDS, type ThrowDay, type ThrowKind, type ThrowLog, type ThrowProgram } from './throwing';

const KEY = 'raidergang-demo-v1';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const now = () => new Date().toISOString();

interface Db { people: Person[]; groups: Group[]; members: Membership[]; goals: Goal[]; checkins: Checkin[]; session: string | null;
  categories?: Category[]; exercises?: Exercise[]; drills?: Drill[];
  assignments?: Assignment[]; rehab?: RehabSwitch[]; setLogs?: SetLog[]; sprints?: SprintResult[]; }

let blocksCache: LiftBlock[] | null = null;
async function demoBlocks(): Promise<LiftBlock[]> {
  if (!blocksCache) blocksCache = (await import('./demoBlocks.json')).default as unknown as LiftBlock[];
  return blocksCache;
}
async function withLifts(): Promise<Db> {
  const d = load();
  if (!d.assignments) {
    const blocks = await demoBlocks();
    const starts = ['2026-11-23', '2026-12-21'];
    d.assignments = d.people.filter(p => !p.is_coach).flatMap(p => blocks.map((b, i) => ({ id: uid(), block_id: b.id, person_id: p.id, start_date: starts[i] ?? starts[0], active: true })));
    d.rehab = []; d.setLogs = [];
    save(d);
  }
  return d;
}

const base = (p: Partial<Person> & Pick<Person, 'email' | 'first_name' | 'last_name'>): Person => ({
  id: uid(), aliases: [], trackman_pitcher_id: null, is_pitcher: false, is_position_player: false,
  is_individual_pro: false, is_coach: false, coach_can_edit: true, is_admin: false, active: true,
  auth_user_id: null, first_signed_in_at: null, goal_weight: null, goods_note: null, ...p,
});

function seed(): Db {
  const people = [
    base({ email: 'coach.martinez@example.com', first_name: 'Myles', last_name: 'Martinez', is_coach: true, is_admin: true }),
    base({ email: 'coach.ferrick@example.com', first_name: 'Travis', last_name: 'Ferrick', is_coach: true }),
    base({ email: 'connor.jarvis@example.com', first_name: 'Connor', last_name: 'Jarvis', is_pitcher: true, goal_weight: '204-207', goods_note: 'Get after it this winter.', throw_velo: 90.2 }),
    base({ email: 'ethan.wood@example.com', first_name: 'Ethan', last_name: 'Wood', is_position_player: true }),
    base({ email: 'pitcher.two@example.com', first_name: 'Sample', last_name: 'Pitcher', is_pitcher: true }),
  ];
  const groups = [{ id: uid(), name: 'Group 1' }, { id: uid(), name: 'Group 2' }];
  const members = [{ group_id: groups[0].id, person_id: people[2].id }, { group_id: groups[1].id, person_id: people[4].id }];
  const today = isoDay();
  const checkins: Checkin[] = [];
  [8, 7, 9, 6, 8, 7].forEach((r, i) => checkins.push({ id: uid(), person_id: people[2].id, checkin_date: addDays(today, -(i + 1)), bodyweight: 201 + i * 0.3, readiness: r, note: null, created_at: now() }));
  checkins.push({ id: uid(), person_id: people[4].id, checkin_date: today, bodyweight: 188.2, readiness: 3, note: 'Elbow a little sore', created_at: now() });
  checkins.push({ id: uid(), person_id: people[3].id, checkin_date: today, bodyweight: 196.0, readiness: 9, note: null, created_at: now() });
  const goals: Goal[] = [
    { id: uid(), person_id: people[2].id, kind: 'body', body: 'Sample: get to goal weight and hold it through the spring.', created_at: now() },
    { id: uid(), person_id: people[2].id, kind: 'ball', body: 'Sample: tighten the slider and land it for strikes.', created_at: now() },
    { id: uid(), person_id: people[2].id, kind: 'game', body: 'Sample: attack the zone and win the first pitch.', created_at: now() },
  ];
  return { people, groups, members, goals, checkins, session: null };
}

function load(): Db {
  try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch { /* ignore */ }
  const d = seed(); save(d); return d;
}
function save(d: Db) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* ignore */ } }

const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

/** Demo library lives in memory too: browser storage can be too small for it, which would re-number it on every load. */
let libCache: Pick<Db, 'categories' | 'exercises' | 'drills'> | null = null;
let libLoading: Promise<void> | null = null;
// ---- Throwing (demo): two tracks built from a simple weekly pattern around today ----
const throwProgramsDemo: ThrowProgram[] = [{ id: 'trk-a', name: 'Track A', active: true }, { id: 'trk-b', name: 'Track B', active: true }];
const throwDaysDemo = new Map<string, ThrowDay>();   // key program|day
const throwAssignDemo = new Map<string, string>();   // person -> program
const throwVeloDemo = new Map<string, number | null>();
const throwLogsDemo: ThrowLog[] = [];
function demoThrowDay(programId: string, day: string): ThrowDay | null {
  const k = `${programId}|${day}`;
  if (throwDaysDemo.has(k)) return throwDaysDemo.get(k)!;
  const wd = (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7; // 0 = Mon
  const b = programId === 'trk-b';
  const plan: [ThrowKind, string, string | null][] = b
    ? [['Low', 'Light catch play', null], ['Off', 'Off', null], ['Low', 'Light catch play', null], ['Off', 'Off', null], ['Low', 'Light catch play', null], ['Off', 'Off', null], ['Off', 'Off', null]]
    : [['Low', 'Long toss ~105 ft', '~105 ft'], ['Medium', 'Long toss ~130 ft', '~130 ft'], ['Off', 'Off', null], ['Medium', 'Long toss ~140 ft', '~140 ft'], ['Medium', 'Long toss ~150 ft (peak)', '~150 ft'], ['Off', 'Off', null], ['Off', 'Off', null]];
  const [kind, title, distance] = plan[wd];
  const d: ThrowDay = { id: `${programId}-${day}`, program_id: programId, day, kind, title, sp_title: null, distance,
    catch_play: KINDS[kind].catchPlay, plyos: KINDS[kind].plyos,
    note: kind === 'Off' ? 'Full rest — no throwing.' : kind === 'Low' && b ? '15-20 min flat-ground catch, no intent.' : 'Stretch-out long toss, building toward this week\'s peak.' };
  return d;
}
function demoThrowRange(programId: string, from: string, to: string) {
  const out: ThrowDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) { const x = demoThrowDay(programId, d); if (x) out.push(x); }
  return out;
}

const goodsGone = new Set<string>();
const goodsAdded: GoodsItem[] = [];
function demoGoodsBase(personId: string): GoodsItem[] {
      const mk = (day: GoodsItem['day'], section: GoodsItem['section'], name: string, dose: string, i: number, balls: string | null = null): GoodsItem =>
        ({ id: `${personId}-${section}-${day}-${i}`, person_id: personId, day, section, sort_order: i, name, dose, balls, note: null, video_url: 'https://youtube.com' });
      return [
        mk('A', 'soft_tissue', 'Thoracic Spine Soft Tissue', '1-3 min', 0), mk('A', 'soft_tissue', 'Posterior Cuff Soft Tissue 1', '1-3 min', 1),
        mk('A', 'correctives', 'Shoulder CARs/Circles on Wall', '1 x 10 ea', 0), mk('A', 'correctives', 'Spinal Hygiene (WSU)', 'Until Comfort', 1),
        mk('B', 'soft_tissue', 'Hip Soft Tissue', '1-3 min', 0), mk('B', 'correctives', 'Elevated Pigeon Stretch', '2 x 45 sec', 0),
        mk('any', 'feels', 'Med Ball Duo (OH + Scoop Primer)', '2 x 5 ea', 0),
        mk('any', 'half_plyos', 'Deadman Throws', '1-2 x 5-8', 0, 'Yellow, Red'), mk('any', 'full_plyos', 'Drop Step on Mound', '1-2 x 5-8', 0, 'Red, White, Grey'),
      ];
    }

async function withLibrary(): Promise<Db> {
  if (!libCache) libLoading ??= buildLibrary();
  await libLoading;
  const d = load();
  d.categories = libCache!.categories; d.exercises = libCache!.exercises; d.drills = libCache!.drills;
  return d;
}
async function buildLibrary(): Promise<void> {
  const d = load();
  {
    if (d.exercises && d.drills && d.categories) libCache = { categories: d.categories, exercises: d.exercises, drills: d.drills };
    else {
      const lib = (await import('./demoLibrary.json')).default as {
        categories: Category[];
        exercises: Omit<Exercise, 'id' | 'old_names' | 'active'>[];
        drills: Omit<Drill, 'id' | 'old_names' | 'active'>[];
      };
      libCache = {
        categories: lib.categories,
        exercises: lib.exercises.map(e => ({ ...e, id: uid(), old_names: [], active: true })),
        drills: lib.drills.map(x => ({ ...x, id: uid(), old_names: [], active: true })),
      };
    }
  }
}

export function demoApi(): Api & { signInAs(email: string): void; demoAccounts(): Person[]; reset(): void } {
  const currentOf = (rows: Checkin[]) => {
    const m = new Map<string, Checkin>();
    for (const c of rows) {
      const k = c.person_id + c.checkin_date;
      const prev = m.get(k);
      if (!prev || prev.created_at < c.created_at) m.set(k, c);
    }
    return [...m.values()];
  };
  return {
    mode: 'demo',
    async sessionEmail() { return load().session; },
    onAuthChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    async signIn() { /* handled by signInAs in demo */ },
    signInAs(email) { const d = load(); d.session = email; save(d); emit(); },
    demoAccounts() { return load().people.filter(p => p.active).concat([base({ email: 'not.invited@example.com', first_name: 'Not', last_name: 'Invited' })]); },
    reset() { localStorage.removeItem(KEY); emit(); },
    async signOut() { const d = load(); d.session = null; save(d); emit(); },
    async me() {
      const d = load();
      const p = d.people.find(x => x.email === d.session && x.active);
      if (p && !p.first_signed_in_at) { p.first_signed_in_at = now(); p.auth_user_id = 'demo'; save(d); }
      return p ?? null;
    },
    async listPeople() { return [...load().people].sort((a, b) => a.last_name.localeCompare(b.last_name)); },
    async addPerson(p) {
      const d = load();
      const email = p.email.trim().toLowerCase();
      if (d.people.some(x => x.email === email)) throw new Error('That email is already on the roster.');
      const row = base({ ...p, email }); d.people.push(row); save(d); return row;
    },
    async updatePerson(id, patch) {
      const d = load(); const p = d.people.find(x => x.id === id); if (!p) throw new Error('Not found');
      Object.assign(p, patch); save(d); return p;
    },
    async listGroups() { return load().groups; },
    async listMemberships() { return load().members; },
    async createGroup(name) { const d = load(); const g = { id: uid(), name }; d.groups.push(g); save(d); return g; },
    async setGroups(personId, groupIds) {
      const d = load(); d.members = d.members.filter(m => m.person_id !== personId).concat(groupIds.map(group_id => ({ group_id, person_id: personId }))); save(d);
    },
    async currentGoals(personId) {
      const out: Partial<Record<Goal['kind'], Goal>> = {};
      for (const g of load().goals.filter(g => g.person_id === personId)) if (!out[g.kind] || out[g.kind]!.created_at < g.created_at) out[g.kind] = g;
      return out;
    },
    async addGoal(personId, kind, body) { const d = load(); d.goals.push({ id: uid(), person_id: personId, kind, body, created_at: now() }); save(d); },
    async checkinFor(personId, day) { return currentOf(load().checkins).find(c => c.person_id === personId && c.checkin_date === day) ?? null; },
    async saveCheckin(c) { const d = load(); const row = { ...c, id: uid(), created_at: now() }; d.checkins.push(row); save(d); return row; },
    async checkinsOn(day) { return currentOf(load().checkins).filter(c => c.checkin_date === day); },
    async checkinHistory(personId, days) {
      const since = addDays(isoDay(), -days);
      return currentOf(load().checkins).filter(c => c.person_id === personId && c.checkin_date >= since).sort((a, b) => b.checkin_date.localeCompare(a.checkin_date));
    },
    async currentGoods(personId) {
      const p = load().people.find(x => x.id === personId);
      if (!p?.is_pitcher) return [];
      return demoGoodsBase(personId).concat(goodsAdded.filter(g => g.person_id === personId)).filter(g => !goodsGone.has(g.id));
    },
    async removeGoods(ids) { const out = ids.filter(i => !goodsGone.has(i)); out.forEach(i => goodsGone.add(i)); return out; },
    async clearGoods(personIds, sections) {
      const out: string[] = [];
      for (const pid of personIds) for (const g of await this.currentGoods(pid)) if (!sections || sections.includes(g.section)) { goodsGone.add(g.id); out.push(g.id); }
      return out;
    },
    async throwPrograms() { return throwProgramsDemo.slice(); },
    async throwDays(programId, from, to) { return demoThrowRange(programId, from, to); },
    async saveThrowDay(programId, day, d) {
      const row: ThrowDay = { id: `${programId}-${day}`, program_id: programId, day, ...d };
      throwDaysDemo.set(`${programId}|${day}`, row); return row;
    },
    async copyThrowProgram(fromId, name) {
      const id = uid(); throwProgramsDemo.push({ id, name, active: true });
      for (const [k, v] of throwDaysDemo) if (k.startsWith(fromId + '|')) throwDaysDemo.set(`${id}|${v.day}`, { ...v, program_id: id });
      return id;
    },
    async throwAssignments() {
      for (const p of load().people) if (p.is_pitcher && !p.is_coach && !throwAssignDemo.has(p.id)) throwAssignDemo.set(p.id, p.last_name === 'Jarvis' ? 'trk-b' : 'trk-a');
      return [...throwAssignDemo].filter(([, v]) => v).map(([person_id, program_id]) => ({ person_id, program_id }));
    },
    async setThrowProgram(personId, programId) { if (programId) throwAssignDemo.set(personId, programId); else throwAssignDemo.delete(personId); },
    async setThrowVelo(personId, mph) {
      throwVeloDemo.set(personId, mph);
      const d = load(); const p = d.people.find(x => x.id === personId); if (p) { p.throw_velo = mph; save(d); }
    },
    async throwLogs({ personId, from, to }) {
      const m = new Map<string, ThrowLog>();
      for (const l of throwLogsDemo) if ((!personId || l.person_id === personId) && l.day >= from && l.day <= to) m.set(`${l.person_id}|${l.day}`, l);
      return [...m.values()].sort((a, b) => b.day.localeCompare(a.day));
    },
    async logThrow(row) { const l: ThrowLog = { ...row, id: uid(), created_at: now() }; throwLogsDemo.push(l); return l; },
    async myThrowing(personId, from, to) {
      await this.throwAssignments();
      const pid = throwAssignDemo.get(personId);
      const program = throwProgramsDemo.find(p => p.id === pid) ?? null;
      return { program, days: program ? demoThrowRange(program.id, from, to) : [] };
    },
    async pushPublicKey() { return null; },
    async savePushSubscription() { /* demo */ },
    async sendTestPush() { /* demo */ },
    async pushStatus() { return { athletes: load().people.filter(p => p.active && !p.is_coach).length, with_reminders: 0 }; },
    async restoreGoods(ids) { ids.forEach(i => goodsGone.delete(i)); return ids.length; },
    async listBlocks() { return structuredClone(await demoBlocks()); },
    async copyBlock(blockId, name) {
      const all = await demoBlocks();
      const b = all.find(x => x.id === blockId); if (!b) throw new Error('No such block');
      const c = structuredClone(b); c.id = uid(); c.name = name;
      for (const d of c.days) { d.id = uid(); d.block_id = c.id; for (const e of d.exercises) { e.id = uid(); e.block_day_id = d.id; } }
      all.push(c); return c.id;
    },
    async updateBlockDay(id, patch) { for (const b of await demoBlocks()) for (const d of b.days) if (d.id === id) Object.assign(d, patch); },
    async updateBlockExercise(id, patch) {
      const lib = (await withLibrary()).exercises!;
      for (const b of await demoBlocks()) for (const d of b.days) for (const e of d.exercises) if (e.id === id) {
        Object.assign(e, patch);
        if ('exercise_id' in patch) { const x = lib.find(l => l.id === patch.exercise_id); e.exercise = x ? { name: x.name, video_url: x.video_url } : null; }
      }
    },
    async addBlockExercise(row) {
      const lib = (await withLibrary()).exercises!;
      const x = lib.find(l => l.id === row.exercise_id);
      for (const b of await demoBlocks()) for (const d of b.days) if (d.id === row.block_day_id)
        d.exercises.push({ ...row, id: uid(), video_url: null, result_label: null, exercise: x ? { name: x.name, video_url: x.video_url } : null });
    },
    async removeBlockExercise(id) {
      const d0 = await withLifts();
      if (d0.setLogs!.some(l => l.block_exercise_id === id)) throw new Error("Athletes already logged sets on this exercise, so it can't be removed. Swap the exercise instead.");
      for (const b of await demoBlocks()) for (const d of b.days) d.exercises = d.exercises.filter(e => e.id !== id);
    },
    async savePrep(_block, day, items) {
      const prep = { id: day.prep_id ?? uid(), name: day.prep?.name ?? 'Lifting Prep', items };
      for (const b of await demoBlocks()) for (const d of b.days) if (d.id === day.id) { d.prep = prep; d.prep_id = prep.id; }
      return prep;
    },
    async assignmentsFor(personId) { const d = await withLifts(); return d.assignments!.filter(a => a.active && (!personId || a.person_id === personId)); },
    async assignBlock(blockId, personIds, startDate) {
      const d = await withLifts(); let n = 0;
      for (const person_id of personIds) {
        if (d.assignments!.some(a => a.block_id === blockId && a.person_id === person_id && a.active)) continue;
        d.assignments!.push({ id: uid(), block_id: blockId, person_id, start_date: startDate, active: true }); n++;
      }
      save(d); return n;
    },
    async endAssignment(id) { const d = await withLifts(); const a = d.assignments!.find(x => x.id === id); if (a) a.active = false; save(d); },
    async rehabSwitches(personId) { const d = await withLifts(); return d.rehab!.filter(r => r.active && (!personId || r.person_id === personId)); },
    async setRehab(personId, blockExerciseId, on) {
      const d = await withLifts();
      if (on) d.rehab!.push({ id: uid(), person_id: personId, block_exercise_id: blockExerciseId, active: true });
      else d.rehab!.filter(r => r.person_id === personId && r.block_exercise_id === blockExerciseId).forEach(r => (r.active = false));
      save(d);
    },
    async setLogs({ personId, from, to, blockExerciseIds }) {
      const d = await withLifts(); const m = new Map<string, SetLog>();
      for (const l of d.setLogs!) {
        if (personId && l.person_id !== personId) continue;
        if (l.log_date < from || l.log_date > to) continue;
        if (blockExerciseIds?.length && !blockExerciseIds.includes(l.block_exercise_id)) continue;
        const k = `${l.person_id}|${l.block_exercise_id}|${l.log_date}|${l.set_number}`;
        const prev = m.get(k); if (!prev || prev.created_at < l.created_at) m.set(k, l);
      }
      return [...m.values()].sort((a, b) => b.log_date.localeCompare(a.log_date));
    },
    async logSet(row) { const d = await withLifts(); const r = { ...row, id: uid(), created_at: now() }; d.setLogs!.push(r); save(d); return r; },
    async listCategories() { return (await withLibrary()).categories!; },
    async listExercises() { return [...(await withLibrary()).exercises!].sort((a, b) => a.name.localeCompare(b.name)); },
    async saveExercise(id, e) {
      const d = await withLibrary(); const list = d.exercises!;
      if (list.some(x => x.id !== id && x.name.toLowerCase() === e.name.toLowerCase())) throw new Error('Something with that name is already in the library.');
      let row = list.find(x => x.id === id);
      if (row) Object.assign(row, e); else { row = { ...e, id: uid() }; list.push(row); }
      save(d); return row;
    },
    async listDrills() { return [...(await withLibrary()).drills!].sort((a, b) => a.name.localeCompare(b.name)); },
    async saveDrill(id, dr) {
      const d = await withLibrary(); const list = d.drills!;
      if (list.some(x => x.id !== id && x.name.toLowerCase() === dr.name.toLowerCase())) throw new Error('Something with that name is already in the library.');
      let row = list.find(x => x.id === id);
      if (row) Object.assign(row, dr); else { row = { ...dr, id: uid() }; list.push(row); }
      save(d); return row;
    },
    async lastLibrarySync() { return null; },
    async prescribeGoods(rows) {
      const lib = await withLibrary();
      for (const r of rows) {
        const x = r.exercise_id ? lib.exercises!.find(e => e.id === r.exercise_id) : lib.drills!.find(d => d.id === r.drill_id);
        goodsAdded.push({ id: uid(), person_id: r.person_id, day: r.day, section: r.section, sort_order: r.sort_order, name: x?.name ?? 'Item', dose: r.dose, balls: r.balls, note: r.note, video_url: x?.video_url ?? null });
      }
      return rows.length;
    },
    async listVideos(personId) {
      const p = personId ? load().people.find(x => x.id === personId) : null;
      if (personId && !p?.is_pitcher) return [];
      const someone = personId ?? load().people.find(x => x.is_pitcher)?.id ?? null;
      return [
        { id: 'v1', youtube_id: 'dQw4w9WgXcQ', title: 'Demo Bullpen 11/20', published_at: null, recorded_on: addDays(isoDay(), -3), video_type: 'Bullpen', person_id: someone, match_status: 'auto', match_note: null },
        ...(personId ? [] : [{ id: 'v2', youtube_id: 'dQw4w9WgXcQ', title: 'Bullpen 11/19', published_at: null, recorded_on: addDays(isoDay(), -4), video_type: 'Bullpen', person_id: null, match_status: 'unmatched' as const, match_note: 'No athlete name found in the title' }]),
      ];
    },
    async updateVideo() { /* demo: nothing saved */ },
    async rematchVideos() { return 0; },
    async sprintResults(personId) {
      const d = sprintDb();
      return d.sprints!.filter(r => !r.retired_at && (!personId || r.person_id === personId));
    },
    async logSprint(r) {
      const d = sprintDb();
      const row: SprintResult = { id: uid(), session_label: null, retired_at: null, created_at: now(), source: 'app', ...r };
      d.sprints!.push(row); save(d); return row;
    },
    async removeSprint(id) {
      const d = sprintDb(); const row = d.sprints!.find(r => r.id === id); if (row) { row.retired_at = now(); save(d); }
    },
    async sprintHistory(personId) {
      const d = sprintDb();
      const pitch = new Map(d.people.filter(p => !p.is_coach && p.active).map(p => [p.id, p.is_pitcher]));
      return computeSessions(d.sprints!, id => pitch.get(id) ?? null).filter(s => s.person_id === personId);
    },
    async sprintSpotlight() {
      const d = sprintDb();
      const pitch = new Map(d.people.filter(p => !p.is_coach && p.active).map(p => [p.id, p.is_pitcher]));
      return computeSpotlight(computeSessions(d.sprints!, id => pitch.get(id) ?? null), new Map(d.people.map(p => [p.id, p])));
    },
    async sprintBoard() {
      const d = sprintDb();
      const pitch = new Map(d.people.filter(p => !p.is_coach && p.active).map(p => [p.id, p.is_pitcher]));
      return computeSessions(d.sprints!, id => pitch.get(id) ?? null);
    },
  };
}

/** A little fake fall history so the demo shows PRs and medals. */
function demoSprints(people: Person[]): SprintResult[] {
  const out: SprintResult[] = [];
  const runners = people.filter(p => !p.is_coach && p.active);
  const base: Record<string, number> = { '5/10': 1.26, '10/10': 1.13, '15/10': 1.07, '20/10': 1.04 };
  const weeks = [[1, '5/10'], [2, '10/10'], [3, '15/10'], [4, '20/10'], [5, '5/10'], [6, '10/10']] as const;
  runners.forEach((p, i) => weeks.forEach(([w, s]) => out.push({
    id: uid(), person_id: p.id, sprint: s, run_date: addDays('2026-09-07', (w - 1) * 7), session_label: `Fall Wk ${w}`,
    seconds: Math.round((base[s] + ((i * 7 + w * 3) % 9) / 100) * 100) / 100, source: 'sheet', retired_at: null, created_at: now(),
  })));
  // this week's 10/10s so far (the live board)
  runners.slice(1).forEach((p, i) => out.push({
    id: uid(), person_id: p.id, sprint: '10/10', run_date: isoDay(), session_label: null,
    seconds: 1.10 + i * 0.03, source: 'app', retired_at: null, created_at: now(),
  }));
  return out;
}

function sprintDb(): Db {
  const d = load();
  if (!d.sprints) { d.sprints = demoSprints(d.people); save(d); }
  return d;
}
