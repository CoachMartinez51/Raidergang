import { useEffect, useState } from 'react';
import { pushState, turnOnReminders, type PushState } from '../lib/push';

const SNOOZE = 'rg-reminder-snooze';

/** Small card asking the athlete to turn on the 11 AM check-in reminder. Disappears once it's on. */
export function ReminderCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hidden, setHidden] = useState(() => {
    try { return Number(localStorage.getItem(SNOOZE) ?? 0) > Date.now(); } catch { return false; }
  });
  useEffect(() => { pushState().then(setState).catch(() => setState('unsupported')); }, []);

  if (hidden || !state || state === 'unsupported' || (state === 'on' && !msg)) return null;
  const snooze = () => { try { localStorage.setItem(SNOOZE, String(Date.now() + 14 * 864e5)); } catch { /* ignore */ } setHidden(true); };
  const on = async () => {
    setBusy(true); setErr(null);
    try { await turnOnReminders(); setState('on'); setMsg('Done. A test notification is on its way.'); }
    catch (e) { setErr((e as Error).message); setState(await pushState().catch(() => state)); }
    setBusy(false);
  };

  return (
    <div className="card reminder-card">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700 }}>🔔 11 AM check-in reminder</div>
          {msg ? <div className="small" style={{ color: 'var(--green-text)' }}>{msg}</div>
            : state === 'needs-install' ? <div className="small muted">Add Raidergang to your Home Screen first: tap <b>Share</b> → <b>Add to Home Screen</b>, then open it from that icon and come back here.</div>
            : state === 'blocked' ? <div className="small muted">Notifications are blocked. Turn them on in Settings → Notifications → Raidergang.</div>
            : <div className="small muted">If you haven't logged your weight and RPE by 11, we'll nudge you. That's the only notification we send.</div>}
          {err && <div className="small" style={{ color: '#FF9C9C' }}>{err}</div>}
        </div>
      </div>
      {!msg && (
        <div style={{ display: 'flex', gap: 8 }}>
          {state === 'off' && <button className="btn small" disabled={busy} onClick={on}>{busy ? 'Turning on…' : 'Turn on'}</button>}
          <button className="btn ghost small" onClick={snooze}>Not now</button>
        </div>
      )}
    </div>
  );
}
