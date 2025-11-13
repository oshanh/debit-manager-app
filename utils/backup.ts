// Use untyped requires to avoid strict/obsolete TS signatures issues across SDKs
// eslint-disable-next-line @typescript-eslint/no-var-requires
const FileSystem: any = require('expo-file-system/legacy');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Sharing: any = require('expo-sharing');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Constants: any = require('expo-constants');

// Some type definitions may not include documentDirectory; cast to any safely.
const DOC_DIR = (FileSystem.documentDirectory as string | null) ?? (FileSystem.cacheDirectory as string);
const SQLITE_DIR = DOC_DIR + 'SQLite/';
const BACKUP_DIR = DOC_DIR + 'backups/';
const DB_CANDIDATES = ['debitmanager', 'debitmanager.db'];

async function ensureDir(uri: string) {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
  }
}

export async function resolveDatabasePath(): Promise<string> {
  await ensureDir(SQLITE_DIR);
  for (const name of DB_CANDIDATES) {
    const candidate = SQLITE_DIR + name;
    const info = await FileSystem.getInfoAsync(candidate);
    if (info.exists && info.isDirectory !== true) {
      return candidate;
    }
  }
  // As a fallback, list files and pick the first matching debitmanager*
  const listing: string[] = await FileSystem.readDirectoryAsync(SQLITE_DIR);
  const match = listing.find((f: string) => f.startsWith('debitmanager'));
  if (match) return SQLITE_DIR + match;
  throw new Error('Database file not found in SQLite directory.');
}

function timestamp(): string {
  const d = new Date();
  const iso = d.toISOString();
  return iso.replaceAll(':', '-').replaceAll('.', '-');
}

export async function backupDatabase(): Promise<{ uri: string }> {
  const dbPath = await resolveDatabasePath();
  await ensureDir(BACKUP_DIR);
  const dest = `${BACKUP_DIR}debitmanager-${timestamp()}.db`;
  await FileSystem.copyAsync({ from: dbPath, to: dest });
  return { uri: dest };
}

export async function shareBackup(uri: string): Promise<boolean> {
  const available = await Sharing.isAvailableAsync();
  if (!available) return false;
  await Sharing.shareAsync(uri);
  return true;
}

export async function uploadBackupIfConfigured(uri: string): Promise<boolean> {
  const extra: any = Constants?.expoConfig?.extra ?? Constants?.manifestExtra ?? {};
  const uploadUrl: string | undefined = extra?.backup?.uploadUrl;
  const authToken: string | undefined = extra?.backup?.authToken;
  if (!uploadUrl) return false;
  try {
    await FileSystem.uploadAsync(uploadUrl, uri, {
      httpMethod: 'PUT',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      uploadType: 'binary',
    });
    return true;
  } catch (e) {
    console.warn('Backup upload failed:', e);
    return false;
  }
}

export async function backupNow(): Promise<{ uri: string; uploaded: boolean; shared: boolean }>{
  const { uri } = await backupDatabase();
  const uploaded = await uploadBackupIfConfigured(uri);
  let shared = false;
  if (!uploaded) {
    // Fallback to share sheet so user can save to Drive/OneDrive/etc.
    try { shared = await shareBackup(uri); } catch {}
  }
  return { uri, uploaded, shared };
}
