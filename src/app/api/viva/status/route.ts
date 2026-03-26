import { NextRequest, NextResponse } from "next/server";
import { withCors, optionsResponse } from "../../cors";

export const runtime = "edge";

export async function OPTIONS() { return optionsResponse(); }

const ISV_CLIENT_ID = process.env.VIVA_ISV_CLIENT_ID!;
const ISV_CLIENT_SECRET = process.env.VIVA_ISV_CLIENT_SECRET!;
const ACCOUNTS_URL = "https://accounts.vivapayments.com/connect/token";
const VIVA_BASE = "https://api.vivapayments.com";
const SCOPES = "urn:viva:payments:core:api:isv";

async function getIsvToken(): Promise<string> {
  const creds = btoa(`${ISV_CLIENT_ID}:${ISV_CLIENT_SECRET}`);
  const r = await fetch(ACCOUNTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(SCOPES)}`,
  });
  if (!r.ok) throw new Error(`Viva auth failed: ${r.status}`);
  const data = await r.json() as { access_token: string };
  return data.access_token;
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  const merchantId = req.nextUrl.searchParams.get("merchant_id");

  if (!sessionId || !merchantId) {
    return NextResponse.json({ error: "session_id and merchant_id required" }, { status: 400 });
  }

  let token: string;
  try {
    token = await getIsvToken();
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }

  const r = await fetch(
    `${VIVA_BASE}/ecr/isv/v1/sessions/${sessionId}?merchantId=${merchantId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!r.ok) {
    return NextResponse.json({ eventId: -1, success: false, error: `HTTP ${r.status}` });
  }

  const data = await r.json() as {
    eventId?: number;
    success?: boolean;
    transactionId?: string;
    message?: string;
  };

  return await withCors(NextResponse.json({
    eventId: data.eventId ?? null,
    success: data.success ?? false,
    transaction_id: data.transactionId ?? null,
    message: data.message ?? null,
  }));
}
