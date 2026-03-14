import { NextRequest, NextResponse } from "next/server";
import { sendPushNotifications, verifyApiKey } from "@/lib/push";

// firebase-admin requires Node.js — MUST NOT be edge
export const maxDuration = 60;

interface NotifyBillBody {
  venue_id: string;
  table_name: string;
  waiter_id?: string;
  amount_cents?: number;
}

export async function POST(req: NextRequest) {
  // ── Auth: fail-closed ──────────────────────────────────────────────────
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey || !verifyApiKey(apiKey)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Env check ──────────────────────────────────────────────────────────
  if (
    !process.env.FIREBASE_PROJECT_ID ||
    !process.env.FIREBASE_CLIENT_EMAIL ||
    !process.env.FIREBASE_PRIVATE_KEY ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_KEY
  ) {
    return NextResponse.json(
      { error: "Push service not configured" },
      { status: 503 }
    );
  }

  // ── Parse body ─────────────────────────────────────────────────────────
  let body: NotifyBillBody;
  try {
    body = (await req.json()) as NotifyBillBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { venue_id, table_name, waiter_id, amount_cents } = body;
  if (!venue_id || !table_name) {
    return NextResponse.json(
      { error: "venue_id and table_name are required" },
      { status: 400 }
    );
  }

  // ── Format notification ────────────────────────────────────────────────
  const title = "\u{1F9FE} \u039B\u03BF\u03B3\u03B1\u03C1\u03B9\u03B1\u03C3\u03BC\u03CC\u03C2";
  let notifBody = `\u03A4\u03C1\u03B1\u03C0\u03AD\u03B6\u03B9 ${table_name} \u03B6\u03B7\u03C4\u03AC \u03BB\u03BF\u03B3\u03B1\u03C1\u03B9\u03B1\u03C3\u03BC\u03CC`;
  if (amount_cents && amount_cents > 0) {
    const euros = (amount_cents / 100).toFixed(2);
    notifBody += ` (\u20AC${euros})`;
  }

  // ── Send ───────────────────────────────────────────────────────────────
  try {
    const result = await sendPushNotifications({
      venue_id,
      target_waiter_id: waiter_id,
      broadcast: !waiter_id,
      title,
      body: notifBody,
      data: {
        type: "bill_request",
        venue_id,
        table_name,
        ...(waiter_id ? { waiter_id } : {}),
        ...(amount_cents ? { amount_cents: String(amount_cents) } : {}),
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
