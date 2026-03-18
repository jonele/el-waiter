import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const RSRV_BASE = "https://el-rsrv.com";

export async function GET(req: NextRequest) {
  const venueId = req.nextUrl.searchParams.get("venueId");
  const date = req.nextUrl.searchParams.get("date");
  if (!venueId || !date) {
    return NextResponse.json({ error: "Missing venueId or date" }, { status: 400 });
  }

  const key = process.env.RSRV_SERVICE_KEY;
  if (!key) return NextResponse.json({ error: "Server config error" }, { status: 500 });

  const r = await fetch(
    `${RSRV_BASE}/api/manage/reservations?venueId=${encodeURIComponent(venueId)}&date=${encodeURIComponent(date)}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );

  if (!r.ok) {
    const body = await r.text();
    return NextResponse.json({ error: `RSRV ${r.status}: ${body}` }, { status: r.status });
  }

  const data = await r.json();
  return NextResponse.json(data);
}
