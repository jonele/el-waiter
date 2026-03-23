import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "edge";

/**
 * Lookup reservation by confirmation code, name, phone, or email.
 * Used by waiter check-in flow (QR scan or manual search).
 *
 * GET /api/rsrv/lookup?venueId=xxx&q=RSRV-ABC123
 * GET /api/rsrv/lookup?venueId=xxx&q=Papadopoulos
 * GET /api/rsrv/lookup?venueId=xxx&q=6912345678
 */

const RSRV_URL = process.env.RSRV_SUPABASE_URL || "https://qlvqrlfupoeysllnpxcy.supabase.co";
const RSRV_KEY = process.env.RSRV_SERVICE_KEY || "";

export async function GET(req: NextRequest) {
  const venueId = req.nextUrl.searchParams.get("venueId");
  const query = req.nextUrl.searchParams.get("q")?.trim();

  if (!venueId || !query) {
    return NextResponse.json({ error: "Missing venueId or q" }, { status: 400 });
  }

  if (!RSRV_KEY) {
    return NextResponse.json({ error: "Server config error" }, { status: 500 });
  }

  const supabase = createClient(RSRV_URL, RSRV_KEY);

  // Today's date for filtering
  const today = new Date().toISOString().slice(0, 10);

  // Determine search type
  const isConfCode = query.toUpperCase().startsWith("RSRV-") || /^[A-Z0-9]{6,}$/i.test(query);
  const isPhone = /^\+?\d{7,}$/.test(query.replace(/[\s-]/g, ""));

  let results;

  if (isConfCode) {
    // Search by confirmation code
    const { data } = await supabase
      .from("reservations")
      .select("id, confirmation_code, customer_name, customer_phone, customer_email, party_size, reservation_date, reservation_time, status, table_id, table_name, source, notes, prepayment_status, prepayment_amount_cents")
      .eq("venue_id", venueId)
      .ilike("confirmation_code", `%${query}%`)
      .gte("reservation_date", today)
      .order("reservation_date")
      .limit(10);
    results = data;
  } else if (isPhone) {
    // Search by phone
    const normalized = query.replace(/[\s-]/g, "");
    const { data } = await supabase
      .from("reservations")
      .select("id, confirmation_code, customer_name, customer_phone, customer_email, party_size, reservation_date, reservation_time, status, table_id, table_name, source, notes, prepayment_status, prepayment_amount_cents")
      .eq("venue_id", venueId)
      .or(`customer_phone.ilike.%${normalized}%,customer_phone.ilike.%${normalized.replace(/^0/, "+30")}%`)
      .gte("reservation_date", today)
      .order("reservation_date")
      .limit(10);
    results = data;
  } else {
    // Search by name or email
    const { data } = await supabase
      .from("reservations")
      .select("id, confirmation_code, customer_name, customer_phone, customer_email, party_size, reservation_date, reservation_time, status, table_id, table_name, source, notes, prepayment_status, prepayment_amount_cents")
      .eq("venue_id", venueId)
      .or(`customer_name.ilike.%${query}%,customer_email.ilike.%${query}%`)
      .gte("reservation_date", today)
      .order("reservation_date")
      .limit(10);
    results = data;
  }

  return NextResponse.json({ results: results || [] });
}
