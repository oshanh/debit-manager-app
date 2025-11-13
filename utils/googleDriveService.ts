/**
 * Get and restore the latest backup file from Google Drive
 */
export async function restoreLatestBackupFromGoogleDrive(destinationUri: string): Promise<boolean> {
  try {
    console.log('[Restore] Getting Google Drive access token...');
    const accessToken = await getAccessToken();
    console.log('[Restore] Got access token:', !!accessToken);
    const folderId = await getOrCreateBackupFolder(accessToken);
    console.log('[Restore] Got/created backup folder:', folderId);
    const files = await listBackupFiles(accessToken, folderId);
    console.log('[Restore] Files found:', files.map(f => f.name));
    if (!files || files.length === 0) throw new Error('No backup files found in Google Drive');
    const latest = files[0];
    console.log('[Restore] Latest file:', latest.name, latest.id);
    // Download to a temp file first
    const tempFile = destinationUri + '.tmp';
    console.log('[Restore] Downloading to temp file:', tempFile);
    await downloadFileFromGoogleDrive(accessToken, latest.id, tempFile);
    const tempInfo = await FileSystem.getInfoAsync(tempFile);
    console.log('[Restore] Temp file info:', JSON.stringify(tempInfo));
    console.log('[Restore] Downloaded. Copying to DB:', destinationUri);
    // Overwrite the DB file with the downloaded backup (canonical .db path)
    await FileSystem.copyAsync({ from: tempFile, to: destinationUri });
    const destInfo = await FileSystem.getInfoAsync(destinationUri);
    console.log('[Restore] Destination info after copy:', JSON.stringify(destInfo));

    // Ensure we do NOT create or keep the alternate bare filename variant.
    // If an alternate exists (e.g. "debitmanager"), remove it to keep a single canonical .db.
    const altDestination = destinationUri.endsWith('.db') ? destinationUri.slice(0, -3) : `${destinationUri}.db`;
    if (altDestination !== destinationUri) {
      try {
        await FileSystem.deleteAsync(altDestination, { idempotent: true });
        console.log('[Restore] Removed alternate destination if existed:', altDestination);
      } catch (e) {
        console.log('[Restore] Failed removing alternate destination (ok to continue):', e);
      }
    }

    // Remove any WAL/SHM files for the canonical path to avoid stale state
    try { await FileSystem.deleteAsync(`${destinationUri}-wal`, { idempotent: true }); } catch {}
    try { await FileSystem.deleteAsync(`${destinationUri}-shm`, { idempotent: true }); } catch {}

    console.log('[Restore] Copied. Deleting temp file.');
    // Optionally, delete the temp file
    await FileSystem.deleteAsync(tempFile, { idempotent: true });
    console.log('[Restore] Restore complete!');
    return true;
  } catch (error) {
    console.error('Failed to restore latest backup from Google Drive:', error);
    return false;
  }
}
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import axios from 'axios';
import * as FileSystem from 'expo-file-system/legacy';

const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3';
const GOOGLE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

export interface GoogleDriveConfig {
  webClientId: string;
  scopes: string[];
}

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  modifiedTime: string;
}

/**
 * Initialize Google Sign-In
 */
export async function initializeGoogleDrive(config: GoogleDriveConfig) {
  try {
    GoogleSignin.configure({
      webClientId: config.webClientId,
      scopes: config.scopes,
      offlineAccess: true,
    });
    console.log('Google Drive initialized');
  } catch (error) {
    console.error('Failed to initialize Google Drive:', error);
    throw error;
  }
}

/**
 * Sign in to Google and request Drive access 
 */
export async function signInToGoogleDrive(): Promise<{
  user: any;
  accessToken: string;
}> {
  try {
    await GoogleSignin.hasPlayServices();
    const userInfo = await GoogleSignin.signIn();
    const tokens = await GoogleSignin.getTokens();
    
    return {
      user: userInfo.data?.user,
      accessToken: tokens.accessToken,
    };
  } catch (error) {
    console.error('Google Sign-In failed:', error);
    throw error;
  }
}

/**
 * Sign out from Google
 */
export async function signOutFromGoogleDrive(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch (error) {
    console.error('Google Sign-Out failed:', error);
    throw error;
  }
}

/**
 * Check if user is already signed in
 */
export async function isSignedInToGoogleDrive(): Promise<boolean> {
  try {
    const currentUser = GoogleSignin.getCurrentUser();
    return currentUser !== null;
  } catch (error) {
    console.error('Failed to check sign-in status:', error);
    return false;
  }
}

/**
 * Get current access token (refreshes if needed)
 */
export async function getAccessToken(): Promise<string> {
  try {
    const tokens = await GoogleSignin.getTokens();
    return tokens.accessToken;
  } catch (error) {
    console.error('Failed to get access token:', error);
    throw error;
  }
}

/**
 * Get current user info
 */
export function getCurrentUser() {
  try {
    const userInfo = GoogleSignin.getCurrentUser();
    return userInfo;
  } catch (error) {
    console.error('Failed to get current user:', error);
    return null;
  }
}

/**
 * Create a folder in Google Drive (or get existing folder)
 */
export async function getOrCreateBackupFolder(
  accessToken: string,
  folderName: string = 'Debit Manager Backups'
): Promise<string> {
  try {
    // Search for existing folder
    const searchResponse = await axios.get(`${GOOGLE_DRIVE_API}/files`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      params: {
        q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)',
      },
    });

    if (searchResponse.data.files && searchResponse.data.files.length > 0) {
      return searchResponse.data.files[0].id;
    }

    // Create new folder
    const createResponse = await axios.post(
      `${GOOGLE_DRIVE_API}/files`,
      {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return createResponse.data.id;
  } catch (error) {
    console.error('Failed to get/create backup folder:', error);
    throw error;
  }
}

/**
 * Upload a file to Google Drive
 */
export async function uploadFileToGoogleDrive(
  accessToken: string,
  fileUri: string,
  fileName: string,
  folderId?: string,
  mimeType: string = 'application/x-sqlite3'
): Promise<{ id: string; name: string; webViewLink: string }> {
  try {
    // Read file as base64
    const fileContent = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Convert base64 to binary
    const binaryString = atob(fileContent);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      // eslint-disable-next-line unicorn/prefer-code-point
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Create metadata
    const metadata = {
      name: fileName,
      mimeType: mimeType,
      ...(folderId && { parents: [folderId] }),
    };

    // Create multipart request
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadataPart = delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata);
    const dataPart = delimiter + `Content-Type: ${mimeType}\r\n` + 'Content-Transfer-Encoding: base64\r\n\r\n' + fileContent;

    const multipartRequestBody = metadataPart + dataPart + closeDelimiter;

    const response = await axios.post(`${GOOGLE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,webViewLink`, multipartRequestBody, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
    });

    return response.data;
  } catch (error) {
    console.error('Failed to upload file to Google Drive:', error);
    throw error;
  }
}

/**
 * List backup files in Google Drive folder
 */
export async function listBackupFiles(accessToken: string, folderId: string): Promise<GoogleDriveFile[]> {
  try {
    const response = await axios.get(`${GOOGLE_DRIVE_API}/files`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      params: {
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id, name, mimeType, createdTime, modifiedTime)',
        orderBy: 'createdTime desc',
      },
    });

    return response.data.files || [];
  } catch (error) {
    console.error('Failed to list backup files:', error);
    throw error;
  }
}

/**
 * Delete a file from Google Drive
 */
export async function deleteFileFromGoogleDrive(accessToken: string, fileId: string): Promise<void> {
  try {
    await axios.delete(`${GOOGLE_DRIVE_API}/files/${fileId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (error) {
    console.error('Failed to delete file from Google Drive:', error);
    throw error;
  }
}

/**
 * Download a file from Google Drive
 */
export async function downloadFileFromGoogleDrive(
  accessToken: string,
  fileId: string,
  destinationUri: string
): Promise<void> {
  try {
    const response = await axios.get(`${GOOGLE_DRIVE_API}/files/${fileId}?alt=media`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      responseType: 'arraybuffer',
    });

    // Convert arraybuffer to base64
    const base64 = btoa(
      // eslint-disable-next-line unicorn/prefer-code-point
      new Uint8Array(response.data).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    await FileSystem.writeAsStringAsync(destinationUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (error) {
    console.error('Failed to download file from Google Drive:', error);
    throw error;
  }
}
