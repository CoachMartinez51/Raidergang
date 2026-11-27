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
const LAST_KEY = 'raidergang-last-name';
const savedName = () => { try { return localStorage.getItem(NAME_KEY); } catch { return null; } };
const savedLast = () => { try { return localStorage.getItem(LAST_KEY); } catch { return null; } };

/** Loading-screen lines; one is picked at random each time the app opens. {name} = first name, {last} = last name. */
const GREETINGS = [
  "What's up {name}, attack the day.",
  '{name}! Whatz Up Whatz Up!',
  'Hum Now {name}!',
  "Let's get after it {name}!",
  'Ohhh yeahhhh {name}',
  'IYAAR…',
  'One pitch at a time.',
  'Philippians 2:3',
  'Ba Boom Mr. {last}!',
];

/** Loading-screen photos (public/loading), cropped for a phone. One is picked at random each time the app opens.
 *  [file, object-position] — the position keeps the action in frame on wider screens. */
const PHOTOS: [string, string][] = [
  ['dogpile-1.jpg', '50% 40%'],
  ['dogpile-2.jpg', '30% 40%'],
];
let photoPick = -1;
/** Picks a new photo (never the same one twice in a row). */
function newPhoto() {
  let i = Math.floor(Math.random() * PHOTOS.length);
  if (i === photoPick) i = (i + 1) % PHOTOS.length;
  photoPick = i;
}
newPhoto();
// start downloading this open's photo right away
try { const img = new Image(); img.src = `/loading/${PHOTOS[photoPick][0]}`; } catch { /* ignore */ }

let linePick: string | null = null;
function Greeting({ name, last }: { name: string | null; last: string | null }) {
  const [line] = useState(() => {
    const options = GREETINGS.filter(g => (name || !g.includes('{name}')) && (last || !g.includes('{last}')));
    // keep the same line when the screen re-renders after sign-in finishes
    if (!linePick || !options.includes(linePick)) linePick = options[Math.floor(Math.random() * options.length)];
    return linePick;
  });
  const [file, pos] = PHOTOS[photoPick];
  const parts = line.split(/(\{name\}|\{last\})/);
  return (
    <div className="splash">
      <img className="splash-photo" src={`/loading/${file}`} alt="" style={{ objectPosition: pos }} />
      <div className="splash-shade" />
      <div className="splash-mid">
        <img className="splash-logo" src="/raidergang-logo.png" alt="Raidergang · Wright State Baseball" />
        <div className="splash-line">
        {parts.map((p, i) => p === '{name}' || p === '{last}'
          ? <span key={i} style={{ color: 'var(--gold)' }}>{p === '{name}' ? name : last}</span>
          : <span key={i}>{p}</span>)}
        </div>
      </div>
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
      if (me) { try { localStorage.setItem(NAME_KEY, me.first_name); localStorage.setItem(LAST_KEY, me.last_name); } catch { /* ignore */ } }
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
    newPhoto();
    linePick = null;
    setGreeting(true);
    setVisit(v => v + 1);
    window.scrollTo(0, 0);
    refresh();
  }, [refresh]);
  useIdleReset(freshStart);

  // keep the greeting up for a moment once we know who it is
  useEffect(() => {
    if (state.kind !== 'in' || !greeting) return;
    const t = setTimeout(() => setGreeting(false), 2600);
    return () => clearTimeout(t);
  }, [state.kind, greeting]);

  switch (state.kind) {
    case 'loading':
      return <Greeting name={savedName()} last={savedLast()} />;
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
      if (greeting) return <Greeting name={state.me.first_name} last={state.me.last_name} />;
      return state.me.is_coach ? <CoachHome key={visit} me={state.me} /> : <AthleteHome key={visit} me={state.me} />;
  }
}
