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

export default function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const email = await api.sessionEmail();
      if (!email) return setState({ kind: 'signedOut' });
      const me = await api.me();
      setState(me ? { kind: 'in', me } : { kind: 'notInvited', email });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    refresh();
    return api.onAuthChange(refresh);
  }, [refresh]);

  switch (state.kind) {
    case 'loading':
      return <div className="center"><img src="/raidergang-logo.png" alt="Raidergang" style={{ width: 220 }} /></div>;
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
      return state.me.is_coach ? <CoachHome me={state.me} /> : <AthleteHome me={state.me} />;
  }
}
