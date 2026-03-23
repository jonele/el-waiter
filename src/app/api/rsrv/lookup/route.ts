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
const RSRV_KEY = process.env.RSRV_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsdnFybGZ1cG9leXNsbG5weGN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0NTc3MTgsImV4cCI6MjA4MzAzMzcxOH0.4Iy5mX1XdZHT6PPb1ieLmKRO9XOJGwRzLdsSMPYdjng";

const VENUE_MAP: Record<string, string> = {
  "a052b0f8-409a-4477-b4ea-70758d190ace": "96a702cf-b9c6-4a6d-aded-dd6b5cd32389",
};

export async function GET(req: NextRequest) {
  let venueId = req.nextUrl.searchParams.get("venueId");
  const query = req.nextUrl.searchParams.get("q")?.trim();

  if (!venueId || !query) {
    return NextResponse.json({ error: "Missing venueId or q" }, { status: 400 });
  }

  const supabase = createClient(RSRV_URL, RSRV_KEY);

  // Map EL-Loyal venue ID → RSRV venue ID
  venueId = VENUE_MAP[venueId] || venueId;

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
