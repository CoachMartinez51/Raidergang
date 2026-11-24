import { useMemo, useState } from 'react';

export interface MultiOption { value: string; label?: string; group?: string }

/**
 * A dropdown you can tick several things in. Shows the picks as chips; tap to open the list.
 * `locked` values show as ticked but can't be changed here (e.g. set in the Coaching Database).
 */
export function MultiSelect({ label, options, value, onChange, locked = [], lockedNote, placeholder = 'None', disabled, searchable, chipText }: {
  label: string; options: MultiOption[]; value: string[]; onChange: (v: string[]) => void;
  locked?: string[]; lockedNote?: string; placeholder?: string; disabled?: boolean; searchable?: boolean;
  /** How a picked value reads as a chip (default: its label) */
  chipText?: (v: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const picked = new Set([...locked, ...value]);
  const labelOf = (v: string) => options.find(o => o.value === v)?.label ?? v;
  const term = q.trim().toLowerCase();
  const groups = useMemo(() => {
    const m = new Map<string, MultiOption[]>();
    for (const o of options) {
      if (term && !(o.label ?? o.value).toLowerCase().includes(term) && !(o.group ?? '').toLowerCase().includes(term)) continue;
      const g = o.group ?? '';
      m.set(g, [...(m.get(g) ?? []), o]);
    }
    return [...m.entries()];
  }, [options, term]);

  const toggle = (v: string) => {
    if (locked.includes(v)) return;
    onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  };

  return (
    <div className="field">
      <span>{label}</span>
      <button type="button" className="input multi-trigger" disabled={disabled} aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="multi-chips">
          {picked.size === 0 && <span className="muted">{placeholder}</span>}
          {[...picked].map(v => <span key={v} className={`multi-chip ${locked.includes(v) ? 'locked' : ''}`}>{chipText ? chipText(v) : labelOf(v)}</span>)}
        </span>
        <span className="muted" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="multi-panel">
          {searchable && <input className="input" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} style={{ height: 40, fontSize: 15 }} />}
          {groups.map(([g, opts]) => (
            <div key={g || '_'} style={{ display: 'flex', flexDirection: 'column' }}>
              {g && <span className="multi-group">{g}</span>}
              {opts.map(o => {
                const isLocked = locked.includes(o.value);
                return (
                  <label key={o.value} className="multi-option" style={{ opacity: isLocked ? 0.7 : 1 }}>
                    <input type="checkbox" checked={picked.has(o.value)} disabled={isLocked || disabled} onChange={() => toggle(o.value)} />
                    <span>{o.label ?? o.value}{isLocked && lockedNote ? <span className="muted small"> · {lockedNote}</span> : null}</span>
                  </label>
                );
              })}
            </div>
          ))}
          {!groups.length && <span className="small muted">Nothing matches.</span>}
          <button type="button" className="btn small" style={{ alignSelf: 'flex-end' }} onClick={() => setOpen(false)}>Done</button>
        </div>
      )}
    </div>
  );
}
