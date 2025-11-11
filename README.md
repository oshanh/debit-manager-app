# Debit Manager

Debtor-tracking mobile app built with Expo / React Native and TypeScript. The app records debtors, IN/OUT payments, and provides backup/restore capabilities.


---

## Quick links

- Project entry: `app/_layout.tsx` (root SQLite provider and app context)
- Tabs layout: `app/(tabs)/_layout.tsx`
- Home / statistics: `app/(tabs)/index.tsx`
- Debtor list: `app/(tabs)/debtors.tsx`
- Backup tooling: `utils/backupV2.ts`
- Core DB helpers: `database/db.ts` (+ platform proxies `db.native.ts`, `db.web.ts`)
- Business logic / data access: `database/debtorService.ts`, `database/useDebtors.ts`

---

## Requirements

- Node.js 18+ (LTS recommended), npm or yarn
- Expo CLI (or use `npx expo`)
- For native builds: Android Studio (Android SDK) and Xcode (macOS) as usual

Note: The project targets the Expo-managed workflow. If you eject to bare workflow, run native pod steps on macOS.

---
