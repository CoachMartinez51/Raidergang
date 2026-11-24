// The Raidergang — 11 AM check-in reminder.
// Deploy in Supabase → Edge Functions as "checkin-reminder" with JWT verification OFF
// (the database sends its own private run token instead).
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = 'https://fjrcbjwpmapetbcqfbwm.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_x_ODXcezx_FQKjTrj9Lg4g_j2RMbHrs'; // public key, safe to ship
const CONTACT = 'mailto:wrightstatepitching@gmail.com';

async function rpc(name: string, args: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${name}: ${text}`);
  return text ? JSON.parse(text) : null;
}

type Target = { endpoint: string; p256dh: string; auth: string; title: string; body: string };

Deno.serve(async (req) => {
  try {
    const { token, mode, person_id } = await req.json();
    if (!token || !['init', 'test', 'daily'].includes(mode)) return new Response('bad request', { status: 400 });

    let info = await rpc('push_targets', { p_token: token, p_mode: mode, p_person: person_id ?? null });
    if (!info.vapid_public) {
      const keys = webpush.generateVAPIDKeys();
      await rpc('push_save_keys', { p_token: token, p_public: keys.publicKey, p_private: keys.privateKey });
      info = { ...info, ...(await rpc('push_targets', { p_token: token, p_mode: 'init' })), targets: info.targets };
    }
    webpush.setVapidDetails(CONTACT, info.vapid_public, info.vapid_private);

    const gone: string[] = [];
    let sent = 0, failed = 0;
    await Promise.all((info.targets as Target[]).map(async t => {
      try {
        await webpush.sendNotification(
          { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
          JSON.stringify({ title: t.title, body: t.body, url: '/' }),
          { TTL: 60 * 60 * 6, urgency: 'normal' },
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(t.endpoint); else failed++;
      }
    }));
    if (gone.length) await rpc('push_forget', { p_token: token, p_endpoints: gone });
    return Response.json({ mode, sent, failed, removed: gone.length });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
