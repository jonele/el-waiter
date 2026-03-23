import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";
export const maxDuration = 60;

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

export async function POST(req: NextRequest) {
  const { venue_id, terminal_id, merchant_id, amount_cents, session_id, merchant_reference, table_name } =
    await req.json() as {
      venue_id: string;
      terminal_id: string;
      merchant_id: string;
      amount_cents: number;
      session_id: string;
      merchant_reference?: string;
      table_name?: string;
    };

  if (!terminal_id || !merchant_id || !amount_cents || !session_id) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  // Validate amount is a positive integer (cents)
  if (typeof amount_cents !== "number" || amount_cents <= 0 || !Number.isInteger(amount_cents) || amount_cents > 99999999) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  let token: string;
  try {
    token = await getIsvToken();
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }

  const ref = merchant_reference ?? `ELW-${session_id.slice(-8)}`;
  const payload = {
    sessionId: session_id,
    terminalId: terminal_id,
    cashRegisterId: `ELW-${(venue_id ?? "").slice(-6)}`,
    amount: amount_cents,
    currencyCode: "978",
    merchantReference: ref,
    customerTrns: table_name ? `Table ${table_name}` : "EL Waiter",
    paymentMethod: "CardPresent",
    tipAmount: 0,
    isvDetails: {
      amount: amount_cents,
      terminalMerchantId: merchant_id,
    },
  };

  const r = await fetch(
    `${VIVA_BASE}/ecr/isv/v1/transactions:sale?merchantId=${merchant_id}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!r.ok && r.status !== 204) {
    const body = await r.text();
    return NextResponse.json({ error: `Viva API error ${r.status}: ${body}` }, { status: 502 });
  }

  return NextResponse.json({ success: true, session_id });
}
