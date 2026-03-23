/**
 * Native thermal printer service for Joey (Capacitor).
 * Sends ESC/POS commands directly to LAN printers via TCP port 9100.
 * Only works in native Android/iOS builds — fails gracefully on web.
 *
 * Same ESC/POS format as EL-POS printer.rs.
 */

import type { DbOrderItem } from "./dbTypes";

const PRINTER_PORT = 9100;
const TIMEOUT_MS = 5000;

// ESC/POS command bytes
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const INIT = [ESC, 0x40]; // Initialize printer
const BOLD_ON = [ESC, 0x45, 0x01];
const BOLD_OFF = [ESC, 0x45, 0x00];
const CENTER = [ESC, 0x61, 0x01];
const LEFT = [ESC, 0x61, 0x00];
const DOUBLE_SIZE_ON = [ESC, 0x21, 0x30]; // Double width + height
const DOUBLE_SIZE_OFF = [ESC, 0x21, 0x00];
const CUT = [GS, 0x56, 0x41, 0x03]; // Partial cut
const FEED_3 = [ESC, 0x64, 0x03]; // Feed 3 lines

function textToBytes(text: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 128) {
      bytes.push(code);
    } else {
      // UTF-8 encode for Greek characters
      if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
  }
  return bytes;
}

function line(text: string): number[] {
  return [...textToBytes(text), LF];
}

/**
 * Build a kitchen ticket as ESC/POS byte array.
 * Matches EL-POS printer.rs format:
 * - Table name (double size, bold)
 * - Waiter name
 * - Separator
 * - Items with quantity (bold)
 * - Modifiers as "  + modifier" (bold)
 * - Feed + cut
 */
export function buildKitchenTicket(
  tableName: string,
  waiterName: string,
  items: DbOrderItem[],
): number[] {
  const bytes: number[] = [];

  // Init
  bytes.push(...INIT);

  // Set UTF-8 mode (ESC t 28 for some printers, or codepage)
  bytes.push(ESC, 0x74, 0x1c); // UTF-8 codepage

  // Header: Table name (centered, double size, bold)
  bytes.push(...CENTER);
  bytes.push(...DOUBLE_SIZE_ON);
  bytes.push(...BOLD_ON);
  bytes.push(...line(tableName));
  bytes.push(...BOLD_OFF);
  bytes.push(...DOUBLE_SIZE_OFF);

  // Waiter + time
  bytes.push(...line(waiterName));
  bytes.push(...line(new Date().toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit" })));
  bytes.push(...LEFT);
  bytes.push(...line("─".repeat(32)));

  // Items
  for (const item of items) {
    // Quantity + name (bold, double size for visibility)
    bytes.push(...DOUBLE_SIZE_ON);
    bytes.push(...BOLD_ON);
    bytes.push(...line(`Qx ${item.quantity} ${item.name}`));
    bytes.push(...BOLD_OFF);
    bytes.push(...DOUBLE_SIZE_OFF);

    // Modifiers — "  + modifier" (bold)
    if (item.modifiers && item.modifiers.length > 0) {
      bytes.push(...BOLD_ON);
      bytes.push(...line(`  + ${item.modifiers.map((m) => m.name).join(", ")}`));
      bytes.push(...BOLD_OFF);
    }

    // Notes — "  >> note"
    if (item.notes && !item.modifiers?.length) {
      bytes.push(...BOLD_ON);
      bytes.push(...line(`  >> ${item.notes}`));
      bytes.push(...BOLD_OFF);
    }

    // Seat assignment
    if (item.seat) {
      bytes.push(...line(`  Θέση: ${item.seat}`));
    }
  }

  // Footer
  bytes.push(...line("─".repeat(32)));
  bytes.push(...CENTER);
  bytes.push(...line(`${items.length} είδη`));
  bytes.push(...LEFT);

  // Feed + cut
  bytes.push(...FEED_3);
  bytes.push(...CUT);

  return bytes;
}

/**
 * Send raw bytes to a thermal printer via TCP.
 * Only works in Capacitor native builds.
 * Returns true if sent, false if not available (web/error).
 */
export async function sendToPrinter(printerIp: string, data: number[]): Promise<boolean> {
  try {
    // Dynamic import — only resolves in Capacitor native builds
    const mod = await import("capacitor-tcp-socket");
    const TcpSocket = mod.TcpSocket;
    const DataEncoding = mod.DataEncoding;

    // Connect
    const { client } = await TcpSocket.connect({
      ipAddress: printerIp,
      port: PRINTER_PORT,
    });

    // Send data as base64
    const uint8 = new Uint8Array(data);
    const base64 = btoa(String.fromCharCode(...uint8));
    await TcpSocket.send({ client, data: base64, encoding: DataEncoding.BASE64 });

    // Disconnect
    await TcpSocket.disconnect({ client });

    return true;
  } catch {
    // Not native or printer unreachable — fall back to Bridge HTTP
    return false;
  }
}

/**
 * Print a kitchen ticket to a thermal printer.
 * Tries native TCP first, falls back to Bridge HTTP.
 */
export async function printKitchenTicket(
  printerIp: string,
  tableName: string,
  waiterName: string,
  items: DbOrderItem[],
  bridgeUrl?: string,
): Promise<boolean> {
  // Build the ticket
  const ticketBytes = buildKitchenTicket(tableName, waiterName, items);

  // Try native TCP first (Capacitor)
  const nativeSent = await sendToPrinter(printerIp, ticketBytes);
  if (nativeSent) return true;

  // Fall back to Bridge HTTP if available
  if (bridgeUrl) {
    try {
      const res = await fetch(`${bridgeUrl}/api/v1/print/raw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          printer_ip: printerIp,
          data_base64: btoa(String.fromCharCode(...new Uint8Array(ticketBytes))),
        }),
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  return false;
}
