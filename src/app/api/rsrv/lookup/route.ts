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

const RSRV_URL = "https://qlvqrlfupoeysllnpxcy.supabase.co";
const RSRV_KEY = process.env.RSRV_ANON_KEY || "";

const VENUE_MAP: Record<string, string> = {
  "a052b0f8-409a-4477-b4ea-70758d190ace": "96a702cf-b9c6-4a6d-aded-dd6b5cd32389",
};

export async function GET(req: NextRequest) {
  let venueId = req.nextUrl.searchParams.get("venueId");
  const query = req.nextUrl.searchParams.get("q")?.trim();

  if (!venueId || !query) {
    return NextResponse.json({ error: "Missing venueId or q" }, { status: 400 });
  }

  if (!RSRV_KEY) {
    return NextResponse.json({ error: "RSRV not configured" }, { status: 503 });
  }

  const supabase = createClient(RSRV_URL, RSRV_KEY);

  // Map EL-Loyal venue ID → RSRV venue ID
  venueId = VENUE_MAP[venueId] || venueId;

  // Today's date for filtering
  const today = new Date().toISOString().slice(0, 10);

  // Sanitize: strip PostgREST-special characters that could break .or() filter syntax
  const safeQuery = query.replace(/[,().\\]/g, "").slice(0, 100);
  if (!safeQuery) {
    return NextResponse.json({ results: [] });
  }

  // Determine search type
  const isConfCode = safeQuery.toUpperCase().startsWith("RSRV-") || /^[A-Z0-9]{6,}$/i.test(safeQuery);
  const isPhone = /^\+?\d{7,}$/.test(safeQuery.replace(/[\s-]/g, ""));

  let results;

  if (isConfCode) {
    // Search by confirmation code
    const { data } = await supabase
      .from("reservations")
      .select("id, confirmation_code, customer_name, customer_phone, customer_email, party_size, reservation_date, reservation_time, status, table_id, table_name, source, notes, prepayment_status, prepayment_amount_cents")
      .eq("venue_id", venueId)
      .ilike("confirmation_code", `%${safeQuery}%`)
      .gte("reservation_date", today)
      .order("reservation_date")
      .limit(10);
    results = data;
  } else if (isPhone) {
    // Search by phone
    const normalized = safeQuery.replace(/[\s-]/g, "");
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
      .or(`customer_name.ilike.%${safeQuery}%,customer_email.ilike.%${safeQuery}%`)
      .gte("reservation_date", today)
      .order("reservation_date")
      .limit(10);
    results = data;
  }

  return NextResponse.json({ results: results || [] });
}
