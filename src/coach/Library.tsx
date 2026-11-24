import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { DRILL_FOCUS, DRILL_TYPES, fitsOf, type LibrarySync, type Category, type Drill, type DrillDraft, type Exercise, type ExerciseDraft, type Person } from '../lib/types';
import { ErrorMsg } from '../ui/common';
import { ClearGoods } from './ClearGoods';
import { MultiSelect } from '../ui/MultiSelect';
import { Prescribe } from './Prescribe';

type Kind = 'exercises' | 'drills';

const match = (term: string, ...fields: (string | null | undefined | string[])[]) =>
  !term || fields.some(f => (Array.isArray(f) ? f.join(' ') : f ?? '').toLowerCase().includes(term));

export function Library({ me }: { me: Person }) {
  const [kind, setKind] = useState<Kind>('exercises');
  const [clearing, setClearing] = useState(false);
  const [cats, setCats] = useState<Category[]>([]);
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [drills, setDrills] = useState<Drill[] | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('all');
  const [focus, setFocus] = useState<string>('all');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Exercise | Drill | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => Promise.all([api.listCategories(), api.listExercises(), api.listDrills()])
    .then(([c, e, d]) => { setCats(c); setExercises(e); setDrills(d); })
    .catch(e => setError(e.message));
  useEffect(() => { load(); }, []);

  const categoryNames = useMemo(() => [...new Set(cats.map(c => c.category))], [cats]);
  const subOrder = useMemo(() => new Map(cats.map(c => [`${c.category}|${c.subcategory}`, c.sort_order])), [cats]);
  const term = q.trim().toLowerCase();

  const groupedExercises = useMemo(() => {
    const rows = (exercises ?? [])
      .filter(e => showInactive || e.active)
      .filter(e => match(term, e.name, e.category, e.subcategory, e.also_fits, e.old_names, e.extra_fits));
    // each exercise shows under its own spot and every spot it also fits
    const groups = new Map<string, Exercise[]>();
    for (const e of rows) {
      const homes = [`${e.category}|${e.subcategory ?? ''}`, ...fitsOf(e).map(f => f.replace(' > ', '|'))];
      for (const k of new Set(homes)) {
        if (cat !== 'all' && k.split('|')[0] !== cat) continue;
        groups.set(k, [...(groups.get(k) ?? []), e]);
      }
    }
    return [...groups.entries()].sort((a, b) => (subOrder.get(a[0]) ?? 999) - (subOrder.get(b[0]) ?? 999));
  }, [exercises, cat, term, showInactive, subOrder]);

  const groupedDrills = useMemo(() => {
    const rows = (drills ?? []).filter(d => showInactive || d.active).filter(d => cat === 'all' || d.drill_type === cat)
      .filter(d => focus === 'all' || (d.focus ?? []).includes(focus))
      .filter(d => match(term, d.name, d.drill_type, d.ball_type, d.also_fits, d.old_names, d.focus));
    return DRILL_TYPES.map(t => [t, rows.filter(d => d.drill_type === t)] as const).filter(([, r]) => r.length);
  }, [drills, cat, focus, term, showInactive]);

  const total = kind === 'exercises' ? groupedExercises.reduce((n, [, r]) => n + r.length, 0) : groupedDrills.reduce((n, [, r]) => n + r.length, 0);
  const chips = kind === 'exercises' ? categoryNames : [...DRILL_TYPES];

  return (
    <>
      <div className="chips">
        <button className={`toggle ${kind === 'exercises' ? 'on' : ''}`} onClick={() => { setKind('exercises'); setCat('all'); }}>Exercises ({exercises?.length ?? '…'})</button>
        <button className={`toggle ${kind === 'drills' ? 'on' : ''}`} onClick={() => { setKind('drills'); setCat('all'); }}>Throwing drills ({drills?.length ?? '…'})</button>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <input className="input" style={{ maxWidth: 360 }} placeholder={kind === 'exercises' ? 'Search exercises, old names…' : 'Search drills, ball type…'} value={q} onChange={e => setQ(e.target.value)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`toggle ${showInactive ? 'on' : ''}`} onClick={() => setShowInactive(s => !s)}>Show retired</button>
          {me.coach_can_edit && <button className="btn ghost small" onClick={() => setClearing(true)}>Clear Goods…</button>}
          {me.coach_can_edit && <button className="btn small" onClick={() => setEditing('new')}>+ Add {kind === 'exercises' ? 'exercise' : 'drill'}</button>}
        </div>
      </div>
      <div className="chips">
        <button className={`toggle ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>All</button>
        {chips.map(c => <button key={c} className={`toggle ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      {kind === 'drills' && (
        <div className="chips">
          <span className="small muted" style={{ alignSelf: 'center' }}>Targets:</span>
          <button className={`toggle ${focus === 'all' ? 'on' : ''}`} onClick={() => setFocus('all')}>Any</button>
          {DRILL_FOCUS.map(f => <button key={f} className={`toggle ${focus === f ? 'on' : ''}`} onClick={() => setFocus(f)}>{f}</button>)}
        </div>
      )}
      <SyncStatus />
      <ErrorMsg error={error} />
      <span className="small muted">{total} shown</span>

      {kind === 'exercises'
        ? groupedExercises.map(([k, rows]) => {
            const [c, s] = k.split('|');
            return <Group key={k} title={s || c} sub={s ? c : ''} rows={rows} onOpen={setEditing} home={k} />;
          })
        : groupedDrills.map(([t, rows]) => <Group key={t} title={t} sub="" rows={rows as Drill[]} onOpen={setEditing} />)}

      {clearing && <Drawer title="Clear the staff's Goods" onClose={() => setClearing(false)}><ClearGoods onDone={() => setClearing(false)} /></Drawer>}
      {editing && (kind === 'exercises'
        ? <ExerciseEditor me={me} cats={cats} item={editing === 'new' ? null : editing as Exercise}
            onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
        : <DrillEditor me={me} item={editing === 'new' ? null : editing as Drill}
            onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />)}
    </>
  );
}

function Group<T extends Exercise | Drill>({ title, sub, rows, onOpen, home }: { title: string; sub: string; rows: T[]; onOpen: (x: T) => void; home?: string }) {
  return (
    <>
      <div className="section-title">{title} <span style={{ textTransform: 'none', letterSpacing: 0 }}>{sub && `· ${sub}`} ({rows.length})</span></div>
      <div className="card" style={{ padding: 6, gap: 0 }}>
        {rows.map(x => (
          <div key={x.id} className="row lib-row" onClick={() => onOpen(x)} style={{ opacity: x.active ? 1 : 0.5 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {x.name}
                {home && 'category' in x && `${x.category}|${x.subcategory ?? ''}` !== home && <span className="pill-green" style={{ marginLeft: 8 }}>Also fits</span>}
              </div>
              {'focus' in x && (x.focus ?? []).length > 0 && (
                <div className="tag-row">{x.focus!.map(f => <span key={f} className="focus-tag">{f}</span>)}</div>
              )}
              {(x.also_fits || ('ball_type' in x && x.ball_type)) && (
                <div className="small muted">{'ball_type' in x && x.ball_type ? `${x.reps ?? ''} · ${x.ball_type}` : ''}{x.also_fits ? `${'ball_type' in x ? ' · ' : ''}Also: ${x.also_fits}` : ''}</div>
              )}
            </div>
            {x.video_url
              ? <a href={x.video_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="small" style={{ fontWeight: 600, flexShrink: 0 }}>Video ↗</a>
              : <span className="small muted">No video</span>}
          </div>
        ))}
      </div>
    </>
  );
}

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div className="drawer" style={{ width: '100%', maxWidth: 520, height: '100%', overflowY: 'auto', background: 'var(--bg)', borderLeft: '1px solid var(--line)', padding: 'calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 40px)', display: 'flex', flexDirection: 'column', gap: 14 }}
        onClick={e => e.stopPropagation()}>
        <div className="row">
          <h2 style={{ margin: 0, fontFamily: "'Space Grotesk', Inter, sans-serif" }}>{title}</h2>
          <button className="btn ghost small close-btn" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const isUrl = (s: string) => !s.trim() || /^https?:\/\/\S+$/i.test(s.trim());

function ExerciseEditor({ me, cats, item, onClose, onSaved }: { me: Person; cats: Category[]; item: Exercise | null; onClose: () => void; onSaved: () => void }) {
  const ro = !me.coach_can_edit;
  const [d, setD] = useState<ExerciseDraft>(() => item ? { ...item } : {
    name: '', category: cats[0]?.category ?? '', subcategory: cats[0]?.subcategory ?? null, body_area: null, video_url: '', also_fits: null, extra_fits: [], old_names: [], active: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categories = [...new Set(cats.map(c => c.category))];
  const subs = cats.filter(c => c.category === d.category).map(c => c.subcategory);
  const set = <K extends keyof ExerciseDraft>(k: K, v: ExerciseDraft[K]) => setD(x => ({ ...x, [k]: v }));
  const valid = d.name.trim() && d.category && isUrl(d.video_url ?? '');

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const name = d.name.trim();
      const old = item && item.name !== name && !d.old_names.includes(item.name) ? [...d.old_names, item.name] : d.old_names;
      await api.saveExercise(item?.id ?? null, { ...d, name, old_names: old, video_url: d.video_url?.trim() || null, body_area: d.body_area?.trim() || null, also_fits: d.also_fits?.trim() || null });
      onSaved();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  return (
    <Drawer title={item ? item.name : 'Add exercise'} onClose={onClose}>
      {ro && <div className="msg info">You have view-only access.</div>}
      <div className="card">
        <label className="field">Name<input className="input" disabled={ro} value={d.name} onChange={e => set('name', e.target.value)} /></label>
        <div className="grid2">
          <label className="field">Category
            <select className="input" disabled={ro} value={d.category} onChange={e => { const c = e.target.value; setD(x => ({ ...x, category: c, subcategory: cats.find(k => k.category === c)?.subcategory ?? null })); }}>
              {categories.map(c => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="field">Subcategory
            <select className="input" disabled={ro} value={d.subcategory ?? ''} onChange={e => set('subcategory', e.target.value || null)}>
              {subs.map(s => <option key={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <label className="field">Video link
          <input className="input" disabled={ro} inputMode="url" autoCapitalize="none" placeholder="https://youtube.com/…" value={d.video_url ?? ''} onChange={e => set('video_url', e.target.value)} />
        </label>
        {d.video_url && isUrl(d.video_url) && <a className="small" href={d.video_url} target="_blank" rel="noreferrer">Open video ↗</a>}
        <label className="field">Body area (optional)<input className="input" disabled={ro} value={d.body_area ?? ''} onChange={e => set('body_area', e.target.value)} /></label>
        <MultiSelect label="Also fits (tick every place it belongs)" disabled={ro} searchable
          options={cats.filter(c => `${c.category}|${c.subcategory}` !== `${d.category}|${d.subcategory}`).map(c => ({ value: `${c.category} > ${c.subcategory}`, label: c.subcategory, group: c.category }))}
          locked={fitsOf({ also_fits: d.also_fits, extra_fits: [] })} lockedNote="from the Coaching Database"
          value={(d.extra_fits ?? []).filter(v => !fitsOf({ also_fits: d.also_fits, extra_fits: [] }).includes(v))}
          onChange={v => set('extra_fits', v)} chipText={v => v.replace(/\s*>\s*/, ' › ')} />
        {d.also_fits && !d.also_fits.includes('>') && <span className="small muted">Sheet note: {d.also_fits}</span>}
        {d.old_names.length > 0 && <div className="small muted">Old names: {d.old_names.join(', ')}</div>}
      </div>
      {item && !ro && (
        <div className="card">
          <div className="row">
            <span className="small muted">{d.active ? 'In use: shows in builders and search' : 'Retired: hidden from builders, kept in history'}</span>
            <button className={`toggle ${d.active ? 'on' : ''}`} onClick={() => set('active', !d.active)}>{d.active ? 'Active' : 'Retired'}</button>
          </div>
        </div>
      )}
      <ErrorMsg error={error} />
      {!ro && <button className="btn" disabled={!valid || busy} onClick={save}>{busy ? 'Saving…' : item ? 'Save changes' : 'Add to library'}</button>}
      {!ro && item && d.name.trim() !== item.name && <span className="small muted">Renaming keeps every past workout linked. The old name is saved for search.</span>}
      {!ro && item && item.active && <Prescribe item={item} isDrill={false} />}
    </Drawer>
  );
}

function DrillEditor({ me, item, onClose, onSaved }: { me: Person; item: Drill | null; onClose: () => void; onSaved: () => void }) {
  const ro = !me.coach_can_edit;
  const [d, setD] = useState<DrillDraft>(() => item ? { ...item } : {
    name: '', drill_type: 'Stationary', reps: '1-2 x 5-8', ball_type: '', video_url: '', also_fits: null, focus: [], old_names: [], active: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof DrillDraft>(k: K, v: DrillDraft[K]) => setD(x => ({ ...x, [k]: v }));
  const valid = d.name.trim() && isUrl(d.video_url ?? '');

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const name = d.name.trim();
      const old = item && item.name !== name && !d.old_names.includes(item.name) ? [...d.old_names, item.name] : d.old_names;
      await api.saveDrill(item?.id ?? null, { ...d, name, old_names: old, video_url: d.video_url?.trim() || null, reps: d.reps?.trim() || null, ball_type: d.ball_type?.trim() || null, also_fits: d.also_fits?.trim() || null });
      onSaved();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  return (
    <Drawer title={item ? item.name : 'Add throwing drill'} onClose={onClose}>
      {ro && <div className="msg info">You have view-only access.</div>}
      <div className="card">
        <label className="field">Name<input className="input" disabled={ro} value={d.name} onChange={e => set('name', e.target.value)} /></label>
        <span className="small muted">Drill type</span>
        <div className="chips">
          {DRILL_TYPES.map(t => <button key={t} disabled={ro} className={`toggle ${d.drill_type === t ? 'on' : ''}`} onClick={() => set('drill_type', t)}>{t}</button>)}
        </div>
        <div className="grid2">
          <label className="field">Reps<input className="input" disabled={ro} value={d.reps ?? ''} onChange={e => set('reps', e.target.value)} /></label>
          <label className="field">Ball type<input className="input" disabled={ro} placeholder="Yellow, Red" value={d.ball_type ?? ''} onChange={e => set('ball_type', e.target.value)} /></label>
        </div>
        <label className="field">Video link
          <input className="input" disabled={ro} inputMode="url" autoCapitalize="none" value={d.video_url ?? ''} onChange={e => set('video_url', e.target.value)} />
        </label>
        {d.video_url && isUrl(d.video_url) && <a className="small" href={d.video_url} target="_blank" rel="noreferrer">Open video ↗</a>}
        <MultiSelect label="What it targets (coaches only)" disabled={ro} options={DRILL_FOCUS.map(f => ({ value: f }))}
          value={d.focus ?? []} onChange={v => set('focus', v)} placeholder="Pick what this drill works on" />
        <label className="field">Also fits (optional)<input className="input" disabled={ro} value={d.also_fits ?? ''} onChange={e => set('also_fits', e.target.value)} /></label>
      </div>
      {item && !ro && (
        <div className="card">
          <div className="row">
            <span className="small muted">{d.active ? 'In use' : 'Retired: hidden from builders, kept in history'}</span>
            <button className={`toggle ${d.active ? 'on' : ''}`} onClick={() => set('active', !d.active)}>{d.active ? 'Active' : 'Retired'}</button>
          </div>
        </div>
      )}
      <ErrorMsg error={error} />
      {!ro && <button className="btn" disabled={!valid || busy} onClick={save}>{busy ? 'Saving…' : item ? 'Save changes' : 'Add to library'}</button>}
      {!ro && item && item.active && <Prescribe item={item} isDrill />}
    </Drawer>
  );
}

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} hr ago` : new Date(iso).toLocaleDateString();
};

/** The Coaching Database is the master copy; this shows the last time it was sent to the app. */
function SyncStatus() {
  const [s, setS] = useState<LibrarySync | null | undefined>(undefined);
  const [more, setMore] = useState(false);
  useEffect(() => { api.lastLibrarySync().then(setS).catch(() => setS(null)); }, []);
  if (s === undefined || api.mode === 'demo') return null;
  return (
    <div className="msg" style={{ background: 'var(--card)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span>
        <b>Master copy: the Coaching Database sheet.</b>{' '}
        {s ? <>Last synced {ago(s.ran_at)}: {s.ex_added} new, {s.ex_updated} updated{s.drills_added + s.drills_updated ? `, ${s.drills_added + s.drills_updated} drill change${s.drills_added + s.drills_updated === 1 ? '' : 's'}` : ''}.</> : <>Not synced yet. Turn on the Raidergang script in the sheet.</>}
      </span>
      <span className="muted">Add or change exercises in the sheet. Edits made here get replaced on the next sync (about every 15 minutes).</span>
      {s && s.skipped.length > 0 && (
        <>
          <button className="link" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={() => setMore(m => !m)}>{s.skipped.length} row{s.skipped.length === 1 ? '' : 's'} in the sheet need a look</button>
          {more && s.skipped.map((k, i) => <span key={i} className="muted">{k.tab}: <b>{k.name}</b> ({k.why})</span>)}
        </>
      )}
      {s && s.app_only > 0 && <span className="muted">{s.app_only} exercise{s.app_only === 1 ? ' is' : 's are'} in the app but not the sheet (kept as is).</span>}
    </div>
  );
}
