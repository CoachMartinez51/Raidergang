import { api } from './api';

/** Where this phone stands with the 11 AM reminder. */
export type PushState =
  | 'unsupported'      // old browser / Android browser without push
  | 'needs-install'    // iPhone/iPad Safari: must open from the Home Screen first
  | 'blocked'          // they said no in the system prompt
  | 'off' | 'on';

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* reminders just won't be offered */ });
  }
}

export async function pushState(): Promise<PushState> {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  if (isIos() && !isStandalone()) return 'needs-install';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

function keyBytes(b64: string) {
  const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

/** Ask permission, subscribe this phone, save it, and send a test. Must run from a tap. */
export async function turnOnReminders(): Promise<void> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are off for Raidergang. Turn them on in Settings → Notifications → Raidergang.');
  const key = await api.pushPublicKey();
  if (!key) throw new Error('Reminders aren\'t set up on the server yet. Tell Coach Martinez.');
  const reg = (await navigator.serviceWorker.getRegistration()) ?? await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  const j = sub.toJSON();
  await api.savePushSubscription(j.endpoint!, j.keys!.p256dh, j.keys!.auth, navigator.userAgent);
  await api.sendTestPush();
}
