# Handoff: Multi-RVC Price List Architecture for Joey (EL-Waiter)

## Resume Phrase
"Build multi-RVC price list architecture — admin manages pricelists, Joey downloads per cashier profile"

## Context

Joey (EL-Waiter) is a native Android waiter app (Next.js + Capacitor). It's at v2.10.0 with:
- Waiter PIN login ✅
- Cashier profile picker (station selection) ✅
- Tables from Supabase ✅
- Menu items from Supabase ✅

**The problem:** Menu items are venue-scoped only. A venue with multiple revenue centers (e.g., Coffee bar + Bistro restaurant) shows ALL items to ALL waiters. There's no way to scope a price list to a specific RVC or cashier profile.

## Current Data Model (Supabase: oxyycdgbvmesuadtmcjd)

```
venues (id, name, active)
  └── revenue_centers (id, venue_id, name, code, settings)
  └── waiter_profiles (id, venue_id, name, pin, role, section_name, rvc_name)
  └── cashier_profiles (id, venue_id, name, rvc_id→FK, rvc_name, printer_mappings, viva_terminal_id, fiscal_provider)
  └── menu_categories (id, venue_id, name, sort_order, is_active) ← NO rvc_id
  └── menu_items (id, venue_id, category_id→FK, name, price, is_active, is_available) ← NO rvc_id
  └── pos_tables (id, venue_id, name, floor_section_id, status)
  └── pos_floor_sections (id, venue_id, name)
```

**Key gap:** `menu_categories` and `menu_items` have no `rvc_id`. Everything is flat per venue.

## What We Need

### Option A: Pricelist junction table (RECOMMENDED)

Add a `pricelists` table that acts as a named collection of items with optional price overrides:

```sql
CREATE TABLE pricelists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id),
  name TEXT NOT NULL,            -- e.g., "Coffee Bar Menu", "Bistro Full Menu"
  description TEXT,
  is_default BOOLEAN DEFAULT false, -- fallback if no profile-specific pricelist
  active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE pricelist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pricelist_id UUID NOT NULL REFERENCES pricelists(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  price_override DECIMAL(10,2),  -- NULL = use menu_item.price
  is_available BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(pricelist_id, menu_item_id)
);

-- Link cashier profiles to pricelists
ALTER TABLE cashier_profiles ADD COLUMN pricelist_id UUID REFERENCES pricelists(id);
```

**Flow:**
1. Admin creates pricelists in EL-Loyal admin
2. Admin assigns menu items to each pricelist (with optional price overrides)
3. Admin links pricelist to cashier profile(s)
4. Joey: after selecting cashier profile → fetches `pricelist_items` for that profile's `pricelist_id`
5. Only those items show in the order screen

### Option B: Add rvc_id to menu tables (simpler but less flexible)

```sql
ALTER TABLE menu_categories ADD COLUMN rvc_id UUID REFERENCES revenue_centers(id);
ALTER TABLE menu_items ADD COLUMN rvc_id UUID REFERENCES revenue_centers(id);
```

- NULL rvc_id = visible to all RVCs
- Set rvc_id = visible only to that RVC
- Joey filters: `.or('rvc_id.is.null,rvc_id.eq.${selectedRvcId}')`

### Jon's preference: Admin manages it manually

The admin should be able to:
1. Go to EL-Loyal > Venue Settings > Pricelists
2. Create a pricelist (name, items, prices)
3. Copy/paste or select from existing menu items
4. Assign pricelist to cashier profiles
5. Waiters see only their profile's pricelist items

## Joey Side Changes Needed

### In `src/app/order/page.tsx`:
Currently loads ALL items: `supabase.from("menu_items").select("*").eq("venue_id", vid)`

Needs to change to:
```typescript
const cashierProfile = useWaiterStore.getState().cashierProfile;
const pricelistId = cashierProfile?.pricelist_id;

if (pricelistId) {
  // Load only items in this pricelist
  const { data } = await supabase
    .from("pricelist_items")
    .select("*, menu_item:menu_items(*), menu_category:menu_items!inner(category_id, menu_categories(*))")
    .eq("pricelist_id", pricelistId)
    .eq("is_available", true);
} else {
  // No pricelist — load all (backwards compatible)
  const { data } = await supabase
    .from("menu_items")
    .select("*")
    .eq("venue_id", vid)
    .eq("is_active", true);
}
```

### In `src/lib/dbTypes.ts`:
Add `pricelist_id?: string | null` to `CashierProfile` interface.

### In `src/store/waiterStore.ts`:
Already has `cashierProfile` — just needs the new field.

## EL-Loyal Admin Side Changes Needed

### New admin page: Pricelist Management
**Location:** `~/GitHub/EL-loyal.com/frontend/src/pages/manager/` (or `~/GitHub/ELOYAL.APP/`)

1. List pricelists for venue
2. Create/edit pricelist (name, description)
3. Add/remove items from pricelist (searchable list of all menu_items)
4. Set price overrides per item (optional)
5. Link pricelist to cashier profiles

### Backend API:
- `GET /api/pricelists?venue_id=X`
- `POST /api/pricelists` (create)
- `GET /api/pricelists/:id/items` (list items)
- `POST /api/pricelists/:id/items` (add items)
- `DELETE /api/pricelists/:id/items/:item_id` (remove)
- `PATCH /api/pricelists/:id/items/:item_id` (update price override)

## Tables & Reservations

Tables come from RSRV (the reservation system). This works independently:
- `pos_tables` in Supabase has venue-scoped tables
- RSRV reservations come from the `/api/rsrv/reservations` endpoint on Vercel
- Tables are NOT RVC-scoped (a table is a table regardless of which menu you serve from it)

## File Locations

| What | Where |
|------|-------|
| Joey repo | `~/Desktop/Projects/el-waiter/` |
| Joey order page | `src/app/order/page.tsx` |
| Joey store | `src/store/waiterStore.ts` |
| Joey types | `src/lib/dbTypes.ts` |
| Joey supabase functions | `src/lib/supabase.ts` |
| EL-Loyal admin | `~/GitHub/EL-loyal.com/` or `~/GitHub/ELOYAL.APP/` |
| EL-Loyal Supabase | `oxyycdgbvmesuadtmcjd` |
| Supabase credentials | `~/Desktop/Projects/el-waiter/.env.local` |

## Niceneasy Bistro Test Data

- Venue ID: `f8138c92-4e95-4cab-8172-0e75557ec14f`
- 1 RVC: "Coffee" (`b41eb1d3-bebc-46de-8f4c-3a47172d2e24`)
- 3 cashier profiles: coffee (has rvc_id), Station 1, MANAGER-2
- 7 waiter profiles: jimmy, jonel3, Stavroula, Nansy, Dimos, Nick, Demetris
- 15 categories, 174 menu items (ALL venue-scoped, no RVC filter)
- 3 floor sections: Indoor, Marina Terrace, Bar
- 12 tables

## Build Commands

```bash
cd ~/Desktop/Projects/el-waiter
npm run build:cap          # static export (excludes API routes)
npx cap sync android       # copy to Android
npx cap open android       # open Android Studio → Clean Project → Run
```

## CRITICAL RULES

1. **FISCAL CODE IS SACRED** — never change proven receipt case values
2. **Demo mode** gates ALL Viva/fiscal paths — default ON
3. **Supabase env vars** must be in `.env.local` for static build (run `vercel env pull --environment production`)
4. **SQLite hangs on Capacitor** — always set React state directly from Supabase, persist to SQLite in background (fire-and-forget)
5. **Version bumps** — update in package.json + page.tsx + tables/page.tsx + settings/page.tsx
6. **Git** — commit to main, conventional commits, Vercel auto-deploys
