import type { SQLiteDatabase } from 'expo-sqlite';

// Toggle verbose DB logging via Expo env: set EXPO_PUBLIC_DB_DEBUG=true
const DB_DEBUG = typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_DB_DEBUG === 'true';

function dbg(...args: any[]) {
  if (DB_DEBUG) console.log('[DB]', ...args);
}

export async function migrateDbIfNeeded(db: SQLiteDatabase) {
  const DATABASE_VERSION = 2;
  dbg('migrateDbIfNeeded: start');
  const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let currentDbVersion = result?.user_version ?? 0;
  dbg('migrateDbIfNeeded: current version =', currentDbVersion);
  if (currentDbVersion >= DATABASE_VERSION) {
    dbg('migrateDbIfNeeded: up-to-date, skipping');
    return;
  }
  if (currentDbVersion === 0) {
    dbg('migrateDbIfNeeded: applying v1 schema');
    await db.execAsync(`
      PRAGMA journal_mode = 'wal';
      PRAGMA foreign_keys = ON;
      CREATE TABLE debtors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        balance REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE phone_numbers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        debtor_id INTEGER NOT NULL,
        phone_number TEXT NOT NULL,
        FOREIGN KEY (debtor_id) REFERENCES debtors(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_debtor_id ON phone_numbers(debtor_id);
    `);
    currentDbVersion = 1;
  }
  if (currentDbVersion === 1) {
    dbg('migrateDbIfNeeded: applying v2 schema');
    await db.execAsync(`
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        debtor_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('IN', 'OUT')),
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        amount REAL NOT NULL,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (debtor_id) REFERENCES debtors(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_transactions_debtor_id ON transactions(debtor_id);
    `);
  }
  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
  dbg('migrateDbIfNeeded: completed, set user_version =', DATABASE_VERSION);
}
export { SQLiteProvider as getSQLiteProviderShim, useSQLiteContext } from 'expo-sqlite';
// Provide a function to mirror web helper API
export function getSQLiteProvider() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('expo-sqlite').SQLiteProvider;
}

// Utility to log DB health by running light PRAGMAs
export async function logDbStatus(db: SQLiteDatabase, label: string = ''): Promise<void> {
  if (!DB_DEBUG) return;
  const prefix = label ? `[status:${label}]` : '[status]';
  try {
    const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const mode = await db.getFirstAsync<{ journal_mode: string }>('PRAGMA journal_mode');
    console.log('[DB]', prefix, 'OK', {
      user_version: version?.user_version ?? 'unknown',
      journal_mode: (mode as any)?.journal_mode ?? 'unknown',
    });
  } catch (e: any) {
    console.warn('[DB]', prefix, 'ERROR', e?.message ?? e);
  }
}

// --- Provider remount helper ---
let providerRemountCallback: (() => void) | null = null;
let remountWaiters: Array<(ok: boolean) => void> = [];

export function registerSQLiteProviderRemount(cb: () => void) {
  providerRemountCallback = cb;
}

// Request a provider remount and return a promise that resolves when the provider
// reports it's ready again. Times out after 5s and resolves `false` on timeout.
export function refreshSQLiteProvider(): Promise<boolean> {
  try {
    if (providerRemountCallback) {
      providerRemountCallback();
      console.log('[DB] refreshSQLiteProvider: requested provider remount');
    } else {
      console.warn('[DB] refreshSQLiteProvider: no remount callback registered');
    }

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        // Remove this waiter
        remountWaiters = remountWaiters.filter(r => r !== resolve);
        console.warn('[DB] refreshSQLiteProvider: timed out waiting for remount');
        resolve(false);
      }, 5000);

      remountWaiters.push((ok: boolean) => {
        clearTimeout(timeout);
        resolve(ok);
      });
    });
  } catch (e) {
    console.error('[DB] refreshSQLiteProvider: error calling remount callback', e);
    return Promise.resolve(false);
  }
}

export function notifyProviderRemounted(ok = true) {
  try {
    // Drain current waiters and resolve them after a short stabilization delay.
    // This gives the native helper a small amount of time to release WAL handles
    // or for any final provider initialization steps to settle before callers retry.
    const waiters = remountWaiters.slice();
    remountWaiters = [];
  const STABILIZE_MS = 1000; // small delay to reduce racing retries (increased to allow native handles to stabilize)
    setTimeout(() => {
      for (const r of waiters) {
        try {
          r(ok);
        } catch (e) {
          console.warn('[DB] notifyProviderRemounted waiter threw', e);
        }
      }
    }, STABILIZE_MS);
  } catch (e) {
    console.warn('[DB] notifyProviderRemounted error', e);
    remountWaiters = [];
  }
}

// Attempt to open candidate DB names, run a WAL checkpoint and close them.
// This is useful before performing backup/restore file operations so native
// handles are released. Returns true if any candidate was successfully
// checkpointed and closed.
export async function closeDatabaseHandlesForBackup(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const expoSqlite: any = require('expo-sqlite');
    const openAsync = expoSqlite.openDatabaseAsync ?? expoSqlite.openDatabase;
    if (typeof openAsync !== 'function') return false;

    // Prefer the canonical `.db` filename first so we checkpoint the file
    // that most app code uses. Also attempt both candidates rather than
    // returning after the first success — this ensures any stray handles on
    // the alternate filename are also released.
    const candidates = ['debitmanager.db', 'debitmanager'];
    let anySuccess = false;
    for (const name of candidates) {
      try {
        const dbHandle = await openAsync(name);
        if (!dbHandle) continue;
        try {
          if (dbHandle.execAsync) await dbHandle.execAsync("PRAGMA wal_checkpoint(TRUNCATE);");
        } catch (e) {
          console.warn('[DB] checkpoint failed for', name, e);
        }
        try {
          if (dbHandle.closeAsync) await dbHandle.closeAsync();
        } catch (e) {
          console.warn('[DB] closeAsync failed for', name, e);
        }
        console.log('[DB] closeDatabaseHandlesForBackup: opened and checkpointed', name);
        anySuccess = true;
        // continue to next candidate to attempt releasing other handles
      } catch {
        // try next candidate
        continue;
      }
    }
    return anySuccess;
  } catch (e) {
    console.warn('[DB] closeDatabaseHandlesForBackup failed:', e);
    return false;
  }
}

