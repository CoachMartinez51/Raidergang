/**
 * The Raidergang — YouTube script
 *
 * Make this at script.google.com while signed in as
 * wrightstatepitching@gmail.com (the channel owner), so it can see the
 * unlisted uploads. It only READS the channel. It never uploads,
 * edits or deletes anything on YouTube.
 *
 * Every 30 minutes it sends the newest uploads (title + video id) to the
 * app. The app reads the pitcher's name, the type and the date from the
 * title. Anything it can't read goes to the coaches' Videos → Inbox.
 *
 * Setup:
 *  1. Left side, "Services" → + → "YouTube Data API v3" → Add.
 *  2. Fill in the two lines marked PASTE and save.
 *  3. Pick "firstRun" in the menu at the top and press Run. Allow access.
 */

const SUPABASE_URL = 'https://fjrcbjwpmapetbcqfbwm.supabase.co';
const PUBLISHABLE_KEY = 'PASTE the publishable key (starts with sb_publishable_)';
const TOKEN = 'PASTE the "YouTube script" token from the SQL result';

/** Sends the whole channel once, then turns on the 30-minute check. */
function firstRun() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'sendNewVideos') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendNewVideos').timeBased().everyMinutes(30).create();
  const r = send_(true);
  console.log('Done. ' + r.new + ' videos sent. ' + r.waiting_for_a_coach + ' are waiting in the coaches\' inbox.');
}

/** Runs every 30 minutes: just the newest 100 uploads. */
function sendNewVideos() { send_(false); }

function send_(everything) {
  const ch = YouTube.Channels.list('contentDetails', { mine: true });
  if (!ch.items || !ch.items.length) throw new Error('No channel found. Are you signed in as wrightstatepitching@gmail.com?');
  const uploads = ch.items[0].contentDetails.relatedPlaylists.uploads;

  const videos = [];
  let page;
  do {
    const res = YouTube.PlaylistItems.list('snippet,contentDetails,status', { playlistId: uploads, maxResults: 50, pageToken: page });
    (res.items || []).forEach(i => videos.push({
      id: i.contentDetails.videoId,
      title: i.snippet.title,
      published_at: i.contentDetails.videoPublishedAt || i.snippet.publishedAt,
      privacy: i.status ? i.status.privacyStatus : 'unlisted',
    }));
    page = res.nextPageToken;
  } while (page && (everything || videos.length < 100));

  let total = { new: 0, retitled: 0, skipped: 0, waiting_for_a_coach: 0 };
  for (let i = 0; i < videos.length; i += 200) {
    const r = rpc_('youtube_ingest', { p_token: TOKEN, p_videos: videos.slice(i, i + 200) });
    total = { new: total.new + r.new, retitled: total.retitled + r.retitled, skipped: total.skipped + r.skipped, waiting_for_a_coach: r.waiting_for_a_coach };
  }
  if (total.new || total.retitled) console.log(JSON.stringify(total));
  return total;
}

function rpc_(fn, body) {
  if (PUBLISHABLE_KEY.indexOf('PASTE') === 0 || TOKEN.indexOf('PASTE') === 0) {
    throw new Error('Fill in PUBLISHABLE_KEY and TOKEN at the top of the script first.');
  }
  const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'post', contentType: 'application/json',
    headers: { apikey: PUBLISHABLE_KEY },
    payload: JSON.stringify(body), muteHttpExceptions: true,
  });
  const text = res.getContentText();
  if (res.getResponseCode() >= 300) {
    let msg = text;
    try { msg = JSON.parse(text).message || text; } catch (e) { /* keep raw text */ }
    throw new Error('The app said: ' + msg);
  }
  return text ? JSON.parse(text) : null;
}
