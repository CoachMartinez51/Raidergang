import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { fullName, GOODS_LABELS, type Drill, type Exercise, type GoodsSection, type NewGoodsItem, type Person } from '../lib/types';
import { ErrorMsg } from '../ui/common';
import { MultiSelect } from '../ui/MultiSelect';

const SECTIONS = Object.keys(GOODS_LABELS) as GoodsSection[];
const DAY_SECTIONS: GoodsSection[] = ['soft_tissue', 'correctives'];

/** A sensible starting section from where the item lives in the Library. */
function defaultSection(item: Exercise | Drill, isDrill: boolean): GoodsSection {
  if (isDrill) return 'half_plyos';
  const e = item as Exercise;
  if (e.subcategory === 'Soft Tissue') return 'soft_tissue';
  if (/Pre-Throw/i.test(e.subcategory ?? '') || /Med Ball/i.test(e.subcategory ?? '')) return 'feels';
  return 'correctives';
}

/** Add a Library exercise or drill to one or more players' Goods. */
export function Prescribe({ item, isDrill }: { item: Exercise | Drill; isDrill: boolean }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [who, setWho] = useState<string[]>([]);
  const [section, setSection] = useState<GoodsSection>(defaultSection(item, isDrill));
  const [day, setDay] = useState<'A' | 'B' | 'both' | 'any'>('A');
  const [dose, setDose] = useState(isDrill ? (item as Drill).reps ?? '' : '');
  const [balls, setBalls] = useState(isDrill ? (item as Drill).ball_type ?? '' : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.listPeople().then(setPeople).catch(e => setError(e.message)); }, []);
  const athletes = useMemo(() => people.filter(p => p.active && !p.is_coach)
    .sort((a, b) => Number(b.is_pitcher) - Number(a.is_pitcher) || a.last_name.localeCompare(b.last_name)), [people]);
  const options = athletes.map(p => ({ value: p.id, label: fullName(p), group: p.is_pitcher ? 'Pitchers' : 'Position players' }));
  const daySection = DAY_SECTIONS.includes(section);
  const days: ('A' | 'B' | 'any')[] = !daySection ? ['any'] : day === 'both' ? ['A', 'B'] : day === 'any' ? ['any'] : [day];

  const go = async () => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const rows: NewGoodsItem[] = who.flatMap(pid => days.map(d => ({
        person_id: pid, day: d, section,
        exercise_id: isDrill ? null : item.id, drill_id: isDrill ? item.id : null,
        dose: dose.trim() || null, balls: balls.trim() || null, note: note.trim() || null, sort_order: 999,
      })));
      const n = await api.prescribeGoods(rows);
      setMsg(`Added ${item.name} to ${who.length} player${who.length === 1 ? '' : 's'}' Goods (${GOODS_LABELS[section]}${daySection ? `, ${day === 'both' ? 'Day A and B' : day === 'any' ? 'every day' : `Day ${day}`}` : ''}). ${n} item${n === 1 ? '' : 's'} saved.`);
      setWho([]);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="card" style={{ gap: 10 }}>
      <h2>Prescribe to The Goods</h2>
      <div className="chips">
        <button className="toggle" onClick={() => setWho(athletes.filter(p => p.is_pitcher && !p.is_individual_pro).map(p => p.id))}>All pitchers</button>
        <button className="toggle" onClick={() => setWho([])}>Clear</button>
      </div>
      <MultiSelect label="Players" options={options} value={who} onChange={setWho} placeholder="Pick players" searchable />
      <div className="grid2">
        <label className="field">Section
          <select className="input" value={section} onChange={e => setSection(e.target.value as GoodsSection)}>
            {SECTIONS.map(s => <option key={s} value={s}>{GOODS_LABELS[s]}</option>)}
          </select>
        </label>
        {daySection && (
          <label className="field">Which day
            <select className="input" value={day} onChange={e => setDay(e.target.value as typeof day)}>
              <option value="A">Day A (Mon/Wed/Fri)</option>
              <option value="B">Day B (Tue/Thu/Sat)</option>
              <option value="both">Both days</option>
            </select>
          </label>
        )}
      </div>
      <div className="grid2">
        <label className="field">Sets / reps<input className="input" value={dose} onChange={e => setDose(e.target.value)} placeholder="2 x 45 sec" /></label>
        {isDrill && <label className="field">Balls<input className="input" value={balls} onChange={e => setBalls(e.target.value)} placeholder="Yellow, Red" /></label>}
      </div>
      <label className="field">Note for the player (optional)<input className="input" value={note} onChange={e => setNote(e.target.value)} /></label>
      <ErrorMsg error={error} />
      {msg && <div className="msg info">{msg}</div>}
      <button className="btn" disabled={!who.length || busy} onClick={go}>
        {busy ? 'Adding…' : who.length ? `Add to ${who.length} player${who.length === 1 ? '' : 's'}` : 'Pick players first'}
      </button>
    </div>
  );
}
