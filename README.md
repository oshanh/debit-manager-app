# debit-m1

Debtor-tracking mobile app built with Expo / React Native and TypeScript. The app records people (debtors), payments, and provides backup/restore capabilities.

This README documents how the project is organized, how to run it, and details about the defensive SQLite patterns implemented to avoid native crashes while performing backups.

---

## Quick links

- Project entry: `app/_layout.tsx` (root SQLite provider and app context)
- Tabs layout: `app/(tabs)/_layout.tsx`
- Home / statistics: `app/(tabs)/index.tsx`
- Debtor list: `app/(tabs)/debtors.tsx`
- Backup tooling: `utils/backupV2.ts`
- Core DB helpers: `database/db.ts` (+ platform proxies `db.native.ts`, `db.web.ts`)
- Business logic / data access: `database/debtorService.ts`, `database/useDebtors.ts`
- Optional in-memory logger: `database/dbLogger.ts` (disabled by default)

---

## Requirements

- Node.js 18+ (LTS recommended), npm or yarn
- Expo CLI (or use `npx expo`)
- For native builds: Android Studio (Android SDK) and Xcode (macOS) as usual

Note: The project targets the Expo-managed workflow. If you eject to bare workflow, run native pod steps on macOS.

---

## Setup (PowerShell)

```powershell
# Install dependencies
npm install

# If you use yarn
# yarn install

# Optional: iOS pods if using bare/native iOS
# npx pod-install
```

---

## Run (development)

```powershell
# Start Metro / Expo
npx expo start

# Android (device/emulator)
npx expo run:android

# iOS (simulator, macOS)
npx expo run:ios
```

Use `npm run start` / `npm run android` / `npm run ios` if the scripts are configured in `package.json`.

---

## Project structure (high-level)

- `app/` — screens and routes (expo-router).
- `database/` — core DB helpers and platform proxies.
- `utils/` — backup and helper utilities.
- `components/` — reusable UI components.

Key files:
- `database/db.ts` — refresh/waiter coordination, `closeDatabaseHandlesForBackup()`, health checks like `logDbStatus()`.
- `database/db.native.ts` / `database/db.web.ts` — platform proxies and debounce wrappers for refresh logic.
- `database/debtorService.ts` — CRUD and aggregated queries; defensive handling for DB errors.
- `utils/backupV2.ts` — backup/restore flows (calls the centralized close/checkpoint helper).

---

## Important runtime behavior & debugging notes

The app implements several defensive strategies to avoid intermittent native crashes that can occur when SQLite native handles are raced against file operations (e.g., copying the DB file during backups):

1) Provider remount coordination

- `refreshSQLiteProvider()` (returns a Promise) is a central mechanism: non-React modules call it to request the React-managed SQLiteProvider to remount (unmount → mount). The Promise resolves when the provider calls `notifyProviderRemounted(true)` after initialization completes.
- The RootLayout registers a remount callback that bumps a local key to force the provider to unmount and reinitialize.

2) Backup-safe close/checkpoint

- `closeDatabaseHandlesForBackup()` (in `database/db.ts`) attempts to open possible DB names, run `PRAGMA wal_checkpoint(TRUNCATE)`, and call `closeAsync()` on the handles where available. `utils/backupV2.ts` calls this before copying the DB file to reduce native handle races.

3) Defensive reads + retry

- Data access functions (in `database/debtorService.ts`) detect database-specific errors (NullPointerException, closed resource, NativeDatabase errors) and call `refreshSQLiteProvider()` before rethrowing or returning safe defaults.
- UI layers (statistics, debtor detail) include retry/backoff logic to reduce immediate reattempts that might find the provider still stabilizing.

When to use these tools:
- If you see logs mentioning `NativeDatabase.prepareAsync` and `NullPointerException`, reproduce with `adb logcat` and ensure backup flows call `closeDatabaseHandlesForBackup()`.

---

## Logs and debugging UI

- The repo used to include an in-app `Logs` tab backed by `database/dbLogger.ts` which intercepted console logs containing `[DB]` and displayed them. That tab has been removed from the default UI and the logger is no longer initialized by default.
- If you need to debug, you can re-enable the logger by adding `import '@/database/dbLogger';` to `app/_layout.tsx` and restoring the `Logs` tab in `app/(tabs)/_layout.tsx`.

---

## Tests and CI

- Add Jest tests under `__tests__/` to exercise data-access patterns (`debtorService`) and backup helpers.
- For CI: run `npm run lint && npm run typecheck && npm run test`.

---

## Contributing

- Use the usual fork → branch → PR flow. Keep changes small and include tests for new data-access behavior.

---

## Troubleshooting tips

- Clear caches (PowerShell):

```powershell
Remove-Item -Recurse -Force node_modules
npm install
npx expo start --clear
```

- Android emulator issues: confirm Android SDK and `ANDROID_HOME` are set and Java 17 is available.

---

## Next improvements (developer TODOs)

- Consider increasing the stabilization delay used when resolving refresh waiters (`database/db.ts`) if you still observe racing failures.
- Add a small user-facing toast when an automatic DB remount happens to reduce confusion.
- Add an integration test that simulates heavy DB writes and concurrent backups to reproduce regressions.

---

License: MIT
# debit-m1

React Native app.

## Requirements
- Node.js 18+ and npm or yarn
- JDK 17, Android Studio + SDK/NDK
- Xcode 15+ (macOS, for iOS)
- CocoaPods (macOS): sudo gem install cocoapods

## Setup
```bash
# install deps
npm i
# iOS pods (macOS)
npx pod-install
# env (optional)
cp .env.example .env
```

## Run
```bash
# start Metro
npx react-native start

# Android (device/emulator)
npx react-native run-android

# iOS (simulator, macOS)
npx react-native run-ios
```

## Scripts (suggested)
- npm run ios
- npm run android
- npm run start
- npm run test
- npm run lint
- npm run typecheck

## Testing and Quality
```bash
npm run test        # Jest
npm run lint        # ESLint
npm run typecheck   # TypeScript
```

## Build
- Android release:
   ```bash
   cd android && ./gradlew assembleRelease
   ```
- iOS archive (Xcode > Product > Archive)

## Structure (typical)
- src/
   - screens/, components/, navigation/, hooks/, services/, store/, utils/
- android/, ios/, app.json, package.json

## Environment (example)
- API_URL=
- SENTRY_DSN=
- FEATURE_FLAG_*=

## Troubleshooting
- Clear caches:
   ```bash
   rm -rf node_modules && npm i
   npx react-native start --reset-cache
   cd android && ./gradlew clean
   cd ios && pod deintegrate && pod install
   ```
- Ensure ANDROID_HOME and Java 17 are set.

## Docs
- React Native: https://reactnative.dev/docs/environment-setup

License: MIT