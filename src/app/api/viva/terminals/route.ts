import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { withCors, optionsResponse } from "../../cors";

export const runtime = "edge";

export async function OPTIONS() { return optionsResponse(); }

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function GET(req: NextRequest) {
  const venueId = req.nextUrl.searchParams.get("venue_id");
  if (!venueId) return NextResponse.json({ error: "venue_id required" }, { status: 400 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(venueId)) {
    return NextResponse.json({ error: "Invalid venue_id" }, { status: 400 });
  }

  const supabaseAdmin = getAdmin();
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const { data, error } = await supabaseAdmin
    .from("venues")
    .select("viva_terminals, viva_merchant_id")
    .eq("id", venueId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Venue not found" }, { status: 404 });
  }

  // viva_terminals is JSONB: [{ terminal_id, name }]
  const raw: unknown[] = Array.isArray(data.viva_terminals) ? data.viva_terminals : [];
  const terminals = raw
    .map((t: unknown) => {
      const term = t as Record<string, string>;
      return {
        terminal_id: term.terminal_id ?? term.id ?? term.tid ?? "",
        name: term.name ?? term.terminal_id ?? "",
      };
    })
    .filter((t) => t.terminal_id);

  return await withCors(NextResponse.json({
    terminals,
    merchant_id: data.viva_merchant_id ?? null,
  }));
}
