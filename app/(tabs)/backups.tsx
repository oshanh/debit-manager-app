import { useSQLiteContext } from '@/database/db';
import { Ionicons } from '@expo/vector-icons';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Modal, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { backupDatabase, backupNow, getLastBackupTimestamp, resolveDatabasePath } from '../../utils/backupV2';
import {
  getAccessToken,
  getCurrentUser,
  getOrCreateBackupFolder,
  initializeGoogleDrive,
  isSignedInToGoogleDrive,
  listBackupFiles as listDriveBackups,
  restoreLatestBackupFromGoogleDrive,
  signInToGoogleDrive,
  signOutFromGoogleDrive,
} from '../../utils/googleDriveService';
import { reloadApp } from '../../utils/reload';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Constants: any = require('expo-constants');

export default function BackupsScreen() {
  const db = useSQLiteContext();
  const [localBackups, setLocalBackups] = useState<any[]>([]);
  const [driveBackups, setDriveBackups] = useState<any[]>([]);
  const [sqliteFiles, setSqliteFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastBackup, setLastBackup] = useState<Date | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [initializing, setInitializing] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'drive' | 'local' | null>(null);

  useEffect(() => {
    initGoogleDrive();
  }, []);

  const initGoogleDrive = async () => {
    try {
      setInitializing(true);

      const webClientId = '188962916113-ga5ve15f5mvqv8smpkrieth2hk47vsua.apps.googleusercontent.com';

      console.log('[InitGoogleDrive] Using webClientId:', webClientId);

      // Only initialize if webClientId is available
      if (webClientId) {
        // Initialize Google Drive
        await initializeGoogleDrive({
          webClientId: webClientId,
          scopes: ['https://www.googleapis.com/auth/drive.file'],
        });

        // Check if already signed in
        const signedIn = await isSignedInToGoogleDrive();
        setIsSignedIn(signedIn);

        if (signedIn) {
          try {
            const userInfo: any = await GoogleSignin.signInSilently();
            // Extract user object and email from userInfo.data.user
            const user = userInfo?.data?.user ?? {};
            const email = user?.email ?? null;
            setUser({ ...user, email });
          } catch (e) {
            // fallback to getCurrentUser
            console.error('[GoogleSignin] signInSilently failed, using getCurrentUser:', e);
            const currentUser: any = getCurrentUser();
            console.log('[GoogleSignin] getCurrentUser:', JSON.stringify(currentUser, null, 2));
            const email = currentUser?.email || currentUser?.user?.email || null;
            setUser({ ...currentUser, email });
          }
        }
      } else {
        console.warn('Google Drive webClientId not configured. Sign-in will be disabled.');
      }

      // Load backups after initialization
      await loadBackups();
    } catch (error: any) {
      console.error('Failed to initialize Google Drive:', error);
      const errorMsg = error?.message || 'Unknown error';
      if (errorMsg.includes('offline use requires server web ClientID')) {
        setError('Google Drive setup incomplete. Please check your configuration and rebuild the app.');
      } else {
        setError('Failed to initialize Google Drive');
      }
    } finally {
      setInitializing(false);
    }
  };

  const loadBackups = async () => {
    setLoading(true);
    setError(null);
    try {
      // Load last backup timestamp
      const ts = await getLastBackupTimestamp();
      setLastBackup(ts);

      // Check sign-in status
      const signedIn = await isSignedInToGoogleDrive();
      setIsSignedIn(signedIn);

      // List local backups
      const DOC_DIR = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
      const BACKUP_DIR = `${DOC_DIR}backups/`;
      let localFiles: any[] = [];
      try {
        const files = await FileSystem.readDirectoryAsync(BACKUP_DIR);
        localFiles = await Promise.all(files.map(async (name) => {
          const info = await FileSystem.getInfoAsync(BACKUP_DIR + name);
          return { name, ...info };
        }));
      } catch {}
      setLocalBackups(localFiles);

      // List all files in SQLite directory
      const SQLITE_DIR = `${DOC_DIR}SQLite/`;
      let sqliteListing: string[] = [];
      try {
        sqliteListing = await FileSystem.readDirectoryAsync(SQLITE_DIR);
      } catch {}
      setSqliteFiles(sqliteListing);

      // List Google Drive backups
      let driveFiles: any[] = [];
      if (signedIn) {
        const accessToken = await getAccessToken();
        const folderId = await getOrCreateBackupFolder(accessToken);
        driveFiles = await listDriveBackups(accessToken, folderId);
      }
      setDriveBackups(driveFiles);
    } catch (e: any) {
      setError(e?.message || 'Failed to load backups');
    } finally {
      setLoading(false);
    }
  };



  const handleBackupNow = async () => {
    try {
      const { uri, googleDrive } = await backupNow();
      await loadBackups(); // Refresh the list
      if (googleDrive) {
        Alert.alert('Backup complete', 'Backup uploaded to Google Drive successfully! ☁️');
      } else {
        Alert.alert('Backup saved', `Backup saved locally at ${uri}`);
      }
    } catch (e: any) {
      Alert.alert('Backup failed', e?.message ?? 'Unknown error');
    }
  };

  const handleSignIn = async () => {
    try {
      setLoading(true);
      const { user: signedInUser } = await signInToGoogleDrive();
      setUser(signedInUser);
      setIsSignedIn(true);
      await loadBackups(); // Refresh to show Drive backups
      Alert.alert('Success', 'Signed in to Google Drive successfully!');
    } catch (error: any) {
      console.error('Sign in error:', error);
      Alert.alert('Error', error.message || 'Failed to sign in to Google Drive');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      setLoading(true);
      await signOutFromGoogleDrive();
      setUser(null);
      setIsSignedIn(false);
      setDriveBackups([]); // Clear Drive backups
      Alert.alert('Success', 'Signed out from Google Drive');
    } catch (error: any) {
      console.error('Sign out error:', error);
      Alert.alert('Error', 'Failed to sign out');
    } finally {
      setLoading(false);
    }
  };

  const formatRelativeTime = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return 'just now';
    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)} days ago`;
    return date.toLocaleDateString();
  };

  const handleRestoreBackup = async () => {
      setIsRestoring(true);
      let preRestoreSnapshot: string | null = null;
      try {
        // Before creating a pre-restore snapshot, attempt to checkpoint WAL and
        // close any native SQLite handles so the main .db file contains all
        // recent writes (otherwise a simple copy may miss WAL contents).
        try {
          // Try to resolve the shared core DB helper directly to avoid platform
          // proxy resolution which may not export the helper.
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const coreDb = require('../../database/db.ts');
          const cb = coreDb?.closeDatabaseHandlesForBackup;
          if (typeof cb === 'function') {
            try {
              console.log('[Restore] Running closeDatabaseHandlesForBackup before snapshot...');
              const ok = await cb();
              console.log('[Restore] closeDatabaseHandlesForBackup result:', ok);
            } catch (err) {
              console.warn('[Restore] closeDatabaseHandlesForBackup failed:', err);
            }
          } else {
            console.warn('[Restore] closeDatabaseHandlesForBackup not available on core DB');
          }
        } catch (e) {
          console.warn('[Restore] Could not resolve core DB helper for checkpoint:', e);
        }

        // Create a pre-restore snapshot so we can recover if the restore fails.
        try {
          console.log('[Restore] Creating pre-restore snapshot...');
          const snap = await backupDatabase();
          preRestoreSnapshot = snap?.uri ?? null;
          console.log('[Restore] Pre-restore snapshot saved at', preRestoreSnapshot);
        } catch (e) {
          console.warn('[Restore] Pre-restore snapshot creation failed (continuing):', e);
        }
        // Flush and close DB before overwriting the file
        try {
          console.log('[Restore] Running WAL checkpoint before close...');
          await db.execAsync?.("PRAGMA wal_checkpoint(TRUNCATE);");
        } catch (e) {
          console.log('[Restore] wal_checkpoint failed (ok to ignore):', e);
        }
        try {
          console.log('[Restore] Closing SQLite database before restore...');
          await (db as any)?.closeAsync?.();
          // tiny delay to ensure file handles are released
          await new Promise((r) => setTimeout(r, 150));
        } catch (e) {
          console.log('[Restore] closeAsync failed (ok to ignore):', e);
        }
  
        const DOC_DIR = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
        const SQLITE_DIR = `${DOC_DIR}SQLite/`;
        // Determine the actual DB file currently used on this device
        const DB_PATH = await resolveDatabasePath();
        // Prefer the canonical .db filename for restores
        const CANONICAL_DB_PATH = DB_PATH.endsWith('.db') ? DB_PATH : `${DB_PATH}.db`;
        console.log('[Restore] SQLite dir:', SQLITE_DIR);
        try {
          const listing = await FileSystem.readDirectoryAsync(SQLITE_DIR);
          console.log('[Restore] SQLite listing BEFORE:', listing);
        } catch (e) {
          console.log('[Restore] Failed to list SQLite dir BEFORE:', e);
        }
    try { const beforeInfo = await FileSystem.getInfoAsync(CANONICAL_DB_PATH); console.log('[Restore] Target canonical DB for restore:', CANONICAL_DB_PATH, 'info:', JSON.stringify(beforeInfo)); } catch {}

        // NOTE: Do NOT remove existing DB files before attempting restore. Removing
        // them preemptively can cause irreversible data loss if the restore fails
        // or the user cancels. Instead we restore into a temp file (the Google
        // Drive helper already downloads into a temp) and only replace the
        // canonical DB after a successful restore.

        // Try Google Drive restore first (restore into canonical .db path)
        const signedIn = await isSignedInToGoogleDrive();
        if (signedIn) {
          const ok = await restoreLatestBackupFromGoogleDrive(CANONICAL_DB_PATH);
          if (ok) {
            // After successful restore, ensure the bare DB (without .db) is removed so only CANONICAL_DB_PATH remains
            if (CANONICAL_DB_PATH !== DB_PATH) {
              try { await FileSystem.deleteAsync(DB_PATH, { idempotent: true }); } catch {}
            }
            // Remove any WAL/SHM files to prevent stale state
            const walCandidates = [CANONICAL_DB_PATH, DB_PATH];
            for (const p of walCandidates) {
              try { await FileSystem.deleteAsync(`${p}-wal`, { idempotent: true }); } catch {}
              try { await FileSystem.deleteAsync(`${p}-shm`, { idempotent: true }); } catch {}
            }
            try {
              const listingAfter = await FileSystem.readDirectoryAsync(SQLITE_DIR);
              console.log('[Restore] SQLite listing AFTER:', listingAfter);
            } catch {}
            try { const afterInfo = await FileSystem.getInfoAsync(CANONICAL_DB_PATH); console.log('[Restore] CANONICAL_DB_PATH AFTER restore info:', JSON.stringify(afterInfo)); } catch {}

            // Reload immediately to prevent "Access to closed resource" errors
            console.log('[Restore] Reloading app immediately...');
            await reloadApp();

            return;
          }
        }
        // Fallback: Pick a local file
        const result = await DocumentPicker.getDocumentAsync({
          type: ['application/x-sqlite3', 'application/octet-stream', '*/*'],
          copyToCacheDirectory: true,
          multiple: false,
        });
        if (!result?.assets?.[0]?.uri || result.canceled) return;
        const uri = result.assets[0].uri;
        // Copy into a temp file first, then move into the canonical location.
        // This avoids deleting the live DB until we have a complete restored file.
        const tempRestore = `${CANONICAL_DB_PATH}.restore.tmp`;
        try {
          await FileSystem.copyAsync({ from: uri, to: tempRestore });
          // Move into place (overwrite)
          try {
            await FileSystem.moveAsync({ from: tempRestore, to: CANONICAL_DB_PATH });
          } catch (e) {
            // Some environments may not support moveAsync across filesystems; fallback to copy+delete
            await FileSystem.copyAsync({ from: tempRestore, to: CANONICAL_DB_PATH });
            await FileSystem.deleteAsync(tempRestore, { idempotent: true });
          }
          if (CANONICAL_DB_PATH !== DB_PATH) {
            try { await FileSystem.deleteAsync(DB_PATH, { idempotent: true }); } catch {}
          }
          try { await FileSystem.deleteAsync(`${CANONICAL_DB_PATH}-wal`, { idempotent: true }); } catch {}
          try { await FileSystem.deleteAsync(`${CANONICAL_DB_PATH}-shm`, { idempotent: true }); } catch {}
        } catch (e: any) {
          console.warn('[Restore] Local file restore failed, leaving existing DB intact:', e);
          // If restore fails, do not delete existing DB. Surface error to user.
          throw e;
        }
        
        // Reload immediately to prevent "Access to closed resource" errors
        console.log('[Restore] Reloading app immediately...');
        await reloadApp();
      } catch (e: any) {
        console.warn('[Restore] failed:', e);
        // Attempt to roll back from the pre-restore snapshot if available
        if (preRestoreSnapshot) {
          try {
            console.log('[Restore] Attempting rollback from pre-restore snapshot:', preRestoreSnapshot);
            // Recompute canonical path (best-effort) to copy snapshot back
            const DOC_DIR = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
            const SQLITE_DIR = `${DOC_DIR}SQLite/`;
            let targetPath: string;
            try {
              const current = await resolveDatabasePath();
              targetPath = current.endsWith('.db') ? current : `${current}.db`;
            } catch {
              // Fallback to canonical path when resolve fails
              targetPath = `${SQLITE_DIR}debitmanager.db`;
            }
            // Copy snapshot back into place
            const tmp = `${targetPath}.rollback.tmp`;
            await FileSystem.copyAsync({ from: preRestoreSnapshot, to: tmp });
            try {
              await FileSystem.moveAsync({ from: tmp, to: targetPath });
            } catch {
              await FileSystem.copyAsync({ from: tmp, to: targetPath });
              await FileSystem.deleteAsync(tmp, { idempotent: true });
            }
            console.log('[Restore] Rollback complete, reloading app...');
            await reloadApp();
            Alert.alert('Restore failed', 'Restore failed but pre-restore snapshot was restored.');
            return;
          } catch (error_) {
            console.warn('[Restore] rollback from snapshot failed:', error_);
            Alert.alert('Restore failed', `Restore failed and rollback also failed: ${String(error_)}`);
          }
        } else {
          Alert.alert('Restore failed', e?.message ?? 'Unknown error');
        }
        setIsRestoring(false);
      }
    };

    // Prepare sorted lists for rendering: newest first
    const sortedDriveBackups = [...driveBackups].sort((a, b) => {
      const ta = a?.createdTime ? new Date(a.createdTime).getTime() : 0;
      const tb = b?.createdTime ? new Date(b.createdTime).getTime() : 0;
      return tb - ta;
    });

    const sortedLocalBackups = [...localBackups].sort((a, b) => {
      const ta = a?.modificationTime ? (a.modificationTime * 1000) : 0;
      const tb = b?.modificationTime ? (b.modificationTime * 1000) : 0;
      return tb - ta;
    });

    return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await loadBackups();
            setRefreshing(false);
          }}
          colors={["#3b82f6"]}
        />
      }
    >
      {initializing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Initializing...</Text>
        </View>
      ) : <></>}
      {isRestoring ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Restoring backup...</Text>
          <Text style={[styles.loadingText, { fontSize: 14, marginTop: 8 }]}>
            App will reload automatically
          </Text>
        </View>
      ) : <></> }

      {(!initializing) && (!isRestoring)  ? (
        <>
          {/* Google Drive Sign In/Out Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              <Ionicons name="logo-google" size={18} /> Google Drive
            </Text>
            {isSignedIn ? (
              <>
                <Text style={styles.infoText}>
                  ✓ Connected to Google Drive
                </Text>
                <Text style={styles.userEmail}>
                  {user?.email || 'Unknown'}
                </Text>
                <TouchableOpacity
                  style={[styles.actionButton, styles.signOutButton]}
                  onPress={handleSignOut}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="log-out-outline" size={20} color="#fff" />
                      <Text style={styles.actionButtonText}>Sign Out</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.infoText}>
                  Sign in to backup your data to Google Drive and access backups from any device.
                </Text>
                <TouchableOpacity
                  style={[styles.actionButton, styles.signInButton]}
                  onPress={handleSignIn}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="logo-google" size={20} color="#fff" />
                      <Text style={styles.actionButtonText}>Sign In with Google</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Last Backup Info */}
          {lastBackup && (
            <View style={styles.infoCard}>
              <Ionicons name="time-outline" size={20} color="#6b7280" />
              <Text style={styles.infoText}>
                Last backup: {formatRelativeTime(lastBackup)}
              </Text>
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.actionButton, styles.backupButton]}
              onPress={handleBackupNow}
              disabled={loading || isRestoring}
            >
              <Ionicons name="cloud-upload-outline" size={24} color="#fff" />
              <Text style={styles.actionButtonText}>Backup Now</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, styles.restoreButton]}
              onPress={handleRestoreBackup}
              disabled={loading || isRestoring}
            >
              <Ionicons name="cloud-download-outline" size={24} color="#fff" />
              <Text style={styles.actionButtonText}>Restore</Text>
            </TouchableOpacity>
          </View>

      {/* Google Drive Backups */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          <Ionicons name="cloud-outline" size={18} /> Google Drive Backups ({driveBackups.length})
        </Text>
        {loading ? (
          <ActivityIndicator style={styles.loader} />
        ) : <></>}
        {!loading && driveBackups.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="cloud-offline-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyText}>
              {isSignedIn ? 'No backups in Google Drive yet' : 'Sign in to Google Drive to see backups'}
            </Text>
          </View>
        ) : (
          <>
            {sortedDriveBackups.slice(0, 3).map((item) => (
              <View key={item.id} style={styles.backupCard}>
                <View style={styles.backupHeader}>
                  <Ionicons name="cloud-done-outline" size={20} color="#10b981" />
                  <Text style={styles.backupName}>{item.name}</Text>
                </View>
                <Text style={styles.backupMeta}>
                  📅 {item.createdTime ? new Date(item.createdTime).toLocaleString() : '-'}
                </Text>
              </View>
            ))}
            {sortedDriveBackups.length > 3 && (
              <TouchableOpacity style={styles.showMoreButton} onPress={() => { setModalType('drive'); setModalVisible(true); }}>
                <Text style={styles.showMoreText}>{`Show older backups (${sortedDriveBackups.length - 3})`}</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

      {/* Local Backups */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          <Ionicons name="phone-portrait-outline" size={18} /> Local Backups ({localBackups.length})
        </Text>
        {loading ? (
          <ActivityIndicator style={styles.loader} />
        ) :<></>}
        {!loading && localBackups.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="folder-open-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyText}>No local backups found</Text>
          </View>
        ) : (
          <>
            {sortedLocalBackups.slice(0, 3).map((item) => (
              <View key={item.name} style={styles.backupCard}>
                <View style={styles.backupHeader}>
                  <Ionicons name="document-outline" size={20} color="#6b7280" />
                  <Text style={styles.backupName}>{item.name}</Text>
                </View>
                <Text style={styles.backupMeta}>
                  💾 {(item.size / 1024).toFixed(1)} KB • {item.modificationTime ? new Date(item.modificationTime * 1000).toLocaleString() : '-'}
                </Text>
              </View>
            ))}
            {sortedLocalBackups.length > 3 && (
              <TouchableOpacity style={styles.showMoreButton} onPress={() => { setModalType('local'); setModalVisible(true); }}>
                <Text style={styles.showMoreText}>{`Show older backups (${sortedLocalBackups.length - 3})`}</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>

      {/* SQLite Directory (Advanced) */}
      <TouchableOpacity
        style={styles.advancedSection}
        onPress={() => Alert.alert('SQLite Files', sqliteFiles.join('\n') || 'No files found')}
      >
        <Text style={styles.advancedText}>
          <Ionicons name="folder-outline" size={16} /> View SQLite Directory ({sqliteFiles.length} files)
        </Text>
        <Ionicons name="chevron-forward-outline" size={20} color="#9ca3af" />
      </TouchableOpacity>

      {error && (
        <View style={styles.errorCard}>
          <Ionicons name="alert-circle-outline" size={20} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          💡 Tip: Sign in above to enable cloud backups
        </Text>
      </View>
        </>
      ):<></>}

      {/* Backups modal (shows full list when user requests older backups) */}
      <BackupsModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        type={modalType}
        driveItems={sortedDriveBackups}
        localItems={sortedLocalBackups}
      />
    </ScrollView>
  );
}

// Modal component rendered outside main return for clarity
function BackupsModal(props: Readonly<{
  visible: boolean;
  onClose: () => void;
  type: 'drive' | 'local' | null;
  driveItems: any[];
  localItems: any[];
}>) {
  const { visible, onClose, type, driveItems, localItems } = props;
  const items = type === 'drive' ? driveItems : localItems;

  const [mounted, setMounted] = useState(visible);
  const overlayAnim = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const contentAnim = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.parallel([
        Animated.timing(overlayAnim, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(contentAnim, { toValue: 1, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(contentAnim, { toValue: 0, duration: 160, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(overlayAnim, { toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]).start(() => setMounted(false));
    }
  }, [visible, overlayAnim, contentAnim]);

  const overlayStyle = { opacity: overlayAnim };
  const contentScale = contentAnim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });
  const contentStyle = { opacity: contentAnim, transform: [{ scale: contentScale }] };

  if (!mounted) return null;

  return (
    <Modal visible={mounted} animationType="none" transparent={true} onRequestClose={onClose}>
      <Animated.View style={[styles.modalOverlay, overlayStyle]}>
        <Animated.View style={[styles.modalContent, contentStyle]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{type === 'drive' ? 'Google Drive Backups' : 'Local Backups'}</Text>
            <TouchableOpacity onPress={onClose} style={styles.modalCloseButton}>
              <Ionicons name="close" size={18} color="#9ca3af" />
            </TouchableOpacity>
          </View>
          <View style={styles.modalDivider} />
          <ScrollView style={styles.modalList}>
            {items.length === 0 ? (
              <View style={styles.modalEmpty}>
                <Text style={styles.emptyText}>No backups found</Text>
              </View>
            ) : (
              items.map((item: any) => {
                const displayDate = item.createdTime
                  ? new Date(item.createdTime).toLocaleString()
                  : item.modificationTime
                  ? new Date(item.modificationTime * 1000).toLocaleString()
                  : '-';
                return (
                  <View key={item.id ?? item.name} style={styles.modalItem}>
                    <View style={styles.modalItemRow}>
                      <Text style={styles.modalItemName} numberOfLines={1} ellipsizeMode="tail">{item.name}</Text>
                      <Text style={styles.modalItemMeta}>{displayDate}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1d21',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#1a1d21',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#9ca3af',
  },
  header: {
    backgroundColor: '#25292e',
    padding: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#f9fafb',
    marginTop: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 4,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#25292e',
    padding: 12,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  infoText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#d1d5db',
    lineHeight: 20,
  },
  userEmail: {
    fontSize: 14,
    color: '#60a5fa',
    fontWeight: '500',
    marginBottom: 12,
  },
  actionButtons: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginTop: 16,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  backupButton: {
    backgroundColor: '#3b82f6',
  },
  restoreButton: {
    backgroundColor: '#10b981',
  },
  signInButton: {
    backgroundColor: '#3b82f6',
    marginTop: 12,
  },
  signOutButton: {
    backgroundColor: '#ef4444',
    marginTop: 12,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  section: {
    backgroundColor: '#25292e',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f9fafb',
    marginBottom: 12,
  },
  frequencyButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  frequencyButton: {
    backgroundColor: '#1a1d21',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#374151',
  },
  frequencyButtonActive: {
    backgroundColor: '#3b82f6',
    borderColor: '#60a5fa',
  },
  frequencyButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#d1d5db',
  },
  frequencyButtonTextActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
  loader: {
    marginVertical: 16,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  backupCard: {
    backgroundColor: '#1a1d21',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#374151',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  backupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  backupName: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '500',
    color: '#f9fafb',
    flex: 1,
  },
  backupMeta: {
    fontSize: 12,
    color: '#9ca3af',
    marginLeft: 28,
  },
  advancedSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#25292e',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  advancedText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  listContainer: {
    // Show approximately 3 backup cards, allow internal scrolling for older items
    maxHeight: 220,
    marginTop: 8,
  },
  listScroll: {
    paddingRight: 8,
  },
  showMoreButton: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  showMoreText: {
    color: '#2563eb',
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    width: '100%',
    maxHeight: '80%',
    backgroundColor: '#25292e',
    borderRadius: 12,
    padding: 16,
  },
  modalHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 4,
    backgroundColor: '#374151',
    marginBottom: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalDivider: {
    height: 1,
    backgroundColor: '#374151',
    marginTop: 12,
  },
  modalList: {
    marginTop: 8,
  },
  modalEmpty: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  modalItemRow: {
    flexDirection: 'column',
  },
  modalItemName: {
    fontSize: 14,
    color: '#f9fafb',
    fontWeight: '600',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f9fafb',
  },
  modalCloseButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  modalItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  modalItemMeta: {
    color: '#9ca3af',
    marginTop: 4,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7f1d1d',
    padding: 12,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#991b1b',
  },
  errorText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#fca5a5',
    flex: 1,
  },
  footer: {
    padding: 20,
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 32,
  },
  footerText: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
