
## 2026-03-06 — Zero-Friction UI Overhaul (Tables + Order Builder)
- **brand** color → #3B82F6 (vibrant blue, was navy); **accent** → #10B981 (emerald for pay)
- **touch-btn** → min 60px (was 48px), per Zero-Friction mandate
- **Tables page**: glassmorphism header, pulsing status dots (no text labels), emerald/blue/amber card bg, bottom nav, scale-90 press, logout removed from header
- **Order Builder**: seat-based ordering workaround — global active-seat picker in sub-bar; items tagged with seat#; cart view groups by seat. Eve to build KDS seat display.
- **BottomNav** component: fixed bottom 3-tab nav (Τραπέζια / Πορτοφόλι / Ρυθμίσεις)
- **Upsell**: converted from center modal → bottom sheet (iOS pattern)
- **Πληρωμή** button: green accent pill (was plain text link)
- +/- cart buttons: 44px → w-11 h-11 (44px, full circle)
- slideUp + pulse-fast keyframes added to globals.css

## 2026-03-06 — Theme System + DeviceSettings Fix
- CSS variable theme system: Dark / Grey / Light — all vars in globals.css
- ThemeApplicator component applies .theme-grey / .theme-light class to <html>
- theme: Theme persisted in Zustand store (localStorage)
- Theme toggle: 🌙/🌫/☀️ cycle button in tables header
- Settings page: 3-pill theme selector + logout button added
- All screens (tables, order, settings, BottomNav) use var(--c-*) for bg/text/border
- Status card backgrounds theme-aware (dark emerald/blue/amber → pastel on light theme)
- DeviceSettings: Web Apps (EL Waiter, KDS, Kiosk) moved OUT of PIN-locked Technician Tools — now always-visible top-level section

## 2026-03-06 — Table Bump/Move Auth + TableMoveRequest type
- tables/page.tsx: waiter can request table move via ⇄ button on occupied tables
  - submitMoveRequest() inserts into Supabase table_move_requests
  - subscribeToApproval() listens realtime; approved → Dexie update; denied → red overlay
  - Amber overlay while pending, destination picker bottom sheet
- supabase.ts: TableMoveRequest interface added

## 2026-03-06 — Bill Request Button + Kitchen Status Badges
- tables/page.tsx: 💳 button on occupied tables, amber pending badge, green/grey resolution flash
- Kitchen status badge per table: 🍳 amber (pending/in_progress) or ✅ green (done)
- supabase.ts: BillRequest interface

## 2026-03-06 — Order Builder: Add/Remove Items
- Cart items: −/+ qty buttons (44px, red/green tinted), trash button, seat badge pill
- removeItem() + updateItemQty() persist to IndexedDB and update order total
- Empty cart: "Κενή παραγγελία" + "← Μενού" button
- Running total visible above Αποστολή button in cart tab

## 2026-03-07 — PWA Fix: Icons + Manifest
- Generated icon-192.png + icon-512.png (dark bg, blue rounded rect, white "EW")
- manifest.json: name "EL Waiter", theme_color #3B82F6, background_color #0F0F0F
- PWA now installable via "Add to Home Screen" on iOS Safari and Android Chrome

## 2026-03-07 — Login Page: QR Scan + PIN Auth
- Added pin, role, qr_token columns to waiter_profiles (Supabase migration)
- New QRScanner component (jsqr + getUserMedia, blue overlay frame)
- Rewrote page.tsx: Device Setup QR → Login (QR or 4-digit PIN)
- deviceVenueId added to waiterStore (persisted, device-level venue binding)
- lookupWaiterByPin + lookupWaiterByQrToken added to supabase.ts
- Settings syncAll now uses deviceVenueId fallback

## 2026-03-14 — Phase 1: SQLite Offline-First Architecture
- **Goal**: Replace Dexie/IndexedDB with @capacitor-community/sqlite on native (iOS/Android)
- **Architecture**: 3-layer file split to avoid circular imports:
  - `dbTypes.ts` — all interfaces + UnifiedDb type definition
  - `dexieDb.ts` — pure Dexie class (web fallback + migration source)
  - `sqliteDb.ts` — SQLite adapter (native) + Dexie adapter (web) + migration logic
  - `waiterDb.ts` — thin re-export layer, backward-compatible (same exports as before)
- **Runtime detection**: `Capacitor.isNativePlatform()` — SQLite on native, Dexie on web
- **SQLite schema**: 7 tables mirroring Dexie stores + indexes + _migrations tracking
- **One-time migration**: `migrateDexieToSQLite()` moves all data from IndexedDB to SQLite on first native boot
- **DbInitializer component**: calls `initDb()` at app startup (added to layout.tsx)
- **Capacitor config**: added CapacitorSQLite plugin config
- **Zero breaking changes**: all existing imports (`waiterDb`, `getOpenOrder`, `calcTotal`, `getWaiterOrders`, types) work unchanged
- **Pre-existing build issue**: Viva edge routes fail during `next build` without Supabase env vars (not related)

## 2026-03-14 — Phase 2: FCM Push Notifications
- **Goal**: Enable server-to-device push via Firebase Cloud Messaging (Capacitor wrapper)
- **New files**:
  - `src/lib/fcm.ts` — `initPushNotifications()`, `registerDeviceToken()`, `onNotificationReceived()`, `onNotificationTapped()`, `getFcmToken()`
  - `src/components/PushNotificationHandler.tsx` — layout-level component: inits FCM on mount, upserts token on waiter login, shows in-app alert on foreground push, navigates on background tap
- **Supabase migration** (`oiizzbiwxghmscvpjtbl`): `waiter_devices` table (venue_id, waiter_id, fcm_token, platform, device_name, last_seen) with RLS + anon policies
- **Layout**: PushNotificationHandler added to layout.tsx alongside DbInitializer
- **Platform guard**: all FCM code is no-op on web (Capacitor.isNativePlatform() check)
- **Remaining manual steps**: Add `google-services.json` (Android) and `GoogleService-Info.plist` (iOS) from Firebase Console
- **Next**: Phase 3 server-side push sender (when bill_request INSERT, query waiter_devices, send FCM via Firebase Admin SDK)

## 2026-03-14 — Phase 3: Sync Hardening
- **Goal**: Make the sync queue robust — backoff, dead letter queue, conflict resolution
- **New file**: `src/lib/syncEngine.ts`
  - `drainSyncQueue(db, supabase)` — batch drain (up to 10 items/cycle) with per-item error handling
  - `getRetryDelay(retries)` — exponential backoff: 15s / 30s / 60s / 120s / 300s max
  - `moveToDead(db, item, error)` — after 10 failed retries, moves item to `failedQueue`
  - `resetBackoff()` / `bumpBackoff()` / `getCurrentBackoffMs()` — in-memory backoff state
  - **Conflict resolution**:
    - Table status updates: server wins (compares `updated_at`)
    - Open orders: client wins (waiter's device is source of truth for unsynced orders)
    - Paid/cancelled orders: server wins (fiscal receipt is authoritative)
- **Updated**: `ConnectivityMonitor.tsx`
  - 15s fixed polling for queue count (unchanged)
  - Drain cycle uses exponential backoff timer (separate from count poll)
  - On `online` event: resets backoff, triggers immediate drain
  - Tracks `lastSyncedAt`, `failedSyncs` in store
  - Guard against concurrent drains via `isDrainingRef`
- **New DB table**: `failed_queue` (dead letter queue) in both SQLite + Dexie (v3 schema)
- **New type**: `DbFailedSyncItem` in `dbTypes.ts`
- **Store additions**: `failedSyncs`, `lastSyncedAt`, `setFailedSyncs()`, `setLastSyncedAt()`
- **UI**: Tables page shows failed count badge (red) + last sync time; Settings page shows dead queue count + sync timestamp
- **tsc --noEmit**: clean pass. `next build` fails on pre-existing Viva edge route issue (unrelated)
