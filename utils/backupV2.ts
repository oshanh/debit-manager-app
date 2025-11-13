// Resolve the shared DB helper explicitly to avoid Metro/platform resolution
// picking up the platform proxy file (db.native.ts) which doesn't export
// closeDatabaseHandlesForBackup. Try the shared core file first, then fall
// back to the alias if necessary.
let closeDatabaseHandlesForBackup: (() => Promise<boolean>) | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const coreDb = require('../database/db.ts');
  closeDatabaseHandlesForBackup = coreDb?.closeDatabaseHandlesForBackup;
} catch {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const aliased = require('@/database/db');
    closeDatabaseHandlesForBackup = aliased?.closeDatabaseHandlesForBackup;
  } catch {
    console.warn('[Backup] Could not resolve closeDatabaseHandlesForBackup');
    closeDatabaseHandlesForBackup = undefined;
  }
}
import * as FileSystem from 'expo-file-system/legacy';
import 'expo-sqlite';
import {
  getAccessToken,
  getOrCreateBackupFolder,
  isSignedInToGoogleDrive,
  uploadFileToGoogleDrive,
} from './googleDriveService';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Sharing: any = require('expo-sharing');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Constants: any = require('expo-constants');

const DOC_DIR = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
const SQLITE_DIR = `${DOC_DIR}SQLite/`;
const BACKUP_DIR = `${DOC_DIR}backups/`;
const META_FILE = `${DOC_DIR}backup_meta.json`;
// Prefer the canonical .db filename when present
const DB_CANDIDATES = ['debitmanager.db', 'debitmanager'];

async function ensureDir(uri: string) {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
    }
  } catch (e) {
    console.warn('ensureDir:', e);
  }
}

export async function resolveDatabasePath(): Promise<string> {
  // Try each candidate
  for (const name of DB_CANDIDATES) {
    const candidate = SQLITE_DIR + name;
    try {
      const info = await FileSystem.getInfoAsync(candidate);
      if (info.exists && !info.isDirectory) {
        return candidate;
      }
    } catch {
      continue;
    }
  }
  
  // Fallback: list files
  try {
    const listing = await FileSystem.readDirectoryAsync(SQLITE_DIR);
    const match = listing.find((f: string) => f.startsWith('debitmanager'));
    if (match) return SQLITE_DIR + match;
  } catch {}
  
  throw new Error('Database file not found in SQLite directory.');
}

function timestamp(): string {
  const d = new Date();
  // utc iso for debug
  const iso = d.toISOString();
  // Build a local-time timestamp suitable for filenames: YYYY-MM-DDTHH-mm-ss+ZZZZ (offset without colon)
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  const tzOffsetMinutes = -d.getTimezoneOffset(); // minutes east of UTC
  const tzSign = tzOffsetMinutes >= 0 ? '+' : '-';
  const tzHours = pad(Math.floor(Math.abs(tzOffsetMinutes) / 60));
  const tzMins = pad(Math.abs(tzOffsetMinutes) % 60);
  const localStamp = `${year}-${month}-${day}T${hours}-${minutes}-${seconds}${tzSign}${tzHours}${tzMins}`;
  console.log('Generated timestamp (UTC):', iso, 'Generated timestamp (local):', localStamp);
  return localStamp;
}

export async function backupDatabase(): Promise<{ uri: string }> {
  let dbPath = await resolveDatabasePath();
  // If resolveDatabasePath returned a bare filename, prefer the .db variant if it exists
  try {
    const candidateDb = dbPath.endsWith('.db') ? dbPath : `${dbPath}.db`;
    const info = await FileSystem.getInfoAsync(candidateDb);
    if (info.exists && !info.isDirectory) {
      console.log('[Backup] Prefer canonical .db source:', candidateDb);
      dbPath = candidateDb;
    }
  } catch {}
  // Try to flush WAL and close DB to ensure a consistent main DB file.
  // Use the centralized helper in database/db.ts which attempts the open/checkpoint/close.
  let didFlush = false;
  try {
    if (typeof closeDatabaseHandlesForBackup === 'function') {
      try {
        didFlush = await closeDatabaseHandlesForBackup();
      } catch (err) {
        console.warn('[Backup] closeDatabaseHandlesForBackup failed:', err);
      }
    } else {
      console.warn('[Backup] closeDatabaseHandlesForBackup not available at runtime');
    }
  } catch {
    // defensive: any unexpected error here should not block backup
    console.warn('[Backup] Unexpected error while attempting to close DB handles');
  }
  if (didFlush === false) {
    console.log('[Backup] Could not open DB to checkpoint WAL. Proceeding with copy.');
  } else {
    // small delay to ensure file handles released
    await new Promise((r) => setTimeout(r, 150));
  }
  // If we resolved to the bare filename (no .db), try to create a canonical .db copy
  if (!dbPath.endsWith('.db')) {
    const candidateDb = `${dbPath}.db`;
    try {
      // Attempt to copy the bare file to the .db variant so backups are always of debitmanager.db
      await FileSystem.copyAsync({ from: dbPath, to: candidateDb });
      console.log('[Backup] Copied bare DB to canonical .db for backup:', candidateDb);
      dbPath = candidateDb;
    } catch (e) {
      console.warn('[Backup] Failed to copy bare DB to .db; proceeding with original source:', e);
    }
  }
  await FileSystem.makeDirectoryAsync(BACKUP_DIR, { intermediates: true });
  const dest = `${BACKUP_DIR}debitmanager-${timestamp()}.db`;
  // Log source info
  try {
    const info = await FileSystem.getInfoAsync(dbPath);
    console.log('[Backup] Source DB info:', JSON.stringify(info));
  } catch {}
  await FileSystem.copyAsync({ from: dbPath, to: dest });
  // If the source had WAL/SHM files, copy them alongside the backup so the
  // backup preserves any uncheckpointed recent writes.
  try {
    const walSrc = `${dbPath}-wal`;
    const shmSrc = `${dbPath}-shm`;
    const walInfo = await FileSystem.getInfoAsync(walSrc).catch(() => ({ exists: false }));
    const shmInfo = await FileSystem.getInfoAsync(shmSrc).catch(() => ({ exists: false }));
    if (walInfo.exists) {
      try {
        await FileSystem.copyAsync({ from: walSrc, to: `${dest}-wal` });
        console.log('[Backup] Copied WAL alongside backup:', `${dest}-wal`);
      } catch (e) {
        console.warn('[Backup] Failed to copy WAL file:', e);
      }
    }
    if (shmInfo.exists) {
      try {
        await FileSystem.copyAsync({ from: shmSrc, to: `${dest}-shm` });
        console.log('[Backup] Copied SHM alongside backup:', `${dest}-shm`);
      } catch (e) {
        console.warn('[Backup] Failed to copy SHM file:', e);
      }
    }
  } catch (e) {
    console.warn('[Backup] error checking/copying WAL/SHM:', e);
  }
  try {
    const info = await FileSystem.getInfoAsync(dest);
    console.log('[Backup] Backup file info:', JSON.stringify(info));
  } catch {}
  
  return { uri: dest };
}

export async function shareBackup(uri: string): Promise<boolean> {
  const available = await Sharing.isAvailableAsync();
  if (!available) return false;
  
  // On Android, this will show Google Drive, OneDrive, etc. in the share sheet
  await Sharing.shareAsync(uri, {
    mimeType: 'application/octet-stream',
    dialogTitle: 'Save Backup to Cloud',
  });
  
  return true;
}

export async function uploadBackupIfConfigured(uri: string): Promise<boolean> {
  const extra: any = Constants?.expoConfig?.extra ?? Constants?.manifest?.extra ?? {};
  const uploadUrl: string | undefined = extra?.backup?.uploadUrl;
  const authToken: string | undefined = extra?.backup?.authToken;
  
  if (!uploadUrl) return false;
  
  try {
    const content = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    
    // Decode base64 to binary for upload
    const binaryString = atob(content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      // eslint-disable-next-line unicorn/prefer-code-point
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: bytes,
    });
    
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }
    
    return true;
  } catch (e) {
    console.warn('Backup upload failed:', e);
    return false;
  }
}

export async function uploadToGoogleDrive(uri: string): Promise<boolean> {
  try {
    // Check if signed in to Google Drive
    const isSignedIn = await isSignedInToGoogleDrive();
    if (!isSignedIn) {
      console.log('Not signed in to Google Drive');
      return false;
    }

    // Get access token
    const accessToken = await getAccessToken();

    // Get or create backup folder
    const folderId = await getOrCreateBackupFolder(accessToken);

    // Get filename from URI
    const fileName = uri.split('/').pop() || `debitmanager-${timestamp()}.db`;

    // Upload to Google Drive
    await uploadFileToGoogleDrive(accessToken, uri, fileName, folderId);

    console.log('Backup uploaded to Google Drive successfully');
    return true;
  } catch (error) {
    console.error('Failed to upload to Google Drive:', error);
    return false;
  }
}

export async function setLastBackupTimestamp(date: Date): Promise<void> {
  try {
    const payload = JSON.stringify({ lastBackupISO: date.toISOString() });
    await FileSystem.writeAsStringAsync(META_FILE, payload, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch (e) {
    console.warn('Failed to write last backup timestamp:', e);
  }
}

export async function getLastBackupTimestamp(): Promise<Date | null> {
  try {
    const info = await FileSystem.getInfoAsync(META_FILE);
    if (!info.exists) return null;
    const content = await FileSystem.readAsStringAsync(META_FILE, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const json = JSON.parse(content);
    if (json?.lastBackupISO) {
      const d = new Date(json.lastBackupISO);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  } catch (e) {
    console.warn('Failed to read last backup timestamp:', e);
    return null;
  }
}

export async function backupNow(): Promise<{ uri: string; uploaded: boolean; shared: boolean; googleDrive: boolean }> {
  const { uri } = await backupDatabase();
  // Record last backup time immediately after creating the local copy
  await setLastBackupTimestamp(new Date());
  
  // Try Google Drive first
  const googleDrive = await uploadToGoogleDrive(uri);
  if (googleDrive) {
    return { uri, uploaded: false, shared: false, googleDrive };
  }
  
  // Try configured upload endpoint
  const uploaded = await uploadBackupIfConfigured(uri);
  let shared = false;
  
  if (!uploaded) {
    // Fallback to share sheet - user can choose Google Drive manually
    try {
      shared = await shareBackup(uri);
    } catch (e) {
      console.warn('Share failed:', e);
    }
  }
  
  return { uri, uploaded, shared, googleDrive };
}

