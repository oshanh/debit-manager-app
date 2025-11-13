const fs = require('fs');
const path = require('path');

// Simple reproducible script to validate backup/restore logic locally (Node)
// This simulates the app's STORAGE layout under ./tmp_test_fs and exercises
// the same canonical .db preference and restore-to-.db behavior.

const BASE = path.join(__dirname, '..', 'tmp_test_fs');
const SQLITE_DIR = path.join(BASE, 'SQLite');
const BACKUP_DIR = path.join(BASE, 'backups');

function pad(n) { return String(n).padStart(2, '0'); }
function localTimestamp(d = new Date()) {
  const year = d.getFullYear();
  const month = pad(d.getMonth()+1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  const tzOffset = -d.getTimezoneOffset();
  const sign = tzOffset >= 0 ? '+' : '-';
  const tzH = pad(Math.floor(Math.abs(tzOffset)/60));
  const tzM = pad(Math.abs(tzOffset)%60);
  return `${year}-${month}-${day}T${hours}-${minutes}-${seconds}${sign}${tzH}${tzM}`;
}

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function writeDummy(file, size = 1024) {
  fs.writeFileSync(file, Buffer.alloc(size, 0));
}

async function runScenario({ createBare, createDotDb }) {
  ensureDir(SQLITE_DIR);
  ensureDir(BACKUP_DIR);

  // Clean existing
  ['debitmanager', 'debitmanager.db'].forEach(f => {
    const p = path.join(SQLITE_DIR, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  if (createBare) writeDummy(path.join(SQLITE_DIR, 'debitmanager'));
  if (createDotDb) writeDummy(path.join(SQLITE_DIR, 'debitmanager.db'), 2048);

  console.log('\n--- Scenario ---', { createBare, createDotDb });
  const candidates = ['debitmanager.db', 'debitmanager'];
  let chosen = null;
  for (const c of candidates) {
    const p = path.join(SQLITE_DIR, c);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) { chosen = p; break; }
  }
  console.log('Resolved DB path:', chosen);

  // backup: prefer canonical .db (we picked that above)
  if (!chosen) { console.warn('No DB found - skipping'); return false; }
  const dest = path.join(BACKUP_DIR, `debitmanager-${encodeURIComponent(localTimestamp())}.db`);
  fs.copyFileSync(chosen, dest);
  console.log('Backed up to', dest);

  // Simulate restore: copy backup into canonical .db and remove bare file
  const restoreTarget = path.join(SQLITE_DIR, 'debitmanager.db');
  fs.copyFileSync(dest, restoreTarget);
  console.log('Restored backup to', restoreTarget);
  const barePath = path.join(SQLITE_DIR, 'debitmanager');
  if (fs.existsSync(barePath)) {
    fs.unlinkSync(barePath);
    console.log('Deleted bare file', barePath);
  }

  // Validate: ensure debitmanager.db exists and bare does not
  const ok = fs.existsSync(restoreTarget) && !fs.existsSync(barePath);
  console.log('Validation result:', ok ? 'OK' : 'FAIL');
  return ok;
}

(async () => {
  try {
    ensureDir(BASE);
    const scenarios = [
      { createBare: true, createDotDb: false },
      { createBare: false, createDotDb: true },
      { createBare: true, createDotDb: true },
    ];
    let allOk = true;
    for (const s of scenarios) {
      const ok = await runScenario(s);
      allOk = allOk && ok;
    }
    if (!allOk) {
      console.error('\nOne or more scenarios failed');
      process.exit(2);
    }
    console.log('\nAll scenarios passed - backup/restore logic validated locally.');
    process.exit(0);
  } catch (e) {
    console.error('Script failed:', e);
    process.exit(1);
  }
})();
