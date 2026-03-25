import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { CashierProfile } from "./dbTypes";

/**
 * Decode Unicode escape sequences in a string.
 * Handles cases where text is stored with escaped Unicode like \u0391\u03C1...
 */
export function decodeUnicodeEscapes(str: string): string {
  if (typeof str !== 'string') return str;
  // Check if string contains Unicode escapes like \u0391
  if (!/\\u[0-9a-fA-F]{4}/.test(str)) return str;
  try {
    return JSON.parse(`"${str.replace(/"/g, '\\"')}"`);
  } catch {
    return str;
  }
}

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL  || "";
const key  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key) : null;

export interface BillRequest {
  id: string;
  venue_id: string;
  table_id: string | null;
  table_name: string;
  waiter_id: string;
  waiter_name: string;
  status: 'pending' | 'processed' | 'cancelled';
  created_at: string;
  processed_at: string | null;
}

export interface TableMoveRequest {
  id: string;
  venue_id: string;
  from_table_id: string;
  from_table_name: string;
  to_table_id: string;
  to_table_name: string;
  waiter_id: string;
  waiter_name: string;
  status: "pending" | "approved" | "denied";
  created_at: string;
}

export interface WaiterProfile {
  id: string;
  venue_id: string;
  name: string;
  icon: string;
  color: string;
  pin?: string;
  role?: string;
  qr_token?: string;
  active: boolean;
  sort_order: number;
}

export interface SiblingVenue {
  id: string;
  name: string;
  table_count: number;
}

/** Given a venue ID, find all sibling venues (same owner_email) */
export async function fetchSiblingVenues(venueId: string): Promise<SiblingVenue[]> {
  if (!supabase) return [];
  // Get the owner_email for this venue
  const { data: venue } = await supabase
    .from("venues")
    .select("owner_email")
    .eq("id", venueId)
    .single();
  if (!venue?.owner_email) return [];
  // Find all venues with the same owner_email
  const { data: siblings } = await supabase
    .from("venues")
    .select("id, name")
    .eq("owner_email", venue.owner_email)
    .eq("active", true)
    .order("name");
  if (!siblings || siblings.length <= 1) return []; // No siblings → no picker needed
  // Get table counts for each
  const withCounts: SiblingVenue[] = [];
  for (const s of siblings) {
    const { count } = await supabase
      .from("pos_tables")
      .select("id", { count: "exact", head: true })
      .eq("venue_id", s.id);
    withCounts.push({ id: s.id, name: s.name, table_count: count ?? 0 });
  }
  return withCounts;
}

export async function lookupWaiterByPin(venueId: string, pin: string): Promise<WaiterProfile | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("waiter_profiles")
    .select("id, venue_id, name, icon, color, pin, role, qr_token, active, sort_order")
    .eq("venue_id", venueId)
    .eq("pin", pin)
    .eq("active", true)
    .single();
  return data ?? null;
}

export async function fetchProfilesForVenue(venueId: string): Promise<WaiterProfile[]> {
  const { dinfo, derror } = await import("./debugLog");
  if (!supabase) { derror(`fetchProfiles: supabase is NULL (url=${url ? "set" : "EMPTY"}, key=${key ? "set" : "EMPTY"})`); return []; }
  dinfo(`fetchProfiles: querying venue=${venueId.slice(0, 8)}`);
  const { data, error } = await supabase
    .from("waiter_profiles")
    .select("id, venue_id, name, icon, color, pin, role, qr_token, active, sort_order")
    .eq("venue_id", venueId)
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) { derror(`fetchProfiles: ${error.message}`); return []; }
  dinfo(`fetchProfiles: got ${data?.length ?? 0} profiles`);
  return data ?? [];
}

export async function fetchCashierProfiles(venueId: string): Promise<CashierProfile[]> {
  const { dinfo, derror } = await import("./debugLog");
  if (!supabase) { derror("fetchCashierProfiles: supabase is NULL"); return []; }
  dinfo(`fetchCashierProfiles: venue=${venueId.slice(0, 8)}`);
  const { data, error } = await supabase
    .from("cashier_profiles")
    .select("id, venue_id, name, icon, color, rvc_id, rvc_name, pricelist_id, viva_terminal_id, viva_terminal_name, fiscal_provider, fiscal_config, printer_mappings, receipt_printer_ip, receipt_printer_name, order_types, extras_config, sort_order, active")
    .eq("venue_id", venueId)
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) { derror(`fetchCashierProfiles: ${error.message}`); return []; }
  dinfo(`fetchCashierProfiles: got ${data?.length ?? 0} profiles`);
  return (data ?? []) as CashierProfile[];
}

// ── Price List Functions ─────────────────────────────────────────────────────

export interface VenuePriceList {
  id: string;
  name: string;
  is_active: boolean;
  item_count?: number;
}

/** Fetch all active price lists for a venue (for the waiter dropdown) */
export async function fetchVenuePriceLists(venueId: string): Promise<VenuePriceList[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("pos_menu_price_lists")
    .select("id, name, is_active")
    .eq("venue_id", venueId)
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as VenuePriceList[];
}

/** Fetch menu scoped to a price list — returns categories + items with override prices */
export async function fetchPriceListMenu(venueId: string, pricelistId: string) {
  const { dinfo, derror } = await import("./debugLog");
  if (!supabase) { derror("fetchPriceListMenu: supabase is NULL"); return null; }
  dinfo(`fetchPriceListMenu: venue=${venueId.slice(0, 8)} pricelist=${pricelistId.slice(0, 8)}`);

  // Get price list items with product details
  const { data: plItems, error: plErr } = await supabase
    .from("pos_menu_price_list_items")
    .select("id, product_id, rest_price, delivery_price, takeaway_price, is_active")
    .eq("price_list_id", pricelistId)
    .eq("is_active", true);

  if (plErr) { derror(`fetchPriceListMenu items: ${plErr.message}`); return null; }
  if (!plItems || plItems.length === 0) { dinfo("fetchPriceListMenu: no items in price list"); return null; }

  // Get the products referenced by price list items
  const productIds = plItems.map(i => i.product_id).filter(Boolean);
  const { data: products } = await supabase
    .from("pos_menu_products")
    .select("id, name, code, price, category_id, is_active, menu_item_id")
    .eq("venue_id", venueId)
    .in("id", productIds);

  // Get categories for these products
  const categoryIds = [...new Set((products ?? []).map(p => p.category_id).filter(Boolean))];
  const { data: categories } = categoryIds.length > 0
    ? await supabase
        .from("pos_menu_categories")
        .select("id, name, code, is_active")
        .eq("venue_id", venueId)
        .in("id", categoryIds)
    : { data: [] };

  // Build price map: product_id → prices
  const priceMap: Record<string, { rest: number; delivery: number; takeaway: number }> = {};
  for (const item of plItems) {
    priceMap[item.product_id] = {
      rest: Number(item.rest_price) || 0,
      delivery: Number(item.delivery_price) || 0,
      takeaway: Number(item.takeaway_price) || 0,
    };
  }

  // Convert to menu_items format (so the rest of the app works unchanged)
  const menuItems = (products ?? [])
    .filter(p => p.is_active && priceMap[p.id])
    .map(p => ({
      id: p.menu_item_id || p.id,  // Use menu_item_id if available for modifier compatibility
      venue_id: venueId,
      category_id: p.category_id,
      name: p.name,
      price: priceMap[p.id].rest,
      price_takeaway: priceMap[p.id].takeaway,
      is_active: true,
      is_available: true,
      sort_order: 0,
    }));

  // Convert categories to menu_categories format
  const menuCategories = (categories ?? [])
    .filter(c => c.is_active)
    .map(c => ({
      id: c.id,
      venue_id: venueId,
      name: c.name,
      sort_order: 0,
      is_active: true,
    }));

  dinfo(`fetchPriceListMenu: ${menuCategories.length} categories, ${menuItems.length} items`);
  return { categories: menuCategories, items: menuItems };
}

// ── Shift tracking + session exclusivity ─────────────────────────────────────

/**
 * Start a new shift and close any existing active shifts for this waiter.
 * Returns the new shift ID. Only one active shift per waiter is allowed —
 * logging in on a new device closes the old shift and kicks the old device.
 */
export async function startShift(waiterId: string, venueId: string, waiterName: string): Promise<string | null> {
  if (!supabase) return null;
  // Close all existing active shifts for this waiter (kick from other devices)
  await supabase
    .from("waiter_shifts")
    .update({ logout_at: new Date().toISOString() })
    .eq("waiter_id", waiterId)
    .is("logout_at", null);
  // Start new shift
  const { data } = await supabase
    .from("waiter_shifts")
    .insert({ waiter_id: waiterId, venue_id: venueId, waiter_name: waiterName })
    .select("id")
    .single();
  return data?.id ?? null;
}

/**
 * Check if our shift is still the active one (no logout_at set).
 * If another device logged in, our shift will have logout_at set.
 */
export async function isShiftActive(shiftId: string): Promise<boolean> {
  if (!supabase || !shiftId) return true; // offline — assume valid
  const { data } = await supabase
    .from("waiter_shifts")
    .select("logout_at")
    .eq("id", shiftId)
    .single();
  if (!data) return false;
  return data.logout_at === null;
}

export async function endShift(shiftId: string): Promise<void> {
  if (!supabase || !shiftId) return;
  try {
    const { data: shift } = await supabase
      .from("waiter_shifts")
      .select("login_at")
      .eq("id", shiftId)
      .single();
    const logoutAt = new Date().toISOString();
    const durationMinutes = shift?.login_at
      ? Math.round((Date.now() - new Date(shift.login_at).getTime()) / 60000)
      : null;
    void supabase
      .from("waiter_shifts")
      .update({ logout_at: logoutAt, duration_minutes: durationMinutes })
      .eq("id", shiftId);
  } catch {
    // fire-and-forget — shift end failure is non-critical
  }
}

export async function lookupWaiterByQrToken(venueId: string, qrToken: string): Promise<WaiterProfile | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("waiter_profiles")
    .select("id, venue_id, name, icon, color, pin, role, qr_token, active, sort_order")
    .eq("venue_id", venueId)
    .eq("qr_token", qrToken)
    .eq("active", true)
    .single();
  return data ?? null;
}
