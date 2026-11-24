import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { fullName, GOODS_LABELS, type GoodsSection, type Person } from '../lib/types';
import { ErrorMsg } from '../ui/common';
import { MultiSelect } from '../ui/MultiSelect';

const SECTIONS = Object.keys(GOODS_LABELS) as GoodsSection[];

/**
 * End-of-block reset: take every current Goods item off the pitching staff (or chosen players),
 * so new items can be prescribed from the Library. Asks to confirm first; history is kept and
 * the clear can be undone right after.
 */
export function ClearGoods({ onDone }: { onDone: () => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [who, setWho] = useState<string[]>([]);
  const [sections, setSections] = useState<GoodsSection[]>(SECTIONS);
  const [stage, setStage] = useState<'pick' | 'confirm' | 'done'>('pick');
  const [cleared, setCleared] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listPeople().then(ps => {
      setPeople(ps);
      setWho(ps.filter(p => p.active && !p.is_coach && p.is_pitcher && !p.is_individual_pro).map(p => p.id));
    }).catch(e => setError(e.message));
  }, []);
  const pitchers = useMemo(() => people.filter(p => p.active && !p.is_coach && p.is_pitcher && !p.is_individual_pro)
    .sort((a, b) => a.last_name.localeCompare(b.last_name)), [people]);
  const allStaff = who.length === pitchers.length && pitchers.length > 0;
  const allSections = sections.length === SECTIONS.length;
  const whoText = allStaff ? `the whole pitching staff (${who.length})` : `${who.length} pitcher${who.length === 1 ? '' : 's'}`;
  const whatText = allSections ? 'every Goods item' : sections.map(s => GOODS_LABELS[s]).join(', ');

  const go = async () => {
    setBusy(true); setError(null);
    try { setCleared(await api.clearGoods(who, allSections ? null : sections)); setStage('done'); }
    catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const undo = async () => {
    setBusy(true); setError(null);
    try { await api.restoreGoods(cleared); setCleared([]); setStage('pick'); }
    catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  if (stage === 'done') return (
    <div className="card" style={{ gap: 10 }}>
      <h2>Goods cleared</h2>
      <div>Removed {cleared.length} item{cleared.length === 1 ? '' : 's'} from {whoText}.</div>
      <div className="small muted">Now open any exercise or drill in the Library and use Prescribe to give them the new block.</div>
      <ErrorMsg error={error} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" onClick={onDone}>Done</button>
        <button className="btn ghost" disabled={busy || !cleared.length} onClick={undo}>{busy ? 'Undoing…' : 'Undo'}</button>
      </div>
    </div>
  );

  return (
    <div className="card" style={{ gap: 12 }}>
      <div className="small muted">Use this at the end of a 4-week block, then prescribe the new Goods from the Library. Nothing is deleted for good: old items stay in history.</div>
      <div className="chips">
        <button className={`toggle ${allStaff ? 'on' : ''}`} onClick={() => setWho(pitchers.map(p => p.id))}>All pitchers</button>
        <button className="toggle" onClick={() => setWho([])}>None</button>
      </div>
      <MultiSelect label="Players" value={who} onChange={setWho} searchable
        options={pitchers.map(p => ({ value: p.id, label: fullName(p), group: 'Pitchers' }))} />
      <div className="field">Sections to clear
        <div className="chips">
          {SECTIONS.map(s => (
            <button key={s} className={`toggle ${sections.includes(s) ? 'on' : ''}`}
              onClick={() => setSections(x => x.includes(s) ? x.filter(y => y !== s) : [...x, s])}>{GOODS_LABELS[s]}</button>
          ))}
        </div>
      </div>
      <ErrorMsg error={error} />
      {stage === 'pick' ? (
        <button className="btn danger" disabled={!who.length || !sections.length} onClick={() => setStage('confirm')}>
          Clear {allSections ? 'all' : 'selected'} Goods…
        </button>
      ) : (
        <div className="confirm-box">
          <strong>Are you sure?</strong>
          <div>This removes {whatText} from {whoText}. Their Goods will be empty{allSections ? '' : ' in those sections'} until you prescribe new items.</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn danger" disabled={busy} onClick={go}>{busy ? 'Clearing…' : 'Yes, clear them'}</button>
            <button className="btn ghost" disabled={busy} onClick={() => setStage('pick')}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
