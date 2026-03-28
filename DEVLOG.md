
## 2026-03-28 — Joey v2.12.4: Gunther CP737 print integration

### Gunther cloud print (Supabase print_jobs)
- Added `src/lib/guntherPrint.ts` — builds CP737-encoded ESC/POS bytes and inserts `print_jobs` row to Supabase
- Gunther picks up the job within its poll interval (default 2s), routes by `printer_alias`, sends TCP to LAN printer
- `printer_alias` = cashier profile `receipt_printer_name` (must match a Gunther `pos_printers` alias)
- Hooked into `sendToKitchen()` at step 3b — fire-and-forget, never blocks order flow

### CP737 encoding fix in nativePrinter.ts
- Replaced UTF-8 `textToBytes()` with `encodeCp737()` using CP737 Greek DOS lookup table
- Changed `ESC t 0x1c` (wrong UTF-8 codepage) → `ESC t 14` (CP737, matches Gunther/EL-POS)
- Replaced `─` box-drawing separators with `=` (ASCII, safe across all codepages)
- Fixed item format: `Qx N name` → `Nx  name`
- `encodeCp737` exported from nativePrinter.ts and reused in guntherPrint.ts

## 2026-03-24 — Joey v2.8.0: Bundled Native Android Build

### Architecture Change: Remote → Bundled
- **BEFORE**: Capacitor shell loaded web UI from `el-waiter.vercel.app` (no native plugins)
- **AFTER**: Static HTML/JS bundled in APK, API routes stay on Vercel as serverless functions
- Native SQLite, TCP printing, and SoftPOS now all work (Capacitor plugin bridge accessible)

### Changes
- Created `src/lib/apiBase.ts` — shared `API_BASE` constant for all client → Vercel API calls
- Prefixed 11 fetch calls across `tables/page.tsx` (10) and `pay/page.tsx` (1) with `API_BASE`
- Updated `capacitor.config.ts` — `webDir: "out"`, removed `server.url` (loads locally)
- Created `scripts/build-cap.sh` — excludes API routes + setup route during static export, restores on exit
- Updated `package.json` scripts: `build:cap`, `cap:android`, `cap:ios`
- Fixed `setup/[venueId]/page.tsx` to use proper component wrapper (re-export pattern broke Next.js 15 static)
- Cleaned duplicate files from `public/` (macOS copy artifacts)

### Build Output
- Static export: 7 pages (3.4MB total in `out/`)
- Android sync: 4 Capacitor plugins (SQLite, SplashScreen, StatusBar, TCP Socket)
- Vercel build: all 13 API routes + 8 pages still work normally

### Next Steps
- Open in Android Studio: `npx cap open android`
- Generate signed APK → test on Xiaomi
- iOS: `npx cap sync ios && npx cap open ios` → Xcode build

## 2026-03-23 — EL-Waiter v2.5.0: Kitchen Print + Check-in + Real-time Sync

### Kitchen Printing via Bridge
- Orders now POST to Bridge LAN API on "Αποστολή στην κουζίνα"
- Creates order + triggers kitchen printer (fire-and-forget, 10s timeout)
- Modifiers sent as separate field matching EL-POS `printer.rs` format
- Bridge handles ESC/POS formatting + TCP 9100 to kitchen printer
- Fallback: order saved in Supabase + local DB if Bridge unreachable

### Real-time Table Status Sync
- Table status pushed to Supabase when order sent (occupied) and paid (free)
- All connected waiters see changes instantly via Supabase realtime subscription
- Customer name + party size shown on occupied table cards

### Reservation Check-in
- 📋 button in header opens check-in bottom sheet
- QR scanner for RSRV confirmation codes
- Manual search by name, phone, email, or confirmation code
- "Seat" button marks reservation as seated + assigns table
- New API: GET /api/rsrv/lookup (searches RSRV Supabase)

---

## 2026-03-23 — EL-Waiter v2.4.0: Production Hardening + Premium UI

### Premium RSRV-Style Table Cards
- Gradient backgrounds per status (not flat colors)
- Dual-layer shadows (outer + inset highlight)
- 1.5px thin borders, rounded-md (not thick 3px rounded-3xl)
- Status indicator dot with white ring offset
- Micro-typography hierarchy (8/10/11/13px)
- Capacity icon (users SVG) with muted text
- 3/4/5 column responsive grid
- Dark/light/beach mode aware

### Multi-Venue Picker
- QR scan → if owner has sibling venues → picker screen
- "Ποιο κατάστημα δουλεύεις σήμερα?" with table counts
- Niceneasy Bistro / Coffee venue selection working

### Item Modifier System
- pos_modifier_groups + pos_modifiers schema
- Bottom sheet when tapping items with modifiers (coffee → sweetness/milk/extras)
- Single-select (required) and multi-select groups
- Price extras calculated live, shown in cart before firing

### Table Validation + Splitting
- Keypad validates table numbers against DB
- No-match → shows ALL venue tables from Supabase
- Split tables: 108 → 108A, 108B (created in Supabase + local DB)

### Production Hardening
- ErrorBoundary: catches crashes, Greek error page + reload
- useVenueId hook: single source of truth
- Sync error toasts: red banner on failures (4s auto-dismiss)
- Service worker: checks updates every 5min, auto-reloads
- Pay page: error messages now show reason
- Removed dead BottomNav, junk config files
- RLS policies added for pos_tables + pos_floor_sections
- Aria-labels, Zustand migration, sync timeouts
- Playwright E2E: 9/9 tests passing against production

### Supabase Changes
- Created Bar + Main sections for Niceneasy Bistro
- RLS read policies on pos_tables, pos_floor_sections, pos_modifier_groups
- 17 coffee modifiers seeded (sweetness, milk, extras, temperature, size)

### UI Cleanup
- Removed bottom navigation bar (header-only navigation)
- Wallet moved inside Settings
- Search bar removed (keypad handles search)
- Default view: tables grid (not keypad)
- View toggle: # / 🍽️ Τραπέζια / Ανοιχτά

---

## 2026-03-21 — EL-Waiter v2.1.0: Beach Club Architecture

### Phase 1: "Classic Beach" Theme
- New `.theme-beach` CSS variables in `globals.css` — industrial grey bg, white surfaces, black text, thick borders
- Table cards: tinted fill + thick 3px solid border in status color (green/blue/amber)
- All buttons auto-uppercase in beach mode via CSS rule
- Theme type extended to `'dark' | 'grey' | 'light' | 'beach'`
- Updated `ThemeApplicator.tsx`, `waiterStore.ts`, `settings/page.tsx` (4-col grid), `tables/page.tsx` (cycle + icon)

### Phase 2: Lightning Navigation
- **Numeric keypad**: Floating `#` button on tables page → bottom sheet with 0-9 numpad + backspace + OK
  - `ABC` toggle switches to device keyboard for letter input (sub-tables)
  - OK fuzzy-matches input against table names (exact first, then startsWith)
- **Open Tables List**: `Χάρτης / Ανοιχτά` toggle above table grid
  - List view shows only occupied tables with total, natural sort, tap to open

### Phase 3: Takeaway Enhancement
- Takeaway button styled with amber background + "TAKE" label in beach theme
- (Core takeaway flow was already working from v2.0.1)

### Phase 4: Bug Fixes & Branding
- **Unicode fix**: Applied `decodeUnicodeEscapes()` to all category + item name renders in `order/page.tsx` and `ItemSplitPicker.tsx`
- **Table rendering**: Added "Εμφάνιση όλων" fallback button when section filter yields 0 results but tables exist
- **Branding**: Version badge bumped to v2.1.0
- **Postcard ID**: Login page shows first 8 chars of venue UUID as `📍 Venue: A3B4C5D6`
- **Build fix**: Wrapped `OrderPage` in `<Suspense>` for `useSearchParams()` (Next.js 15 requirement)

### Files Changed
- `src/app/globals.css` — `.theme-beach` block + beach uppercase utility
- `src/store/waiterStore.ts` — Theme type extended
- `src/components/ThemeApplicator.tsx` — beach class removal
- `src/app/settings/page.tsx` — 4th theme button
- `src/app/tables/page.tsx` — keypad, list view, theme cycle, branding, table fix, takeaway styling
- `src/app/order/page.tsx` — Unicode decode, Suspense boundary
- `src/app/page.tsx` — Postcard venue ID
- `src/components/ItemSplitPicker.tsx` — Unicode decode
- `package.json` — v2.1.0

---

## 2026-03-15 — EL-POS Auto-Updater Endpoint

### New API Route
- **`src/app/api/pos-update/[...params]/route.ts`**: Tauri v2 updater endpoint for EL-POS
  - `GET /api/pos-update/{target}/{arch}/{current_version}`
  - Reads latest release from `github.com/jonele/el-pos/releases/latest`
  - Compares semver — returns 204 (up to date) or 200 with download URL + version JSON
  - 5-minute in-memory cache for GitHub API responses to avoid rate limits
  - Download URL points to `el-os-downloads` repo raw file

## 2026-03-14 — Split / Partial Payments UI

### New Components
- **`src/components/SplitModeSelector.tsx`**: 4-mode segmented control — Ολόκληρο / Κατ' Είδος / Ισόποσο / Ποσό. Tailwind, 60px touch, brand blue active state.
- **`src/components/ItemSplitPicker.tsx`**: Checkbox list of unpaid order items with running subtotal. Already-paid items shown dimmed with strikethrough. Select all/none buttons. Confirm fires with selected item IDs + subtotal.
- **`src/components/EqualSplitPicker.tsx`**: N-way split (2-6 people). Per-person amount with rounding handler (last person pays remainder). Progress bar for multi-round splits.

### Modified Files
- **`src/app/pay/page.tsx`**: Full rewrite for split payment flow:
  - SplitModeSelector shown before payment method selection
  - Item split: checkboxes for items, confirm sets split amount
  - Equal split: N-picker, per-person amount with rounding
  - Custom: freeform euro amount input with max validation
  - Multi-round payment loop: after payment, if remaining > 0, stay on page for next split
  - Paid splits progress bar (emerald) + split payment history
  - Each split fires Viva ISV charge for split amount only
  - Success screen: shows all split payments, remaining balance, "Επόμενη πληρωμή" button
  - Table closes only when remaining = 0

### Design
- Tailwind CSS only (no inline styles)
- 60px min touch targets, dark theme (bg-slate-950/900)
- Brand blue (#3B82F6) for selections, emerald (#10B981) for pay/success
- All Greek labels

---

## 2026-03-14 — Shared Venue Config — Pull from POS

### New Files
- **`src/lib/venueConfig.ts`**: Creates a niceb2b Supabase client (`oiizzbiwxghmscvpjtbl`) and exports `pullVenueConfig(venueId)` — queries `venue_device_config` WHERE config_type='pos_master'. Returns printer IPs, fiscal details, Viva merchant ID, kitchen printers. Terminal ID intentionally excluded (stays local per waiter device).

### Modified Files
- **`src/store/waiterStore.ts`**: Added `venueConfig: VenueDeviceConfig | null` + `setVenueConfig()` to zustand store. Persisted to localStorage. Cleared on logout.
- **`src/app/tables/page.tsx`**: On login (useEffect), fires `pullVenueConfig(waiter.venue_id)` — fire-and-forget, stores result in zustand. Components can now read `venueConfig` for printer IPs etc.

### Design Decisions
- Waiter inherits printer IPs, fiscal info, Viva merchant ID from POS master config
- Terminal ID (Viva TID) is NEVER inherited — stays local per device
- Any inherited setting can be overridden locally by the waiter
- Config is pulled once on login/startup, cached in zustand + localStorage

---

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

## 2026-03-28 | Fix Gunther LAN timeout race

### Built today
- Fixed `AbortSignal.timeout(2000)` → `5000` in `pushToGunther()` (guntherPrint.ts)
- Prevents duplicate prints when Gunther takes up to 3s to respond

### Key files
| File | What |
|------|------|
| `src/lib/guntherPrint.ts` | LAN timeout bumped to 5000ms |
