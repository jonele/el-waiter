import { NextRequest, NextResponse } from "next/server";
import { sendPushNotifications, verifyApiKey } from "@/lib/push";
import type { SendPushParams } from "@/lib/push";

// firebase-admin requires Node.js — MUST NOT be edge
export const maxDuration = 60;

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
    !process.env.FIREBASE_PRIVATE_KEY
  ) {
    return NextResponse.json(
      { error: "Push service not configured" },
      { status: 503 }
    );
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  // ── Parse body ─────────────────────────────────────────────────────────
  let body: SendPushParams;
  try {
    body = (await req.json()) as SendPushParams;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { venue_id, title, body: msgBody } = body;
  if (!venue_id || !title || !msgBody) {
    return NextResponse.json(
      { error: "venue_id, title, and body are required" },
      { status: 400 }
    );
  }

  // ── Send ───────────────────────────────────────────────────────────────
  try {
    const result = await sendPushNotifications(body);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
