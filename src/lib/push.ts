import { createClient } from "@supabase/supabase-js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SendPushParams {
  venue_id: string;
  target_waiter_id?: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  broadcast?: boolean;
}

export interface SendPushResult {
  sent: number;
  failed: number;
}

// ── Supabase admin client (service key — reads waiter_devices across venues) ─

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// ── Firebase Admin — lazy singleton ──────────────────────────────────────────

let _firebaseApp: import("firebase-admin").app.App | null = null;

async function getFirebaseApp(): Promise<import("firebase-admin").app.App> {
  if (_firebaseApp) return _firebaseApp;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase credentials not configured");
  }

  // Lazy dynamic import — firebase-admin requires Node.js runtime
  const admin = await import("firebase-admin");

  // Handle newlines in private key (env vars often escape \n)
  const formattedKey = privateKey.replace(/\\n/g, "\n");

  _firebaseApp = admin.apps.length > 0
    ? admin.apps[0]!
    : admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey: formattedKey,
        }),
      });

  return _firebaseApp;
}

// ── Core send function ───────────────────────────────────────────────────────

export async function sendPushNotifications(
  params: SendPushParams
): Promise<SendPushResult> {
  const { venue_id, target_waiter_id, title, body, data, broadcast } = params;

  // Fetch tokens from waiter_devices
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    throw new Error("Supabase not configured");
  }

  let query = supabase
    .from("waiter_devices")
    .select("fcm_token")
    .eq("venue_id", venue_id);

  if (target_waiter_id && !broadcast) {
    query = query.eq("waiter_id", target_waiter_id);
  }

  const { data: devices, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch devices: ${error.message}`);
  }

  if (!devices || devices.length === 0) {
    return { sent: 0, failed: 0 };
  }

  // Deduplicate tokens
  const tokens = [...new Set(devices.map((d) => d.fcm_token as string))].filter(Boolean);
  if (tokens.length === 0) {
    return { sent: 0, failed: 0 };
  }

  // Send via Firebase Admin
  const app = await getFirebaseApp();
  const admin = await import("firebase-admin");
  const messaging = admin.messaging(app);

  const message: import("firebase-admin/messaging").MulticastMessage = {
    tokens,
    notification: { title, body },
    data: data ?? {},
    android: {
      priority: "high" as const,
      notification: {
        sound: "default",
        channelId: "el-waiter-alerts",
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
          badge: 1,
        },
      },
    },
  };

  const response = await messaging.sendEachForMulticast(message);

  // Clean up stale tokens
  const staleTokens: string[] = [];
  response.responses.forEach((resp, idx) => {
    if (
      !resp.success &&
      resp.error &&
      (resp.error.code === "messaging/registration-token-not-registered" ||
        resp.error.code === "messaging/invalid-registration-token")
    ) {
      staleTokens.push(tokens[idx]);
    }
  });

  // Fire-and-forget stale token cleanup
  if (staleTokens.length > 0) {
    void supabase
      .from("waiter_devices")
      .delete()
      .in("fcm_token", staleTokens);
  }

  return {
    sent: response.successCount,
    failed: response.failureCount,
  };
}

// ── Auth helper ──────────────────────────────────────────────────────────────

export function verifyApiKey(apiKey: string | null): boolean {
  const expected = process.env.PUSH_API_KEY;
  if (!expected || !apiKey) return false;
  return apiKey === expected;
}
