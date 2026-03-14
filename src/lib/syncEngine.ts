/**
 * Sync Engine for EL-Waiter — Phase 3: Sync Hardening
 *
 * Handles draining the sync queue with:
 * - Exponential backoff (15s -> 30s -> 60s -> 120s -> 300s max)
 * - Max 10 retries per item before moving to dead/failed queue
 * - Batch processing (up to 10 items per cycle)
 * - Conflict resolution:
 *   - Table status: server wins (latest updated_at)
 *   - Open orders: client wins (waiter's device is source of truth)
 *   - Paid orders: server wins (fiscal receipt is authoritative)
 *
 * Works with both Dexie (web) and SQLite (native) via UnifiedDb.
 */

import type { UnifiedDb, DbSyncItem } from "./dbTypes";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKOFF_STEPS = [15_000, 30_000, 60_000, 120_000, 300_000]; // ms
const MAX_RETRIES = 10;
const BATCH_SIZE = 10;

// ---------------------------------------------------------------------------
// In-memory backoff state (resets on page reload, which is fine)
// ---------------------------------------------------------------------------

let _currentBackoffIndex = 0;

/** Reset backoff to the fastest interval (call on success). */
export function resetBackoff(): void {
  _currentBackoffIndex = 0;
}

/** Bump backoff one step up (call on failure). */
export function bumpBackoff(): void {
  if (_currentBackoffIndex < BACKOFF_STEPS.length - 1) {
    _currentBackoffIndex += 1;
  }
}

/** Current backoff delay in ms. */
export function getCurrentBackoffMs(): number {
  return BACKOFF_STEPS[_currentBackoffIndex];
}

// ---------------------------------------------------------------------------
// Retry delay calculator (pure function for testing)
// ---------------------------------------------------------------------------

/**
 * Computes the retry delay for a given retry count.
 * 0 retries -> 15s, 1 -> 30s, 2 -> 60s, 3 -> 120s, 4+ -> 300s
 */
export function getRetryDelay(retries: number): number {
  const idx = Math.min(retries, BACKOFF_STEPS.length - 1);
  return BACKOFF_STEPS[idx];
}

// ---------------------------------------------------------------------------
// Move permanently failed items to dead queue
// ---------------------------------------------------------------------------

export async function moveToDead(
  db: UnifiedDb,
  item: DbSyncItem,
  errorMessage: string
): Promise<void> {
  await db.failedQueue.add({
    type: item.type,
    payload: item.payload,
    created_at: item.created_at,
    failed_at: new Date().toISOString(),
    retries: item.retries,
    last_error: errorMessage,
  });
  if (item.id !== undefined) {
    await db.syncQueue.delete(item.id);
  }
}

// ---------------------------------------------------------------------------
// Process a single sync item
// ---------------------------------------------------------------------------

async function processItem(
  supabase: SupabaseClient,
  db: UnifiedDb,
  item: DbSyncItem
): Promise<void> {
  if (item.type === "order_send") {
    await processOrderSend(supabase, db, item);
  } else if (item.type === "table_status") {
    await processTableStatus(supabase, db, item);
  }
}

async function processOrderSend(
  supabase: SupabaseClient,
  db: UnifiedDb,
  item: DbSyncItem
): Promise<void> {
  const order = JSON.parse(item.payload);

  // Conflict resolution: check server state for paid orders
  if (order.status === "paid" || order.status === "cancelled") {
    // Server wins for paid/cancelled orders (fiscal receipt is authoritative)
    const { data: serverOrder } = await supabase
      .from("kitchen_orders")
      .select("id, status, updated_at")
      .eq("id", order.id)
      .maybeSingle();

    if (serverOrder) {
      const serverTime = new Date(serverOrder.updated_at).getTime();
      const clientTime = new Date(order.updated_at || order.created_at).getTime();
      if (serverTime > clientTime) {
        // Server is newer — skip this update, just mark local as synced
        await db.orders.update(order.id, { synced: true });
        return;
      }
    }
  }

  // Client wins for open/sent orders (waiter's device is source of truth)
  const { error } = await supabase.from("kitchen_orders").upsert({
    id: order.id,
    venue_id: order.venue_id,
    tab_name: order.table_name,
    cashier_name: order.waiter_name,
    items: order.items,
    status: order.status || "pending",
    created_at: order.created_at,
  });

  if (error) throw new Error(error.message);

  await db.orders.update(order.id, { synced: true });
}

async function processTableStatus(
  supabase: SupabaseClient,
  db: UnifiedDb,
  item: DbSyncItem
): Promise<void> {
  const update = JSON.parse(item.payload);

  // Server wins for table status — check updated_at
  const { data: serverTable } = await supabase
    .from("pos_tables")
    .select("id, status, updated_at")
    .eq("id", update.table_id)
    .maybeSingle();

  if (serverTable?.updated_at) {
    const serverTime = new Date(serverTable.updated_at).getTime();
    const clientTime = new Date(update.updated_at || update.created_at).getTime();
    if (serverTime > clientTime) {
      // Server is newer — accept server state, update local
      await db.posTables.update(update.table_id, { status: serverTable.status });
      return;
    }
  }

  // Client is newer or no server record — push our status
  const { error } = await supabase
    .from("pos_tables")
    .update({ status: update.status })
    .eq("id", update.table_id);

  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Main drain function
// ---------------------------------------------------------------------------

export interface DrainResult {
  processed: number;
  failed: number;
  movedToDead: number;
  remainingCount: number;
  failedCount: number;
}

/**
 * Drain up to BATCH_SIZE items from the sync queue.
 *
 * Returns stats about what happened. The caller (ConnectivityMonitor) uses
 * these to update the store and adjust the polling interval via backoff.
 */
export async function drainSyncQueue(
  db: UnifiedDb,
  supabase: SupabaseClient
): Promise<DrainResult> {
  const items = await db.syncQueue.limit(BATCH_SIZE).toArray();

  let processed = 0;
  let failed = 0;
  let movedToDead = 0;

  for (const item of items) {
    try {
      await processItem(supabase, db, item);

      // Success — remove from queue
      if (item.id !== undefined) {
        await db.syncQueue.delete(item.id);
      }
      processed += 1;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const newRetries = (item.retries || 0) + 1;

      if (newRetries >= MAX_RETRIES) {
        // Exhausted retries — move to dead queue
        await moveToDead(db, { ...item, retries: newRetries }, errorMessage);
        movedToDead += 1;
      } else {
        // Increment retry counter and leave in queue
        if (item.id !== undefined) {
          await db.syncQueue.update(item.id, { retries: newRetries });
        }
        failed += 1;
      }
    }
  }

  // If any item succeeded, reset backoff. If all failed, bump it.
  if (processed > 0) {
    resetBackoff();
  } else if (failed > 0 || movedToDead > 0) {
    bumpBackoff();
  }

  const remainingCount = await db.syncQueue.count();
  const failedCount = await db.failedQueue.count();

  return { processed, failed, movedToDead, remainingCount, failedCount };
}
