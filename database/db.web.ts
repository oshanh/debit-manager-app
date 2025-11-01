// Web SQLite setup using expo-sqlite (WASM-backed via plugin config)
import type { SQLiteDatabase } from 'expo-sqlite';
import { SQLiteProvider } from 'expo-sqlite';

// Toggle verbose DB logging via Expo env: set EXPO_PUBLIC_DB_DEBUG=true
const DB_DEBUG = typeof process !== 'undefined' && (process as any)?.env?.EXPO_PUBLIC_DB_DEBUG === 'true';
function dbg(...args: any[]) { if (DB_DEBUG) console.log('[DB]', ...args); }

export async function migrateDbIfNeeded(db: SQLiteDatabase) {
  const DATABASE_VERSION = 2;
  dbg('migrateDbIfNeeded(web): start');
  const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let currentDbVersion = result?.user_version ?? 0;
  dbg('migrateDbIfNeeded(web): current version =', currentDbVersion);
  if (currentDbVersion >= DATABASE_VERSION) return;

  if (currentDbVersion === 0) {
    dbg('migrateDbIfNeeded(web): applying v1 schema');
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
    dbg('migrateDbIfNeeded(web): applying v2 schema');
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
  dbg('migrateDbIfNeeded(web): completed, set user_version =', DATABASE_VERSION);
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

// --- Provider remount helper for web ---
let providerRemountCallbackWeb: (() => void) | null = null;

export function registerSQLiteProviderRemount(cb: () => void) {
  providerRemountCallbackWeb = cb;
}

export async function refreshSQLiteProvider(): Promise<boolean> {
  const now = Date.now();
  // Simple debounce
  (refreshSQLiteProvider as any)._last = (refreshSQLiteProvider as any)._last || 0;
  if (now - (refreshSQLiteProvider as any)._last < 1000) {
    console.log('[DB(web)] refreshSQLiteProvider: debounced');
    return false;
  }
  (refreshSQLiteProvider as any)._last = now;

  try {
    if (providerRemountCallbackWeb) {
      providerRemountCallbackWeb();
      console.log('[DB(web)] refreshSQLiteProvider: requested provider remount');
    } else {
      console.warn('[DB(web)] refreshSQLiteProvider: no remount callback registered');
    }
    return true;
  } catch (e) {
    console.error('[DB(web)] refreshSQLiteProvider: error calling remount callback', e);
    return false;
  }
}

// Proxy notifyProviderRemounted to the shared db.ts module so platform-specific
// imports that resolve to this file still expose the function expected by callers.
export function notifyProviderRemounted(ok = true): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
      const core = require('./db.ts');
    if (core === exports || core.notifyProviderRemounted === notifyProviderRemounted) {
      console.warn('[DB(web)] notifyProviderRemounted: core resolved to platform file, skipping to avoid recursion');
      return;
    }
    if (core && typeof core.notifyProviderRemounted === 'function') {
      core.notifyProviderRemounted(ok);
    } else {
      console.warn('[DB(web)] notifyProviderRemounted: core.notifyProviderRemounted not found');
    }
  } catch (e) {
    console.warn('[DB(web)] notifyProviderRemounted proxy failed:', e);
  }
}
