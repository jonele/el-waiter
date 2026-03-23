import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "edge";

const RSRV_URL = "https://qlvqrlfupoeysllnpxcy.supabase.co";
const RSRV_KEY = process.env.RSRV_ANON_KEY || "";

// Map EL-Loyal venue IDs → RSRV venue IDs
const VENUE_MAP: Record<string, string> = {
  "a052b0f8-409a-4477-b4ea-70758d190ace": "96a702cf-b9c6-4a6d-aded-dd6b5cd32389", // Barbarossa
  "f8138c92-4e95-4cab-8172-0e75557ec14f": "", // Niceneasy Bistro (no RSRV yet)
};

export async function GET(req: NextRequest) {
  const venueId = req.nextUrl.searchParams.get("venueId");
  const date = req.nextUrl.searchParams.get("date");
  if (!venueId || !date) {
    return NextResponse.json({ error: "Missing venueId or date" }, { status: 400 });
  }
  // Validate UUID format
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(venueId)) {
    return NextResponse.json({ error: "Invalid venueId" }, { status: 400 });
  }
  // Validate date format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
  }

  if (!RSRV_KEY) {
    return NextResponse.json({ error: "RSRV not configured" }, { status: 503 });
  }

  // Resolve RSRV venue ID
  let rsrvVenueId = VENUE_MAP[venueId];
  const supabase = createClient(RSRV_URL, RSRV_KEY);

  // If no mapping, try to find by name match
  if (!rsrvVenueId) {
    // Look up the venue name from EL-Loyal, then find in RSRV
    const { data: rsrvVenues } = await supabase
      .from("venues")
      .select("id, name")
      .limit(50);
    // Try fuzzy match — this is a fallback
    if (rsrvVenues) {
      const match = rsrvVenues.find((v) => venueId.startsWith(v.id.slice(0, 8)));
      if (match) rsrvVenueId = match.id;
    }
  }

  if (!rsrvVenueId) {
    return NextResponse.json([]);
  }

  // Query RSRV Supabase directly for today's reservations
  const { data, error } = await supabase
    .from("reservations")
    .select("id, confirmation_code, customer_name, customer_phone, customer_email, party_size, reservation_date, reservation_time, status, table_id, table_name, source, notes, has_children, dietary_notes, staff_notes, prepayment_status, prepayment_amount_cents")
    .eq("venue_id", rsrvVenueId)
    .eq("reservation_date", date)
    .order("reservation_time");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}
