/**
 * The Raidergang — keep the position players' workbooks in step with this Coaching Database.
 *
 * Their lift tabs look up video links in a hidden "Database" tab. Those tabs were copies,
 * so new or renamed exercises here never reached them. This copies the Database tab into
 * each of their workbooks every hour (and right away when you run it).
 *
 * Setup (once): in Extensions → Apps Script, click + → Script, name it "PositionSync",
 * paste this whole file, Save, then choose raidergangPositionSetUp in the function menu and Run.
 * Nothing in a player's own logged weights is touched — only the hidden Database tab.
 */
const RG_POSITION_WORKBOOKS = [
  ['Kraus',        '1d7B4SIhh72OcSrPT_CcdAvYq7IqXQcqsTVY1SfbDd88', 'Database'],
  ['Warner',       '1D5qvpEg5ttQS314PCGJDLNMgUD1-Wtc3pAjcHb3omOY', 'Database'],
  ['Blomquist',    '1XpoGkU2y_ddto4HGytwPIDBvd-UExcIQApe54FymSoc', 'Database'],
  ['McClure',      '1qR209WaJprI4sJ199Jue5NP-RVtZNlK9qpcXjLkKiKI', 'Database'],
  ['Cam Gilkerson','1argo0kr0AjsbeMMb5oQYcJbvvkwXVSFFCBScF9iEFmI', 'Database'],
  ['Falkenstein',  '1hcq4VPwIvVUzc2Yq7TzcPyfQd0wC34M0Yn0ELPeRqaE', 'Database'],
  ['McCann',       '1d8aaiHHQDC9qgIIJJMO17WIz2nECX0zDzA8nLRKDJw8', 'Database'],
  ['Wood',         '1DwpEygj7H-7-TG7T1Sk75GOGW32j3iM7fcNfSta9cjw', 'Database'],
  ['Galuski',      '1cIQm4VKJu8yAzHV5cf2ot_eTAC_OjpODs4dInwlqCI0', 'Database'],
  ['Martin',       '1v1VyMhRS15YGpSJ231xo1Ngak7q5M_A9VKPqDAAaBHE', 'Database'],
  ['Nelson',       '1XRletQIL11-tiQuTuFPGzvv-uQ3MmSzkL4bIGc3Op5w', 'Database'],
  ['Cassell',      '1S92VSbW8tSDLhLXurggP61H-xsIzKYt9QozVmKGWoew', 'Database'],
  ['Mullinax',     '1RMt8n36aEkWpxhdc_aCQfDvxdb5bvT1Eis3eIipIxyA', 'Lift Database'],
];

function raidergangPositionSetUp() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'raidergangSyncPositionDb') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('raidergangSyncPositionDb').timeBased().everyHours(1).create();
  raidergangSyncPositionDb();
}

function raidergangSyncPositionDb() {
  const src = SpreadsheetApp.getActive().getSheetByName('Database');
  if (!src) throw new Error('No "Database" tab in the Coaching Database.');
  const values = src.getRange(1, 1, src.getLastRow(), src.getLastColumn()).getValues();
  if (values.length < 50) throw new Error('Database tab looks empty (' + values.length + ' rows), so nothing was copied.');
  const done = [], failed = [];
  RG_POSITION_WORKBOOKS.forEach(([who, id, tab]) => {
    try {
      const sh = SpreadsheetApp.openById(id).getSheetByName(tab);
      if (!sh) throw new Error('no "' + tab + '" tab');
      if (sh.getMaxRows() < values.length) sh.insertRowsAfter(sh.getMaxRows(), values.length - sh.getMaxRows());
      if (sh.getMaxColumns() < values[0].length) sh.insertColumnsAfter(sh.getMaxColumns(), values[0].length - sh.getMaxColumns());
      sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearContent();
      sh.getRange(1, 1, values.length, values[0].length).setValues(values);
      done.push(who);
    } catch (e) { failed.push(who + ' (' + e.message + ')'); }
  });
  const msg = 'Position players updated: ' + done.length + ' of ' + RG_POSITION_WORKBOOKS.length + (failed.length ? '. Problems: ' + failed.join('; ') : '.');
  console.log(msg);
  try { SpreadsheetApp.getActive().toast(msg, 'Raidergang', 8); } catch (e) { /* run from editor */ }
}
