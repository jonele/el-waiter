/**
 * EL-Waiter unified database access.
 *
 * This is the primary import for all database operations in the app.
 * Routes to SQLite on Capacitor native or Dexie/IndexedDB on web.
 *
 * All interfaces, types, and helper functions are re-exported here
 * so existing imports like:
 *   import { waiterDb, getOpenOrder, calcTotal } from "@/lib/waiterDb";
 *   import type { DbOrder, DbMenuItem } from "@/lib/waiterDb";
 * continue to work unchanged.
 */

// Re-export all types from the shared type definitions
export type {
  DbWaiterProfile,
  DbFloorSection,
  DbTable,
  DbMenuCategory,
  DbMenuItem,
  DbOrderItem,
  DbOrder,
  DbSyncItem,
  DbFailedSyncItem,
  PaymentMethod,
  OrderItemModifier,
  UnifiedDb,
  RsrvReservation,
  WaitlistEntry,
} from "./dbTypes";

export { calcTotal } from "./dbTypes";

import { getUnifiedDb, type UnifiedDb } from "./sqliteDb";
import type { DbOrder, DbOrderItem } from "./dbTypes";

// ---------------------------------------------------------------------------
// The main `waiterDb` export — same name as before, same API shape.
// On native: backed by SQLite. On web: backed by Dexie.
// ---------------------------------------------------------------------------
export const waiterDb: UnifiedDb = getUnifiedDb();

// Alias for new code that prefers a shorter name
export const db: UnifiedDb = waiterDb;

// ---------------------------------------------------------------------------
// Helper functions (use the unified db)
// ---------------------------------------------------------------------------

export async function getOpenOrder(tableId: string): Promise<DbOrder | undefined> {
  return waiterDb.orders
    .where("table_id").equals(tableId)
    .and((o: DbOrder) => o.status === "open" || o.status === "sent")
    .last();
}

/** Orders for this waiter created on or after a given ISO date string */
export async function getWaiterOrders(waiterId: string, sinceIso: string): Promise<DbOrder[]> {
  return waiterDb.orders
    .where("waiter_id").equals(waiterId)
    .and((o: DbOrder) => o.created_at >= sinceIso)
    .toArray();
}

// Re-export initDb for app startup
export { initDb } from "./sqliteDb";
