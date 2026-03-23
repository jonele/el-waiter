import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

/**
 * Build Viva App-to-App SoftPOS URI for the waiter's phone.
 * The phone IS the terminal — vivapayclient:// launches Viva Terminal app.
 *
 * POST /api/viva/softpos
 * Body: { amount_cents, merchant_id, order_id, table_name, tip_cents?, callback_url? }
 * Returns: { uri: "vivapayclient://pay/v1?..." }
 *
 * ISV credentials stay server-side — URI built here, returned to client.
 * Client does: window.location.href = uri (opens Viva app).
 * Viva app processes payment, redirects to callback_url with result params.
 */

const ISV_CLIENT_ID = process.env.VIVA_ISV_CLIENT_ID || "";
const ISV_CLIENT_SECRET = process.env.VIVA_ISV_CLIENT_SECRET || "";
const ISV_SOURCE_CODE = process.env.VIVA_ISV_SOURCE_CODE || "";
const ISV_FEE_RATE = 0.003; // 0.3% ISV fee (EL-POS rate)

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    amount_cents: number;
    merchant_id: string;
    order_id: string;
    table_name?: string;
    tip_cents?: number;
    callback_url?: string;
    aade_signature_data?: string;
    aade_signature?: string;
  };

  if (!body.amount_cents || !body.merchant_id || !body.order_id) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  // Validate amount is a positive integer (cents)
  if (typeof body.amount_cents !== "number" || body.amount_cents <= 0 || !Number.isInteger(body.amount_cents) || body.amount_cents > 99999999) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  if (!ISV_CLIENT_ID || !ISV_CLIENT_SECRET) {
    return NextResponse.json({ error: "ISV credentials not configured" }, { status: 500 });
  }

  const isvAmount = Math.max(1, Math.round(body.amount_cents * ISV_FEE_RATE));
  const callbackUrl = body.callback_url || "https://el-waiter.vercel.app/pay/callback";

  const params = new URLSearchParams({
    merchantKey: body.merchant_id,
    appId: "com.elvalue.elwaiter",
    action: "sale",
    clientTransactionId: body.order_id,
    amount: String(body.amount_cents),
    tipAmount: String(body.tip_cents || 0),
    callback: callbackUrl,
    ISV_clientId: ISV_CLIENT_ID,
    ISV_clientSecret: ISV_CLIENT_SECRET,
    ISV_merchantId: body.merchant_id,
    ISV_amount: String(isvAmount),
  });

  if (ISV_SOURCE_CODE) {
    params.set("ISV_sourceCode", ISV_SOURCE_CODE);
  }

  if (body.aade_signature_data && body.aade_signature) {
    params.set("aadeProviderSignatureData", body.aade_signature_data);
    params.set("aadeProviderSignature", body.aade_signature);
  }

  const uri = `vivapayclient://pay/v1?${params.toString()}`;

  return NextResponse.json({ uri, order_id: body.order_id });
}
