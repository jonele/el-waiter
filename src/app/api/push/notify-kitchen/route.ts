import { NextRequest, NextResponse } from "next/server";
import { sendPushNotifications, verifyApiKey } from "@/lib/push";

// firebase-admin requires Node.js — MUST NOT be edge
export const maxDuration = 60;

interface NotifyKitchenBody {
  venue_id: string;
  table_name: string;
  waiter_id?: string;
  items?: string[];
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
  let body: NotifyKitchenBody;
  try {
    body = (await req.json()) as NotifyKitchenBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { venue_id, table_name, waiter_id, items } = body;
  if (!venue_id || !table_name) {
    return NextResponse.json(
      { error: "venue_id and table_name are required" },
      { status: 400 }
    );
  }

  // ── Format notification ────────────────────────────────────────────────
  const title = "\u2705 \u0388\u03C4\u03BF\u03B9\u03BC\u03BF";
  let notifBody = `\u03A4\u03C1\u03B1\u03C0\u03AD\u03B6\u03B9 ${table_name} \u2014 \u03C0\u03B1\u03C1\u03B1\u03B3\u03B3\u03B5\u03BB\u03AF\u03B1 \u03AD\u03C4\u03BF\u03B9\u03BC\u03B7`;
  if (items && items.length > 0) {
    const preview = items.slice(0, 3).join(", ");
    const suffix = items.length > 3 ? ` +${items.length - 3}` : "";
    notifBody += ` (${preview}${suffix})`;
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
        type: "kitchen_ready",
        venue_id,
        table_name,
        ...(waiter_id ? { waiter_id } : {}),
        ...(items ? { items: JSON.stringify(items) } : {}),
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
