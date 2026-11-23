import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api';
import type { Person } from './lib/types';
import { Login, NotInvited } from './ui/Login';
import { AthleteHome } from './athlete/AthleteHome';
import { CoachHome } from './coach/CoachHome';

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
      return state.me.is_coach ? <CoachHome me={state.me} /> : <AthleteHome me={state.me} />;
  }
}
