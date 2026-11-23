import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api';
import type { Person } from './lib/types';
import { Login, NotInvited } from './ui/Login';
import { AthleteHome } from './athlete/AthleteHome';
import { CoachHome } from './coach/CoachHome';
import { isoDay } from './lib/dates';

/** After this long without a tap, the next visit starts fresh: greeting, today's date, new data. */
const IDLE_MS = 10 * 60 * 1000;

/** Saves any half-typed field (set inputs save when they lose focus). */
const blurActive = () => { const el = document.activeElement as HTMLElement | null; el?.blur?.(); };

function useIdleReset(onReset: () => void) {
  useEffect(() => {
    let last = Date.now();
    let day = isoDay();
    const stale = () => Date.now() - last >= IDLE_MS || isoDay() !== day;
    const touch = () => {
      if (stale()) { blurActive(); day = isoDay(); onReset(); }
      last = Date.now();
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') blurActive();
      else touch();
    };
    const onFocus = () => touch();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pointerdown', touch, { capture: true });
    window.addEventListener('keydown', touch, { capture: true });
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pointerdown', touch, { capture: true });
      window.removeEventListener('keydown', touch, { capture: true });
    };
  }, [onReset]);
}

type State =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'notInvited'; email: string }
  | { kind: 'in'; me: Person }
  | { kind: 'error'; message: string };

const NAME_KEY = 'raidergang-first-name';
const savedName = () => { try { return localStorage.getItem(NAME_KEY); } catch { return null; } };

function Greeting({ name }: { name: string | null }) {
  return (
    <div className="center greet">
      <img src="/raidergang-logo.png" alt="Raidergang · Wright State Baseball" style={{ width: 240, maxWidth: '75%' }} />
      {name && (
        <div style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 24, fontWeight: 700, lineHeight: 1.3 }}>
          What's up <span style={{ color: 'var(--gold)' }}>{name}</span>,<br />attack the day.
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [greeting, setGreeting] = useState(true);   // greeting shows once each time the app opens
  const [visit, setVisit] = useState(0);            // bumping this rebuilds the home screen from scratch

  const refresh = useCallback(async () => {
    try {
      const email = await api.sessionEmail();
      if (!email) return setState({ kind: 'signedOut' });
      const me = await api.me();
      if (me) { try { localStorage.setItem(NAME_KEY, me.first_name); } catch { /* ignore */ } }
      setState(me ? { kind: 'in', me } : { kind: 'notInvited', email });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    refresh();
    return api.onAuthChange(refresh);
  }, [refresh]);

  const freshStart = useCallback(() => {
    setGreeting(true);
    setVisit(v => v + 1);
    window.scrollTo(0, 0);
    refresh();
  }, [refresh]);
  useIdleReset(freshStart);

  // keep the greeting up for a moment once we know who it is
  useEffect(() => {
    if (state.kind !== 'in' || !greeting) return;
    const t = setTimeout(() => setGreeting(false), 1800);
    return () => clearTimeout(t);
  }, [state.kind, greeting]);

  switch (state.kind) {
    case 'loading':
      return <Greeting name={savedName()} />;
    case 'signedOut':
      return <Login />;
    case 'notInvited':
      return <NotInvited email={state.email} />;
    case 'error':
      return (
        <div className="center">
          <div className="msg err">Something went wrong: {state.message}</div>
          <button className="btn" onClick={refresh}>Try again</button>
        </div>
      );
    case 'in':
      if (greeting) return <Greeting name={state.me.first_name} />;
      return state.me.is_coach ? <CoachHome key={visit} me={state.me} /> : <AthleteHome key={visit} me={state.me} />;
  }
}
