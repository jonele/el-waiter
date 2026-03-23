import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "edge";

const RSRV_URL = "https://qlvqrlfupoeysllnpxcy.supabase.co";
const RSRV_KEY = process.env.RSRV_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsdnFybGZ1cG9leXNsbG5weGN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0NTc3MTgsImV4cCI6MjA4MzAzMzcxOH0.4Iy5mX1XdZHT6PPb1ieLmKRO9XOJGwRzLdsSMPYdjng";

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
