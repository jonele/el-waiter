# Joey Native Build Handoff — Bundled Android + iOS with Full Native Capabilities

## Resume Phrase
"Continue from Joey native build handoff — bundled static export with SQLite + TCP printing"

## Context
Joey (EL-Waiter) currently loads from Vercel via remote URL in the Capacitor shell. This means:
- ❌ No native SQLite (uses IndexedDB/Dexie only)
- ❌ No TCP printing (can't reach capacitor-tcp-socket plugin)
- ❌ No true offline (needs internet to load)
- ✅ Camera works (WebView permission)
- ✅ Easy updates (push to Vercel = instant update)

**Goal:** Bundle the web code locally in the APK so ALL native plugins work.

## Architecture: Bundled Native App

```
CURRENT (remote):                    TARGET (bundled):
┌─────────────────────┐             ┌─────────────────────┐
│ Capacitor Shell     │             │ Capacitor Shell     │
│   ↓ loads from      │             │   ↓ loads from      │
│ el-waiter.vercel.app│             │ /android/app/assets/│
│   ↓                 │             │   (bundled static)  │
│ WebView (remote)    │             │   ↓                 │
│   ❌ No native API  │             │ WebView (local)     │
└─────────────────────┘             │   ✅ SQLite plugin  │
                                    │   ✅ TCP socket     │
                                    │   ✅ Full offline    │
                                    │   ↓ API calls to    │
                                    │ el-waiter.vercel.app│
                                    │   (only for server  │
                                    │    endpoints)       │
                                    └─────────────────────┘
```

## Step-by-Step Build Plan

### Phase 1: Static Export (Next.js → out/)

The app uses API routes (`/api/rsrv/*`, `/api/viva/*`) that can't be statically exported.
These must stay on Vercel as serverless functions. The client code calls them via full URL.

**Changes needed:**

1. **Add API_BASE_URL constant** to all fetch calls in client code:
   ```typescript
   const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://el-waiter.vercel.app";
   ```
   All `/api/...` calls become `${API_BASE}/api/...`

2. **Files to update** (replace relative `/api/` with `${API_BASE}/api/`):
   - `src/app/tables/page.tsx` — RSRV reservation fetch, waitlist, check-in
   - `src/app/order/page.tsx` — (none currently, all client-side)
   - `src/app/pay/page.tsx` — Viva charge, status poll
   - `src/app/pay/callback/page.tsx` — fiscal receipt
   - `src/app/page.tsx` — sibling venue fetch (uses Supabase directly, OK)
   - `src/app/api/rsrv/lookup/route.ts` — stays on Vercel (server-only)
   - `src/app/api/rsrv/reservations/route.ts` — stays on Vercel
   - `src/app/api/viva/*` — stays on Vercel

3. **next.config.ts** — static export when building for Capacitor:
   ```typescript
   const isStatic = process.env.NEXT_PUBLIC_CAP === "1";
   ...(isStatic ? { output: "export", distDir: "out" } : {})
   ```

4. **Build command:**
   ```bash
   NEXT_PUBLIC_CAP=1 NEXT_PUBLIC_API_BASE=https://el-waiter.vercel.app npx next build
   ```

5. **capacitor.config.ts** — point to local `out/` instead of Vercel URL:
   ```typescript
   webDir: "out",
   server: {
     // NO url — loads locally
     cleartext: true,
     androidScheme: "https",
   },
   ```

### Phase 2: Native SQLite Integration

The app already has `@capacitor-community/sqlite` installed. The `waiterDb.ts` has a
unified interface that routes to SQLite on native and Dexie on web.

**Check:** Read `src/lib/sqliteDb.ts` — it should already detect Capacitor native platform
and use SQLite. The static bundle will activate this path automatically.

### Phase 3: Native TCP Printing

`src/lib/nativePrinter.ts` already has the full ESC/POS formatter + TCP socket code.
It uses dynamic import: `const mod = await import("capacitor-tcp-socket")`.

**This will work automatically** when running from a local bundle because the native
plugin bridge is only available when code runs locally (not from remote URL).

**Printer map:** Kitchen printer IPs come from `venueConfig.kitchen_printers[]`.
This is pulled from the shared `venue_device_config` table on Supabase (niceb2b project).

### Phase 4: Viva Fiscal Compliance (ΥΠΑΗΕΣ / AADE)

**CRITICAL — Greek law requirements for dine-in:**

1. **8.6 Order Slip** — MUST be issued when order is placed (before payment)
   - `ftReceiptCase: 5139205309155782660`
   - Items + VAT, no payment
   - MARK returned and stored

2. **11.1 Final Receipt** — MUST be issued when payment is made
   - `ftReceiptCase: 5139205309155770369`
   - Links to order slip via `cbPreviousReceiptReference`
   - Payment method (card/cash) included
   - MARK returned and stored

3. **ISV Fee** — 0.3% for EL-POS, check if different for Joey
   - NO VAT on ISV fees

4. **SoftPOS** — `vivapayclient://` URI launches Viva Terminal on same phone
   - ISV credentials in URI (built server-side at `/api/viva/softpos`)
   - Callback returns to `/pay/callback` with transaction params
   - AADE signature data passed in URI when fiscal is active

5. **Demo mode** — ALL Viva/fiscal paths gated by `demoMode` flag
   - Default: ON (safe for testing)
   - Must be explicitly turned OFF at venue for live mode
   - Cash payments ALWAYS work regardless of mode

**Files involved:**
- `src/app/order/page.tsx` lines 516-543 — 8.6 order slip
- `src/app/pay/page.tsx` lines 171-194 — 11.1 final receipt
- `src/app/pay/page.tsx` lines 327-355 — SoftPOS handler
- `src/app/pay/callback/page.tsx` lines 73-90 — SoftPOS callback fiscal
- `src/app/api/viva/softpos/route.ts` — builds vivapayclient:// URI
- `src/app/api/viva/charge/route.ts` — ISV cloud terminal charge
- `src/lib/nativePrinter.ts` — ESC/POS kitchen ticket formatting

**Receipt case constants (PROVEN — do not change):**
```
Start Receipt:     5139170124783173633
POS Sale (11.1):   5139205309155770369
Order Slip (8.6):  5139205309155782660
Refund (11.4):     5139205309172023297
Goods 24% VAT:     5139205309155246099
Cash payment:      5139205309155246081
Debit card:        5139205309155246084
```

### Phase 5: Android Build

```bash
cd ~/Desktop/Projects/el-waiter

# 1. Build static export
NEXT_PUBLIC_CAP=1 NEXT_PUBLIC_API_BASE=https://el-waiter.vercel.app npx next build

# 2. Sync to Android
npx cap sync android

# 3. Open in Android Studio
npx cap open android

# 4. Build → Generate Signed APK (or Run on device)
```

### Phase 6: iOS Build

```bash
# 1. Same static export as Android
NEXT_PUBLIC_CAP=1 NEXT_PUBLIC_API_BASE=https://el-waiter.vercel.app npx next build

# 2. Sync to iOS
npx cap sync ios

# 3. Open in Xcode
npx cap open ios

# 4. Set team + bundle ID (com.elvalue.joey) → Run on device
```

## Current State (as of 2026-03-24)

| Component | Status |
|-----------|--------|
| Web UI (Vercel) | ✅ Working, v2.7.0 |
| Android shell (remote URL) | ✅ Working on Xiaomi, but no native plugins |
| iOS shell | ✅ Capacitor project exists, needs Xcode build |
| Static export | ❌ Not configured yet (API routes block it) |
| SQLite (native) | ✅ Plugin installed, code exists, needs local bundle |
| TCP printing | ✅ Plugin installed, ESC/POS formatter ready, needs local bundle |
| SoftPOS | ✅ Code ready, needs live Viva credentials |
| Fiscal 8.6 | ✅ Code ready, gated by demoMode |
| Fiscal 11.1 | ✅ Code ready, gated by demoMode |
| Demo mode | ✅ All paths gated, default ON |

## Files to Modify for Bundled Build

| File | Change |
|------|--------|
| `next.config.ts` | Already handles `NEXT_PUBLIC_CAP=1` → static export |
| `capacitor.config.ts` | Change `webDir: "out"`, remove `server.url` |
| `src/app/tables/page.tsx` | Add API_BASE to fetch calls |
| `src/app/pay/page.tsx` | Add API_BASE to Viva fetch calls |
| `src/app/pay/callback/page.tsx` | Add API_BASE |
| `src/lib/supabase.ts` | Already uses env vars, OK |
| `.env.local` | Add `NEXT_PUBLIC_API_BASE=https://el-waiter.vercel.app` |

## Key Repos & Credentials

| What | Where |
|------|-------|
| Joey repo | `~/Desktop/Projects/el-waiter/` |
| EL-POS (Rachel) | `~/GitHub/el-pos/` |
| EL Bridge (Ross) | `~/GitHub/pos-firebird-ingest/` |
| Viva fiscal reference | `~/Desktop/VIVA-START-RECEIPT.md` |
| Joey avatar | `~/Desktop/el-loey_avatar.jpg` |
| QR codes | `~/Desktop/joey-barbarossa-qr.png`, `joey-niceneasy-qr.png` |
| EL-Loyal Supabase | `oxyycdgbvmesuadtmcjd` |
| RSRV Supabase | `qlvqrlfupoeysllnpxcy` |
| Viva ISV creds | env vars on Vercel (VIVA_ISV_CLIENT_ID, VIVA_ISV_CLIENT_SECRET) |
| RSRV anon key | env var on Vercel (RSRV_ANON_KEY) |

## Venue Data

**Barbarossa** (`a052b0f8-409a-4477-b4ea-70758d190ace`):
- 162 tables (all floor_section_id = null — need section assignment)
- 4 sections: Μερσινάρα, Πλατεία, Λιμανάκι, Bar
- 25 categories, 157 items
- 5 waiters: jonel/1111, Stavroula/2222, Nansy/3333, Dimos/4444, Nick/5555
- RSRV venue: `96a702cf` (59 reservations)

**Niceneasy Bistro** (`f8138c92-4e95-4cab-8172-0e75557ec14f`):
- 12 tables (B1-B7 Bar, M1-M5 Main)
- 15 categories, 174 items, 17 modifiers
- 7 waiters including jonel/2804

## Warning: Other Chandler Session
Another Chandler session rewrote the sync/profile/download logic. ALWAYS `git fetch && git log origin/main --oneline -5` before modifying to check for new commits.
