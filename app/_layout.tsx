import { getSQLiteProvider, logDbStatus, migrateDbIfNeeded, notifyProviderRemounted, registerSQLiteProviderRemount } from "@/database/db";
import * as FileSystem from 'expo-file-system/legacy';
import { Stack } from "expo-router";
import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
const SQLiteProvider: any = getSQLiteProvider();

// Context for triggering DB provider remount
const DBRefreshContext = createContext<{ refreshDb: () => void }>({ refreshDb: () => {} });
export const useDBRefresh = () => useContext(DBRefreshContext);

// Loading fallback component
function LoadingFallback() {
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#0a7ea4" />
      <Text style={styles.loadingText}>Loading database...</Text>
    </View>
  );
}

function ProviderWithLogs({ children }: Readonly<{ children: React.ReactNode }>) {
  useEffect(() => {
    console.log('[DB] SQLiteProvider mounted (DB opening)');
    // Register remount callback so non-React modules can request a provider refresh
    registerSQLiteProviderRemount(() => {
      // bumping the key from here requires access to the RootLayout state; instead
      // we use a mounted callback exposed via context. For now log the request.
      console.log('[DB] registerSQLiteProviderRemount: remount requested');
    });
    return () => {
      console.log('[DB] SQLiteProvider unmounted (DB closing)');
    };
  }, []);

  return (
    <SQLiteProvider
      databaseName="debitmanager.db"
      useSuspense
      onInit={async (db: any) => {
        console.log('[DB] onInit begin');
        await logDbStatus(db, 'before-migrate');
        await migrateDbIfNeeded(db);
        await logDbStatus(db, 'after-migrate');
        console.log('[DB] onInit complete');
        try {
          notifyProviderRemounted(true);
        } catch (e) {
          console.warn('[DB] notifyProviderRemounted failed:', e);
        }
      }}
    >
      {children}
    </SQLiteProvider>
  );
}

export default function RootLayout() {
  const [dbKey, setDbKey] = useState(0);
  const [migrationDone, setMigrationDone] = useState(false);
  
  const refreshDb = useCallback(() => {
    console.log('[DB] Manual refresh triggered, remounting provider...');
    setDbKey(prev => prev + 1);
  }, []);

  // Register remount with database module so modules can request a refresh
  useEffect(() => {
    registerSQLiteProviderRemount(() => {
      console.log('[DB] registerSQLiteProviderRemount -> invoking refreshDb');
      refreshDb();
    });
  }, [refreshDb]);

  // One-time migration: if a bare `debitmanager` file exists and `debitmanager.db` does not,
  // rename/move the bare file to the canonical `.db` filename. Also move WAL/SHM if present.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
  const DOC_DIR = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
        const SQLITE_DIR = `${DOC_DIR}SQLite/`;
        const bare = `${SQLITE_DIR}debitmanager`;
        const canonical = `${SQLITE_DIR}debitmanager.db`;

        const bareInfo = await FileSystem.getInfoAsync(bare).catch(() => ({ exists: false }));
        const canonicalInfo = await FileSystem.getInfoAsync(canonical).catch(() => ({ exists: false }));

        if (bareInfo.exists && !canonicalInfo.exists) {
          console.log('[DB:MIGRATE] Found bare DB and no canonical .db - migrating to debitmanager.db');
          try {
            await FileSystem.moveAsync({ from: bare, to: canonical });
            console.log('[DB:MIGRATE] moved', bare, '->', canonical);
          } catch (e) {
            console.warn('[DB:MIGRATE] failed to move main file, attempting copy+delete fallback', e);
            try {
              await FileSystem.copyAsync({ from: bare, to: canonical });
              await FileSystem.deleteAsync(bare, { idempotent: true });
              console.log('[DB:MIGRATE] copy+delete fallback succeeded');
            } catch (e2) {
              console.warn('[DB:MIGRATE] copy+delete fallback failed:', e2);
            }
          }

          // Move WAL/SHM files if present
          for (const suffix of ['-wal', '-shm']) {
            const from = `${bare}${suffix}`;
            const to = `${canonical}${suffix}`;
            const info = await FileSystem.getInfoAsync(from).catch(() => ({ exists: false }));
            if (info.exists) {
              try {
                await FileSystem.moveAsync({ from, to });
                console.log('[DB:MIGRATE] moved', from, '->', to);
              } catch (e) {
                console.warn('[DB:MIGRATE] failed to move', from, '->', to, e);
                try {
                  await FileSystem.copyAsync({ from, to });
                  await FileSystem.deleteAsync(from, { idempotent: true });
                  console.log('[DB:MIGRATE] copy+delete fallback for', from, 'succeeded');
                } catch (e2) {
                  console.warn('[DB:MIGRATE] copy+delete fallback for', from, 'failed:', e2);
                }
              }
            }
          }
        } else {
          console.log('[DB:MIGRATE] No migration needed. bare.exists=', !!bareInfo.exists, 'canonical.exists=', !!canonicalInfo.exists);
        }
      } catch (e) {
        console.warn('[DB:MIGRATE] unexpected error during DB filename migration:', e);
      } finally {
        if (mounted) setMigrationDone(true);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const contextValue = useMemo(() => ({ refreshDb }), [refreshDb]);

  if (!migrationDone) return <LoadingFallback />;

  return (
    <Suspense fallback={<LoadingFallback />}>
      <DBRefreshContext.Provider value={contextValue}>
        <ProviderWithLogs key={dbKey}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="debtor/[id]" options={{ headerShown: false }} />
          </Stack>
        </ProviderWithLogs>
      </DBRefreshContext.Provider>
    </Suspense>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#25292e',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#fff',
  },
});
