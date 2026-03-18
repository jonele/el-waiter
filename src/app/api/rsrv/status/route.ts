import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const RSRV_BASE = "https://el-rsrv.com";

export async function PATCH(req: NextRequest) {
  const body = await req.json() as { reservationId: string; status: string; venueId: string };
  if (!body.reservationId || !body.status || !body.venueId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const key = process.env.RSRV_SERVICE_KEY;
  if (!key) return NextResponse.json({ error: "Server config error" }, { status: 500 });

  const r = await fetch(`${RSRV_BASE}/api/manage/reservations/status`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const text = await r.text();
    return NextResponse.json({ error: `RSRV ${r.status}: ${text}` }, { status: r.status });
  }

  const data = await r.json();
  return NextResponse.json(data);
}
