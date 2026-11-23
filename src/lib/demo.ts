// Demo mode: runs entirely in the browser with sample data, used until the
// app is connected to Supabase. Nothing here leaves the device.
import type { Api } from './api';
import type { Category, Checkin, GoodsItem, Drill, Exercise, Goal, Group, Membership, Person } from './types';
import { addDays, isoDay } from './dates';

const KEY = 'raidergang-demo-v1';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const now = () => new Date().toISOString();

interface Db { people: Person[]; groups: Group[]; members: Membership[]; goals: Goal[]; checkins: Checkin[]; session: string | null;
  categories?: Category[]; exercises?: Exercise[]; drills?: Drill[]; }

const base = (p: Partial<Person> & Pick<Person, 'email' | 'first_name' | 'last_name'>): Person => ({
  id: uid(), aliases: [], trackman_pitcher_id: null, is_pitcher: false, is_position_player: false,
  is_individual_pro: false, is_coach: false, coach_can_edit: true, is_admin: false, active: true,
  auth_user_id: null, first_signed_in_at: null, goal_weight: null, ...p,
});

function seed(): Db {
  const people = [
    base({ email: 'coach.martinez@example.com', first_name: 'Myles', last_name: 'Martinez', is_coach: true, is_admin: true }),
    base({ email: 'coach.ferrick@example.com', first_name: 'Travis', last_name: 'Ferrick', is_coach: true }),
    base({ email: 'connor.jarvis@example.com', first_name: 'Connor', last_name: 'Jarvis', is_pitcher: true, goal_weight: '204-207' }),
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

async function withLibrary(): Promise<Db> {
  const d = load();
  if (!d.exercises) {
    const lib = (await import('./demoLibrary.json')).default as {
      categories: Category[];
      exercises: Omit<Exercise, 'id' | 'old_names' | 'active'>[];
      drills: Omit<Drill, 'id' | 'old_names' | 'active'>[];
    };
    d.categories = lib.categories;
    d.exercises = lib.exercises.map(e => ({ ...e, id: uid(), old_names: [], active: true }));
    d.drills = lib.drills.map(x => ({ ...x, id: uid(), old_names: [], active: true }));
    save(d);
  }
  return d;
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
      const mk = (day: GoodsItem['day'], section: GoodsItem['section'], name: string, dose: string, i: number, balls: string | null = null): GoodsItem =>
        ({ id: `${personId}-${section}-${day}-${i}`, person_id: personId, day, section, sort_order: i, name, dose, balls, note: null, video_url: 'https://youtube.com' });
      return [
        mk('A', 'soft_tissue', 'Thoracic Spine Soft Tissue', '1-3 min', 0), mk('A', 'soft_tissue', 'Posterior Cuff Soft Tissue 1', '1-3 min', 1),
        mk('A', 'correctives', 'Shoulder CARs/Circles on Wall', '1 x 10 ea', 0), mk('A', 'correctives', 'Spinal Hygiene (WSU)', 'Until Comfort', 1),
        mk('B', 'soft_tissue', 'Hip Soft Tissue', '1-3 min', 0), mk('B', 'correctives', 'Elevated Pigeon Stretch', '2 x 45 sec', 0),
        mk('any', 'feels', 'Med Ball Duo (OH + Scoop Primer)', '2 x 5 ea', 0),
        mk('any', 'half_plyos', 'Deadman Throws', '1-2 x 5-8', 0, 'Yellow, Red'), mk('any', 'full_plyos', 'Drop Step on Mound', '1-2 x 5-8', 0, 'Red, White, Grey'),
      ];
    },
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
  };
}
