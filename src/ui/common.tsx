import { useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { rpeColor, rpeText } from '../lib/rpe';
import { initials, type Person } from '../lib/types';

export function TopBar({ me, sub }: { me: Person; sub: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="topbar" style={{ position: 'relative' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <img className="logo" src="/raidergang-logo.png" alt="Raidergang · Wright State Baseball" />
        <span className="sub">{sub}</span>
      </div>
      <button className="avatar" onClick={() => setOpen(o => !o)} aria-label="Account">{initials(me)}</button>
      {open && (
        <div className="card" style={{ position: 'absolute', right: 16, top: '100%', zIndex: 20, minWidth: 220, padding: 12, gap: 8 }}>
          <div className="small">{me.first_name} {me.last_name}</div>
          <div className="small muted" style={{ wordBreak: 'break-all' }}>{me.email}</div>
          <button className="btn ghost small" onClick={() => api.signOut()}>Sign out</button>
        </div>
      )}
    </div>
  );
}

export function RpePicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="rpe-grid">
      {Array.from({ length: 10 }, (_, i) => i + 1).map(n => {
        const on = n === value;
        return (
          <button key={n} type="button" className="rpe" onClick={() => onChange(n)}
            style={on ? { background: rpeColor(n), borderColor: rpeColor(n), color: rpeText(n) } : undefined}
            aria-pressed={on}>{n}</button>
        );
      })}
    </div>
  );
}

export function RpeBadge({ n }: { n: number | null | undefined }) {
  if (!n) return <span className="rpe-badge" style={{ background: 'var(--line)', color: 'var(--faint)' }}>–</span>;
  return <span className="rpe-badge" style={{ background: rpeColor(n), color: rpeText(n) }}>{n}</span>;
}

export function ErrorMsg({ error }: { error: string | null }) {
  return error ? <div className="msg err">{error}</div> : null;
}
