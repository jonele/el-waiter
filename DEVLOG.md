
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
