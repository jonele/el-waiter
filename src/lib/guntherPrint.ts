/**
 * Gunther print integration for Joey (EL-Waiter).
 *
 * Strategy: LAN-first, Supabase fallback.
 *   1. If bridgeUrl is set, derive Gunther LAN URL (same host, port 8089)
 *      and POST /print directly — ~50ms, works offline.
 *   2. On any failure, fall back to inserting a print_jobs row to Supabase.
 *      Gunther polls cloud every 2s and picks it up.
 *
 * Gunther's process_job() always:
 *   - injects 2× height via enhance_job_init()
 *   - appends order footer (timestamp, table, waiter)
 *   - applies force_caps if enabled
 *   - routes by printer_alias to the matching LAN printer
 *
 * Never throws — printing failures never block order flow.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbOrderItem } from "./dbTypes";
import { encodeCp737 } from "./nativePrinter";

/** Derive Gunther LAN URL from Bridge URL (same host, port 8089). */
export function guntherUrlFromBridge(bridgeUrl: string | null | undefined): string | null {
  if (!bridgeUrl) return null;
  try {
    const u = new URL(bridgeUrl);
    u.port = "8089";
    u.pathname = "";
    return u.origin; // e.g. http://192.168.0.10:8089
  } catch {
    // bridgeUrl may not have a protocol — try naive port swap
    return bridgeUrl.replace(/:\d+$/, ":8089");
  }
}

/** Build a minimal CP737-encoded ESC/POS kitchen ticket (base64). */
function buildJobData(
  tableName: string,
  waiterName: string,
  items: DbOrderItem[],
): string {
  const bytes: number[] = [];

  // ESC @ reset + ESC t 14 (CP737)
  // Gunther's enhance_job_init() injects GS ! 0x10 (2× height) after the reset
  bytes.push(0x1B, 0x40);     // ESC @ full reset
  bytes.push(0x1B, 0x74, 14); // ESC t 14 CP737

  bytes.push(0x1B, 0x45, 0x01);
  bytes.push(...encodeCp737(tableName), 0x0A);
  bytes.push(0x1B, 0x45, 0x00);

  bytes.push(...encodeCp737(waiterName), 0x0A);
  bytes.push(...encodeCp737("================================"), 0x0A);

  for (const item of items) {
    bytes.push(0x1B, 0x45, 0x01);
    bytes.push(...encodeCp737(`${item.quantity}x  ${item.name}`), 0x0A);
    bytes.push(0x1B, 0x45, 0x00);

    if (item.modifiers?.length) {
      for (const mod of item.modifiers) {
        bytes.push(...encodeCp737(`  -> ${mod.name}`), 0x0A);
      }
    }
    if (item.notes) {
      bytes.push(...encodeCp737(`  >> ${item.notes}`), 0x0A);
    }
  }

  // Trailing cut — Gunther strips this, appends footer, re-cuts
  bytes.push(0x1D, 0x56, 0x41, 0x03);

  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

/**
 * Send a kitchen ticket to Gunther.
 * Tries LAN direct (port 8089) first; falls back to Supabase cloud insert.
 *
 * @param guntherLanUrl  Derived from Bridge URL via guntherUrlFromBridge()
 */
export async function pushToGunther(
  supabase: SupabaseClient,
  venueId: string,
  orderId: string,
  tableName: string,
  waiterName: string,
  items: DbOrderItem[],
  printerAlias: string | null,
  createdAt: string,
  guntherLanUrl?: string | null,
): Promise<void> {
  const jobData = buildJobData(tableName, waiterName, items);

  // 1. LAN direct — fast path, offline-capable
  if (guntherLanUrl && printerAlias) {
    try {
      const res = await fetch(`${guntherLanUrl}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venue_id: venueId,
          order_id: orderId,
          table_name: tableName,
          waiter_name: waiterName,
          printer_alias: printerAlias,
          job_data: jobData,
        }),
        signal: AbortSignal.timeout(5000), // > Gunther's 3s print_timeout_ms — prevents fallback racing
      });
      if (res.ok) return; // LAN success
    } catch {
      // LAN unreachable — fall through to Supabase
    }
  }

  // 2. Cloud fallback — Gunther polls every 2s
  try {
    await supabase.from("print_jobs").insert({
      venue_id: venueId,
      order_id: orderId,
      table_name: tableName,
      waiter_name: waiterName,
      printer_alias: printerAlias,
      category_id: null,
      job_data: jobData,
      status: "pending",
      created_at: createdAt,
    });
  } catch {
    // Silent — printing never blocks order flow
  }
}
