/**
 * Gunther cloud print integration for Joey (EL-Waiter).
 * Inserts a print_jobs row into Supabase so Gunther picks it up and sends
 * the ticket to the correct LAN printer.
 *
 * Gunther's process_job() will:
 *   - inject 2× height via enhance_job_init()
 *   - append order footer (timestamp, table, waiter)
 *   - apply force_caps if enabled
 *   - route by printer_alias to the matching pos_printer
 *
 * Call pushToGunther() fire-and-forget — never blocks the order flow.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DbOrderItem } from "./dbTypes";
import { encodeCp737 } from "./nativePrinter";

/** Build a minimal CP737-encoded ESC/POS kitchen ticket. */
function buildJobData(
  tableName: string,
  waiterName: string,
  items: DbOrderItem[],
): string {
  const bytes: number[] = [];

  // ESC @ reset + ESC t 14 (CP737 Greek DOS)
  // enhance_job_init() in Gunther inserts GS ! 0x10 (2× height) after this reset
  bytes.push(0x1B, 0x40);    // ESC @ — full printer reset
  bytes.push(0x1B, 0x74, 14); // ESC t 14 — CP737

  // Table name (bold)
  bytes.push(0x1B, 0x45, 0x01); // bold on
  bytes.push(...encodeCp737(tableName), 0x0A);
  bytes.push(0x1B, 0x45, 0x00); // bold off

  // Waiter name + separator
  bytes.push(...encodeCp737(waiterName), 0x0A);
  bytes.push(...encodeCp737("================================"), 0x0A);

  // Items
  for (const item of items) {
    // Quantity + name (bold)
    bytes.push(0x1B, 0x45, 0x01);
    bytes.push(...encodeCp737(`${item.quantity}x  ${item.name}`), 0x0A);
    bytes.push(0x1B, 0x45, 0x00);

    // Modifiers — "  -> modifier"
    if (item.modifiers?.length) {
      for (const mod of item.modifiers) {
        bytes.push(...encodeCp737(`  -> ${mod.name}`), 0x0A);
      }
    }

    // Notes — "  >> note"
    if (item.notes) {
      bytes.push(...encodeCp737(`  >> ${item.notes}`), 0x0A);
    }
  }

  // Trailing cut (Gunther strips this before appending footer, then re-cuts)
  bytes.push(0x1D, 0x56, 0x41, 0x03);

  // base64 encode
  const uint8 = new Uint8Array(bytes);
  return btoa(String.fromCharCode(...uint8));
}

/**
 * Insert a print_jobs row into Supabase for Gunther to pick up.
 * printerAlias should match a printer alias in pos_printers for this venue.
 * If null, Gunther will fail to route — set a fallback alias in the venue config.
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
): Promise<void> {
  try {
    const jobData = buildJobData(tableName, waiterName, items);
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
    // Printing failure never blocks order flow — silent swallow
  }
}
