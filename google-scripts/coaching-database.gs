/**
 * The Raidergang — Coaching Database script
 *
 * Lives inside the Coaching Database sheet (Extensions → Apps Script).
 *  • Every 15 minutes it sends the Exercise Library and Throwing Drill
 *    Library tabs to the app. The sheet wins: the app copies what's here.
 *  • Every night at about 3 AM it backs up all app data to your Google
 *    Drive, in a folder called "Raidergang Backups":
 *      - a full .json file each night (the last 60 nights are kept)
 *      - a "Raidergang Backup (readable)" sheet, refreshed each night
 *
 * Fill in the two lines marked PASTE, save, then run setUp once.
 */

const SUPABASE_URL = 'https://fjrcbjwpmapetbcqfbwm.supabase.co';
const PUBLISHABLE_KEY = 'PASTE the publishable key (starts with sb_publishable_)';
const TOKEN = 'PASTE the "Coaching Database script" token from the SQL result';

const BACKUP_FOLDER = 'Raidergang Backups';
const KEEP_NIGHTS = 60;

// Column headings in row 1 of each tab → what the app calls them
const EXERCISE_COLUMNS = {
  'exercise': 'name', 'category': 'category', 'subcategory': 'subcategory',
  'body area': 'body_area', 'video': 'video', 'also fits': 'also_fits',
};
const DRILL_COLUMNS = {
  'drill': 'name', 'drill type': 'drill_type', 'reps': 'reps',
  'ball type': 'ball_type', 'video': 'video', 'also fits': 'also_fits',
};

// ---------------------------------------------------------------------
// Menu + one-time setup
// ---------------------------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Raidergang')
    .addItem('Send library to the app now', 'syncLibrary')
    .addItem('Back up app data now', 'backupNow')
    .addSeparator()
    .addItem('Turn on automatic sync + nightly backup', 'setUp')
    .addToUi();
}

/** Run once. Safe to run again: it replaces its own timers. */
function setUp() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (['syncLibrary', 'backupNow'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncLibrary').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('backupNow').timeBased().everyDays(1).atHour(3).create();
  const r = syncLibrary();
  backupNow();
  say_('All set. Library synced (' + r.exercises_added + ' new, ' + r.exercises_updated + ' updated) and the first backup is in your Drive folder "' + BACKUP_FOLDER + '".');
}

// ---------------------------------------------------------------------
// Library sync (the sheet wins)
// ---------------------------------------------------------------------
function syncLibrary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const exercises = readTab_(ss, 'Exercise Library', EXERCISE_COLUMNS);
  const drills = readTab_(ss, 'Throwing Drill Library', DRILL_COLUMNS);
  const r = rpc_('sheet_sync_library', { p_token: TOKEN, p_exercises: exercises, p_drills: drills });
  const changed = r.exercises_added + r.exercises_updated + r.drills_added + r.drills_updated;
  if (changed) console.log('Library sync: ' + JSON.stringify(r));
  toast_(changed ? ('Sent to app: ' + r.exercises_added + ' new, ' + r.exercises_updated + ' updated exercises; ' +
                    (r.drills_added + r.drills_updated) + ' drill changes.') : 'App library already matches the sheet.');
  return r;
}

/** Reads a tab by its row-1 headings, so moving columns around is fine. */
function readTab_(ss, name, columns) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Could not find a tab named "' + name + '".');
  const range = sh.getDataRange();
  const values = range.getDisplayValues();
  const rich = range.getRichTextValues();
  const head = values[0].map(h => String(h).trim().toLowerCase());
  const idx = {};
  Object.keys(columns).forEach(h => { const i = head.indexOf(h); if (i >= 0) idx[columns[h]] = i; });
  if (idx.name === undefined) throw new Error('Row 1 of "' + name + '" needs a "' + Object.keys(columns)[0] + '" heading.');
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = {};
    Object.keys(idx).forEach(k => { row[k] = String(values[r][idx[k]] || '').trim(); });
    if (!row.name) continue;
    // a "Video" cell may be a link hidden behind text
    if (idx.video !== undefined) {
      const link = rich[r][idx.video] && rich[r][idx.video].getLinkUrl();
      if (link && !/^https?:/i.test(row.video)) row.video = link;
    }
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------
// Nightly backup
// ---------------------------------------------------------------------
function backupNow() {
  const tables = rpc_('backup_tables', { p_token: TOKEN });
  const dump = { exported_at: new Date().toISOString(), source: SUPABASE_URL, tables: {} };
  tables.forEach(t => {
    const rows = [];
    for (let off = 0; off < t.row_count; off += 2000) {
      const page = rpc_('backup_page', { p_token: TOKEN, p_table: t.table_name, p_offset: off, p_limit: 2000 });
      Array.prototype.push.apply(rows, page);
    }
    dump.tables[t.table_name] = rows;
  });

  const folder = folder_();
  const stamp = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  const fileName = 'raidergang-backup-' + stamp + '.json';
  const same = folder.getFilesByName(fileName);      // re-running today replaces today's file
  while (same.hasNext()) same.next().setTrashed(true);
  folder.createFile(fileName, JSON.stringify(dump), 'application/json');
  prune_(folder);
  writeReadable_(folder, dump);
  toast_('Backup saved to Drive → ' + BACKUP_FOLDER);
}

function folder_() {
  const it = DriveApp.getFoldersByName(BACKUP_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER);
}

function prune_(folder) {
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) { const f = it.next(); if (/^raidergang-backup-.*\.json$/.test(f.getName())) files.push(f); }
  files.sort((a, b) => b.getName().localeCompare(a.getName()));
  files.slice(KEEP_NIGHTS).forEach(f => f.setTrashed(true));
}

/** One tab per table, with athlete names next to their ids, so it reads like a normal sheet. */
function writeReadable_(folder, dump) {
  const props = PropertiesService.getScriptProperties();
  let ss = null;
  const id = props.getProperty('readableBackupId');
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('Raidergang Backup (readable)');
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    props.setProperty('readableBackupId', ss.getId());
  }
  const names = {};
  (dump.tables.people || []).forEach(p => { names[p.id] = p.first_name + ' ' + p.last_name; });

  const order = ['checkins', 'set_logs', 'goals', 'goods_items', 'people', 'videos', 'block_assignments', 'rehab_switches'];
  const all = Object.keys(dump.tables).sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  all.forEach(t => {
    const rows = dump.tables[t];
    let sh = ss.getSheetByName(t) || ss.insertSheet(t);
    sh.clearContents();
    if (!rows.length) { sh.getRange(1, 1).setValue('(empty)'); return; }
    let cols = Object.keys(rows[0]);
    if (cols.indexOf('person_id') >= 0) cols = ['athlete'].concat(cols);
    const out = [cols].concat(rows.map(r => cols.map(c => {
      if (c === 'athlete') return names[r.person_id] || '';
      const v = r[c];
      if (v === null || v === undefined) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : v;
      return typeof s === 'string' && s.length > 45000 ? s.slice(0, 45000) + '…' : s;
    })));
    if (sh.getMaxRows() < out.length) sh.insertRowsAfter(sh.getMaxRows(), out.length - sh.getMaxRows());
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
    sh.getRange(1, 1, out.length, cols.length).setValues(out);
    sh.setFrozenRows(1);
  });
  const extra = ss.getSheetByName('Sheet1');
  if (extra && ss.getSheets().length > 1) ss.deleteSheet(extra);
  ss.rename('Raidergang Backup (readable) · ' + Utilities.formatDate(new Date(), 'America/New_York', 'MMM d, yyyy h:mm a'));
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
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

function toast_(msg) { try { SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Raidergang', 6); } catch (e) { console.log(msg); } }
function say_(msg) { try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); } }
