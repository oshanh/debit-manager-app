import type { SQLiteDatabase } from 'expo-sqlite';
import { SQLiteProvider } from 'expo-sqlite';

// Toggle verbose DB logging via Expo env: set EXPO_PUBLIC_DB_DEBUG=true
const DB_DEBUG = typeof process !== 'undefined' && (process as any)?.env?.EXPO_PUBLIC_DB_DEBUG === 'true';
function dbg(...args: any[]) { if (DB_DEBUG) console.log('[DB]', ...args); }

export async function migrateDbIfNeeded(db: SQLiteDatabase) {
  const DATABASE_VERSION = 2;
  dbg('migrateDbIfNeeded(native): start');
  const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let currentDbVersion = result?.user_version ?? 0;
  dbg('migrateDbIfNeeded(native): current version =', currentDbVersion);
  if (currentDbVersion >= DATABASE_VERSION) return;

  if (currentDbVersion === 0) {
    dbg('migrateDbIfNeeded(native): applying v1 schema');
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
    dbg('migrateDbIfNeeded(native): applying v2 schema');
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
  dbg('migrateDbIfNeeded(native): completed, set user_version =', DATABASE_VERSION);
}

export { useSQLiteContext } from 'expo-sqlite';
export function getSQLiteProvider() { return SQLiteProvider; }

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

// --- Provider remount helper for native ---
let providerRemountCallbackNative: (() => void) | null = null;
let lastNativeRefresh = 0;

export function registerSQLiteProviderRemount(cb: () => void) {
  providerRemountCallbackNative = cb;
}

export async function refreshSQLiteProvider(): Promise<boolean> {
  const now = Date.now();
  if (now - lastNativeRefresh < 1000) {
    console.log('[DB(native)] refreshSQLiteProvider: debounced');
    return false;
  }
  lastNativeRefresh = now;

  try {
    // Run the checkpoint/close helper synchronously so file handles are
    // released before we request the React provider to remount. This ordering
    // reduces races where the provider mounts while native handles still hold
    // the DB open, which can lead to NullPointerExceptions in the native
    // module.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const expoSqlite: any = require('expo-sqlite');
    const openAsync = expoSqlite.openDatabaseAsync ?? expoSqlite.openDatabase;
    if (typeof openAsync === 'function') {
      const candidates = ['debitmanager.db', 'debitmanager'];
      for (const name of candidates) {
        try {
          const dbHandle = await openAsync(name);
          if (!dbHandle) continue;
          try { if (dbHandle.execAsync) await dbHandle.execAsync("PRAGMA wal_checkpoint(TRUNCATE);"); } catch (e) { console.warn('[DB(native)] checkpoint failed for', name, e); }
          try { if (dbHandle.closeAsync) await dbHandle.closeAsync(); } catch (e) { console.warn('[DB(native)] closeAsync failed for', name, e); }
          console.log('[DB(native)] refreshSQLiteProvider: opened and checkpointed', name);
          // continue to attempt other candidates to fully release handles
        } catch (e) {
          console.warn('[DB(native)] open failed for', name, e);
          continue;
        }
      }
    }

    // Now request the provider remount so the React-side provider opens a
    // fresh SQLite instance after native handles were released.
    if (providerRemountCallbackNative) {
      providerRemountCallbackNative();
      console.log('[DB(native)] refreshSQLiteProvider: requested provider remount');
    } else {
      console.warn('[DB(native)] refreshSQLiteProvider: no remount callback registered');
    }

    // Consumers should call the Promise returned by db.refreshSQLiteProvider() and retry afterwards.
    // We resolve true here; more precise completion is signaled by notifyProviderRemounted from layout.
    return true;
  } catch (e) {
    console.error('[DB(native)] refreshSQLiteProvider: error during checkpoint/remount flow', e);
    // Still try to request a provider remount even if checkpoint failed
    if (providerRemountCallbackNative) {
      try { providerRemountCallbackNative(); console.log('[DB(native)] refreshSQLiteProvider: requested provider remount (after error)'); } catch {}
    }
    return false;
  }
}

// Proxy notifyProviderRemounted to the shared db.ts module so platform-specific
// imports that resolve to this file still expose the function expected by callers.
export function notifyProviderRemounted(ok = true): void {
  try {
    // Dynamically require the shared core implementation by explicit filename to
    // avoid Metro's platform resolution (which would resolve './db' back to
    // this platform file and cause recursion). Using the explicit './db.ts'
    // filename ensures we load the non-platform shared file.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const core = require('./db.ts');
    // If the bundler/platform resolution caused './db' to resolve back to this
    // platform file, avoid calling into ourselves which would cause recursion.
    if (core === exports || core.notifyProviderRemounted === notifyProviderRemounted) {
      console.warn('[DB(native)] notifyProviderRemounted: core resolved to platform file, skipping to avoid recursion');
      return;
    }
    if (core && typeof core.notifyProviderRemounted === 'function') {
      core.notifyProviderRemounted(ok);
    } else {
      console.warn('[DB(native)] notifyProviderRemounted: core.notifyProviderRemounted not found');
    }
  } catch (e) {
    console.warn('[DB(native)] notifyProviderRemounted proxy failed:', e);
  }
}
