# Handoff: Multi-RVC Price List Architecture for Joey (EL-Waiter)

## Resume Phrase
"Build multi-RVC price list architecture — admin manages pricelists, Joey downloads per cashier profile"

## Context

Joey (EL-Waiter) is a native Android/iOS waiter app (Next.js + Capacitor) at v2.10.0:
- Waiter PIN login, cashier profile picker, tables, full menu — all working
- **Problem:** Menu items are venue-scoped only. A venue with multiple RVCs (Coffee Bar, Bistro, Terrace) shows ALL items to ALL profiles. No way to scope items or prices per RVC.

---

## Verified Current Schema (Supabase: oxyycdgbvmesuadtmcjd)

### menu_categories (567 rows) — NO rvc_id
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| venue_id | uuid FK → venues | |
| name | text NOT NULL | Greek |
| name_en/fr/es/ar/de | text | Multi-lang |
| parent_id | uuid FK → self | Subcategories |
| sort_order | int | Default 0 |
| is_active | bool | Default true |
| color | text | Default #1E3A5F |
| orexsys_id | text | Legacy |

### menu_items (4,575 rows) — NO rvc_id
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| venue_id | uuid FK → venues | |
| category_id | uuid FK → menu_categories | |
| name | text NOT NULL | Greek |
| name_en/fr/es/ar/de | text | Multi-lang |
| description + desc_en/fr/es/ar/de | text | |
| price | numeric NOT NULL | Default 0, single base price |
| price_takeaway | numeric | Optional |
| currency | text | Default EUR |
| is_active | bool | Default true |
| is_available | bool | Default true |
| allergens | text[] | |
| dietary_tags | text[] | |
| sort_order | int | |
| orexsys_rvcsid | text | Legacy, unused |

### cashier_profiles (468 rows)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| venue_id | uuid FK → venues | |
| name | text NOT NULL | |
| rvc_id | uuid FK → revenue_centers | Nullable |
| rvc_name | text | Denormalized |
| **pricelist_name** | **text** | **Exists but just a label — no FK, no backing table** |
| viva_terminal_id/name | text | |
| fiscal_provider | text | |
| fiscal_config | jsonb | |
| printer_mappings | jsonb | |
| receipt_printer_ip/name | text | |
| order_types | jsonb | {quick, tables, delivery, bar} |
| icon, color | text | |
| active | bool | |
| sort_order | int | |

### revenue_centers (5 rows)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | uuid_generate_v4() |
| venue_id | uuid FK → venues | |
| name | text NOT NULL | |
| code | text | Short code (BISTRO, BAR) |
| active | bool | |
| settings | jsonb | Contains pos_rvcsid, synced_from_bridge |

### No existing pricelist tables
Checked: `pricelist*`, `price_list*`, `pricing*`, `menu_prices*`, `item_prices*` — none exist.

---

## Current Joey Code

### Menu fetch — `src/app/order/page.tsx:132-136`
```typescript
// Venue-scoped only — returns ALL 174 items regardless of profile
supabase.from("menu_categories").select("*").eq("venue_id", vid).eq("is_active", true)
supabase.from("menu_items").select("*").eq("venue_id", vid).eq("is_active", true).eq("is_available", true)
supabase.from("pos_modifier_groups").select("*").eq("venue_id", vid).order("sort_order")
supabase.from("pos_modifiers").select("*").eq("venue_id", vid).order("sort_order")
supabase.from("pos_modifier_group_categories").select("*").eq("venue_id", vid)
```

### Profile fetch — `src/lib/supabase.ts:126-139`
```typescript
export async function fetchCashierProfiles(venueId: string): Promise<CashierProfile[]> {
  const { data, error } = await supabase
    .from("cashier_profiles")
    .select("id, venue_id, name, icon, color, rvc_id, rvc_name, viva_terminal_id, viva_terminal_name, fiscal_provider, fiscal_config, printer_mappings, receipt_printer_ip, receipt_printer_name, order_types, sort_order, active")
    .eq("venue_id", venueId)
    .eq("active", true)
    .order("sort_order", { ascending: true });
  return (data ?? []) as CashierProfile[];
}
```

### CashierProfile type — `src/lib/dbTypes.ts:18-36`
```typescript
export interface CashierProfile {
  id: string; venue_id: string; name: string; icon: string; color: string;
  rvc_id: string | null; rvc_name: string | null;
  viva_terminal_id: string | null; viva_terminal_name: string | null;
  fiscal_provider: string | null; fiscal_config: Record<string, unknown>;
  printer_mappings: Array<{ ip: string; name: string; categories?: string[] }>;
  receipt_printer_ip: string | null; receipt_printer_name: string | null;
  order_types: { tables?: boolean; bar?: boolean; quick?: boolean; delivery?: boolean };
  sort_order: number; active: boolean;
}
// NOTE: pricelist_id NOT YET in this interface — needs adding
```

### Profile selection flow — `src/app/page.tsx:155-172`
```
doLogin(waiterProfile) → fetchCashierProfiles(vid) →
  0 or 1 profiles → auto-select → finalizeLogin()
  multiple → show picker UI → user selects → setCashierProfile(p) → finalizeLogin()
```

### Data persistence
- Online: Direct Supabase queries → React state + background SQLite write
- Offline: Read from local SQLite (Dexie/CapSQLite)
- Cashier profiles: NOT cached in SQLite — always fetched fresh

---

## Architecture: Price List Tables

### New Tables (Migration)

```sql
-- 1. Price lists (one per RVC or custom grouping)
CREATE TABLE pos_price_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                 -- "Coffee Bar Prices", "Bistro Full Menu"
  description TEXT,
  is_default BOOLEAN DEFAULT false,   -- fallback when profile has no pricelist
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Which categories appear in this price list
CREATE TABLE pos_price_list_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id UUID NOT NULL REFERENCES pos_price_lists(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(price_list_id, category_id)
);

-- 3. Which items are in this list + price overrides
CREATE TABLE pos_price_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id UUID NOT NULL REFERENCES pos_price_lists(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  price NUMERIC NOT NULL,             -- override price (or copy of base price)
  price_takeaway NUMERIC,             -- optional takeaway override
  is_available BOOLEAN DEFAULT true,  -- hide items per list
  sort_order INTEGER DEFAULT 0,
  UNIQUE(price_list_id, menu_item_id)
);

-- 4. Link to cashier profiles (alongside existing pricelist_name text — don't delete it)
ALTER TABLE cashier_profiles ADD COLUMN pricelist_id UUID REFERENCES pos_price_lists(id);

-- 5. RLS (mandatory)
ALTER TABLE pos_price_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_price_list_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_price_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full" ON pos_price_lists FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full" ON pos_price_list_categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full" ON pos_price_list_items FOR ALL USING (true) WITH CHECK (true);
-- Add anon/authenticated read policies scoped by venue_id as needed
```

### Flow

```
EL-Loyal Admin (DeviceSettings.js):
  1. Admin creates price lists for venue ("Coffee Bar", "Bistro Full")
  2. Selects categories + items for each list
  3. Sets price overrides per item (or keeps base price)
  4. Assigns price list to cashier profile (dropdown replaces text input)

Joey on login:
  1. fetchCashierProfiles(venueId) → includes pricelist_id
  2. If profile.pricelist_id:
     → Fetch pos_price_list_categories WHERE price_list_id = X
     → Fetch pos_price_list_items WHERE price_list_id = X (JOIN menu_items for names)
     → Use override prices, show only those categories/items
  3. If profile.pricelist_id is NULL:
     → Check venue default (is_default = true)
     → If no default: current behavior (all items, base prices)
```

---

## Build Plan

### Phase 1: Database Migration
- Create 3 tables + RLS in Supabase (oxyycdgbvmesuadtmcjd)
- Add pricelist_id to cashier_profiles
- Create RPC: `copy_menu_to_pricelist(venue_id, pricelist_id)` — bulk-copies all items at base price

### Phase 2: EL-Loyal Admin UI (DESIGN SPEC FIRST — get Jon's approval)
- **Repo:** `~/GitHub/ELOYAL.APP/`
- **File:** `frontend/src/pages/manager/DeviceSettings.js` (3,083 lines)
- **Backend:** `backend/server.py`
- Add "Price Lists" section in DeviceSettings
- CRUD for price lists
- Item picker with category filtering
- Price override editor (inline editing, defaulting to base price)
- Bulk "copy all items" button
- Replace `pricelist_name` text input (line 2764-2772) with dropdown from pos_price_lists
- Backend CRUD endpoints in server.py

### Phase 3: Joey Integration
- **Repo:** `~/Desktop/Projects/el-waiter/`
- `src/lib/dbTypes.ts:18-36` → Add `pricelist_id: string | null` to CashierProfile
- `src/lib/supabase.ts:126-139` → Add pricelist_id to SELECT, add `fetchPriceListMenu()`
- `src/app/order/page.tsx:132-136` → Conditional: pricelist_id ? fetch price list items : fetch all
- `src/lib/sqliteDb.ts:158-180` → Update offline schema for price-list-scoped cache
- Settings sync page (`src/app/settings/page.tsx:59-63`) → Same conditional

### Phase 4: EL-POS Integration (later)
- `~/GitHub/el-pos/` uses same cashier_profiles — same pattern applies

---

## Niceneasy Test Data

- Venue ID: `f8138c92-4e95-4cab-8172-0e75557ec14f`
- 1 RVC: "Coffee" (`b41eb1d3-bebc-46de-8f4c-3a47172d2e24`)
- 3 cashier profiles: coffee (has rvc_id), Station 1, MANAGER-2
- 7 waiter profiles
- 15 categories, 174 menu items (ALL venue-scoped)
- 3 floor sections, 12 tables

---

## File Locations

| What | Where |
|------|-------|
| Joey repo | `~/Desktop/Projects/el-waiter/` |
| Joey order page | `src/app/order/page.tsx` (lines 132-136 = menu fetch) |
| Joey types | `src/lib/dbTypes.ts` (lines 18-36 = CashierProfile) |
| Joey supabase | `src/lib/supabase.ts` (lines 126-139 = profile fetch) |
| Joey SQLite schema | `src/lib/sqliteDb.ts` (lines 158-180) |
| Joey settings sync | `src/app/settings/page.tsx` (lines 59-63) |
| Joey store | `src/store/waiterStore.ts` (line 33 = cashierProfile) |
| EL-Loyal admin | `~/GitHub/ELOYAL.APP/frontend/src/pages/manager/DeviceSettings.js` |
| EL-Loyal backend | `~/GitHub/ELOYAL.APP/backend/server.py` |
| EL-Loyal migrations | `~/GitHub/ELOYAL.APP/backend/migrations/` |
| Supabase project | oxyycdgbvmesuadtmcjd (eloyal) |
| Supabase creds | `~/Desktop/Projects/el-waiter/.env.local` |

---

## Critical Rules

1. **FISCAL CODE IS SACRED** — never change proven receipt/payment values
2. **Demo mode** gates ALL Viva/fiscal paths — default ON
3. **RLS is mandatory** on ALL new tables
4. **Don't delete pricelist_name** — add pricelist_id alongside it (backwards compat)
5. **Design spec first, code never** — present admin UI layout for Jon's approval before building
6. **SQLite hangs on Capacitor** — always set React state from Supabase first, persist to SQLite in background
7. **Version bumps** — update package.json + page.tsx + tables/page.tsx + settings/page.tsx
8. **Git** — commit to main, conventional commits, Vercel auto-deploys
9. **Supabase env** — `.env.local` for static build (`vercel env pull --environment production`)
10. **EL-Loyal repo is ELOYAL.APP** — NOT EL-loyal.com

## Build Commands

```bash
# Joey
cd ~/Desktop/Projects/el-waiter
npm run build:cap          # static export
npx cap sync android       # copy to Android
npx cap open android       # Android Studio → Clean → Run

# EL-Loyal
cd ~/GitHub/ELOYAL.APP
cd frontend && npx craco build   # build check
```
