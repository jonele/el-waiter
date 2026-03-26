# Handoff: Joey v2.12.0 — Next Session Fixes

## Resume Phrase
"Fix Joey v2.12.0 — anchor grid top-left, show totals on floor plan, fix extras on price list menu"

## Working Directory
`/Volumes/1stJE/GitHub/el-waiter/` (SSD — NOT Desktop, iCloud corrupts files)

## Build Command
```bash
cd /Volumes/1stJE/GitHub/el-waiter
rm -rf .next out && npm run build:cap && npx cap sync android
# Then in Android Studio: Clean → Run
```

---

## Bug 1: Floor plan grid not anchored top-left

**File:** `src/app/tables/page.tsx`
**Symptom:** Table grid floats in center of PinchZoomContainer — should start at top-left
**Look for:** The PinchZoomContainer or grid wrapper that has `justify-center` or `items-center`
**Fix:** Change to `justify-start items-start` or add `align-items: flex-start; justify-content: flex-start` on the grid container

## Bug 2: Floor plan tables missing order total + waiter name

**File:** `src/app/tables/page.tsx` (~line 1446-1488)
**Symptom:** Grid view shows table name + capacity but NOT the order total or waiter name. List view shows it fine.
**Data available:** `orderTotals[t.id]` has the total, `kitchenStatus[t.name]` has status. Need waiter name from `kitchen_orders` or local orders.
**Fix:** In the table card render (grid view), after the capacity span, add:
- Order total if `orderTotals[t.id]` exists (already there but might be hidden)
- Waiter name from the local order: need to build a `tableWaiterMap` from `localOrders`

## Bug 3: Extras/modifiers disappeared on price list menu

**File:** `src/app/order/page.tsx` (~line 177-200)
**Symptom:** When switching to "Bistro Menu" via dropdown, EXTRAS buttons are grayed out / don't show modifier popup
**Root cause:** Category ID mismatch between `pos_menu_categories` (price list) and `menu_categories` (modifier mappings)
**Fix attempted (may have bug):** Line ~177-200 remaps by category name — fetch `menu_categories`, match names to `pos_menu_categories`, copy modifier group IDs. Check:
1. Is the `menu_categories` fetch completing? (add console.log)
2. Are names matching exactly? (case-sensitive, trim whitespace)
3. Does `getItemModGroups(item)` return groups after remapping?
4. The `activeCats` variable must be populated BEFORE the remap runs

**Debug approach:** Add `console.log("catMap after remap:", JSON.stringify(catMap))` after the remap block and check in Chrome DevTools (inspect via `chrome://inspect` while device is USB-connected)

---

## What Was Built Today (March 25-26, 2026)

### Database (Supabase: oxyycdgbvmesuadtmcjd)
- Migration 006: `pricelist_id` on cashier_profiles, nullable pos_ids, anon RLS
- Migration 007: Fixed `copy_menu_to_pricelist` RPC (uses pos_menu_products first) — **NEEDS RUN**
- Migration 008: Variations + print groups + printers tables — **NEEDS RUN**
- Manually inserted 176 price list items for "Bistro Menu" with real prices

### Backend (ELOYAL.APP → Render)
- 7 price list CRUD endpoints
- 17 variation/printer/print group endpoints
- `pricelist_id` in CashierProfile create/update/duplicate
- Fixed `description` column bug in price list create

### Admin UI (ELOYAL.APP → Vercel)
- `PriceList.js` — 3-panel price list management page
- `MenuConfig.js` — 3-tab variations + print groups + printers page
- `DeviceSettings.js` — pricelist dropdown in profile modal, QR codes on downloads, version bumps
- Excel/XLSX upload support + template download
- Field mapping fix (rest_price → price_dinein)

### Joey (el-waiter)
- Price list support: conditional menu fetch, waiter dropdown
- `pricelist_id` in CashierProfile type + SELECT query
- `fetchVenuePriceLists()` + `fetchPriceListMenu()` functions
- Non-blocking `sendToKitchen()` with toast feedback
- KDS → Waiter realtime: kitchen_orders status listener + READY/FIRE badges
- Modifier category ID remapping (needs verification)
- WebView cache clearing in MainActivity.java
- Camera permission in AndroidManifest + WebView permission grant
- Push notification stubs (plugin removed)
- Joey icons for all mipmap densities
- Network security config for LAN printers
- v2.12.0 version strings everywhere

### Routes
| Path | Component |
|------|-----------|
| `/admin/pricelists` | PriceList.js |
| `/manager/pricelists` | PriceList.js |
| `/admin/menu-config` | MenuConfig.js |
| `/manager/menu-config` | MenuConfig.js |

---

## Pending Items

| Item | Priority | Notes |
|------|----------|-------|
| Run migration 007 (fix RPC) | HIGH | Paste SQL in Supabase Editor |
| Run migration 008 (variations/printers) | HIGH | Paste SQL in Supabase Editor |
| Fix 3 bugs above | HIGH | Grid anchor, totals, extras |
| OTA update system | MEDIUM | Version check endpoint + "Update available" banner |
| APK upload automation to Supabase Storage | MEDIUM | Need service_role key or bucket policy |
| CORS for Joey payment | MEDIUM | Add Joey origins to Render CORS_ORIGINS |
| Audit migration conflicts | MEDIUM | Two Chandler sessions ran migrations |
| 8.6 fiscal receipt flow | LOW | Needs Bridge running on LAN |
| Kitchen TCP printing | LOW | Needs printer on LAN |
| Print group category assignment UI | LOW | MenuConfig.js has the UI, needs testing |

---

## Key File Locations

| What | Where |
|------|-------|
| Joey repo (SSD) | `/Volumes/1stJE/GitHub/el-waiter/` |
| Order page | `src/app/order/page.tsx` |
| Tables page | `src/app/tables/page.tsx` |
| Supabase functions | `src/lib/supabase.ts` |
| Types | `src/lib/dbTypes.ts` |
| Waiter store | `src/store/waiterStore.ts` |
| Android manifest | `android/app/src/main/AndroidManifest.xml` |
| MainActivity | `android/app/src/main/java/com/elvalue/joey/MainActivity.java` |
| EL-Loyal backend | `~/GitHub/ELOYAL.APP/backend/server_supabase.py` |
| PriceList admin | `~/GitHub/ELOYAL.APP/frontend/src/pages/manager/PriceList.js` |
| MenuConfig admin | `~/GitHub/ELOYAL.APP/frontend/src/pages/manager/MenuConfig.js` |
| Migrations | `~/GitHub/el-pos/cloud/migrations/` |
