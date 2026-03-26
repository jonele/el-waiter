import { Capacitor } from "@capacitor/core";
import { supabase } from "./supabase";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PushNotificationPayload {
  id: string;
  title?: string;
  body?: string;
  data?: Record<string, string>;
}

type NotificationCallback = (notification: PushNotificationPayload) => void;

// ── State ────────────────────────────────────────────────────────────────────

let _fcmToken: string | null = null;
const _foregroundCallbacks: NotificationCallback[] = [];
const _tappedCallbacks: NotificationCallback[] = [];

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Push notifications are disabled — @capacitor/push-notifications was removed
 * (crashes without Firebase config). This stub keeps callers happy.
 * Re-enable when Firebase is configured.
 */
export async function initPushNotifications(): Promise<string | null> {
  // Stubbed out — push-notifications plugin not installed
  return null;
}

/**
 * Upserts the device FCM token to Supabase `waiter_devices`.
 * Call after initPushNotifications() once you have venue/waiter context.
 */
export async function registerDeviceToken(
  venueId: string,
  waiterId: string,
  token: string
): Promise<void> {
  if (!supabase) return;

  try {
    await supabase.from("waiter_devices").upsert(
      {
        venue_id: venueId,
        waiter_id: waiterId,
        fcm_token: token,
        platform: Capacitor.isNativePlatform()
          ? Capacitor.getPlatform()
          : "web",
        device_name: _getDeviceName(),
        last_seen: new Date().toISOString(),
      },
      { onConflict: "venue_id,waiter_id,fcm_token" }
    );
  } catch {
    // Non-critical — fire-and-forget. Token will retry next app launch.
  }
}

/**
 * Subscribe to foreground notifications.
 * Returns an unsubscribe function.
 */
export function onNotificationReceived(
  callback: NotificationCallback
): () => void {
  _foregroundCallbacks.push(callback);
  return () => {
    const idx = _foregroundCallbacks.indexOf(callback);
    if (idx >= 0) _foregroundCallbacks.splice(idx, 1);
  };
}

/**
 * Subscribe to notification tap events (user tapped notification from background).
 * Returns an unsubscribe function.
 */
export function onNotificationTapped(
  callback: NotificationCallback
): () => void {
  _tappedCallbacks.push(callback);
  return () => {
    const idx = _tappedCallbacks.indexOf(callback);
    if (idx >= 0) _tappedCallbacks.splice(idx, 1);
  };
}

/**
 * Returns the current FCM token, or null if not yet registered.
 */
export function getFcmToken(): string | null {
  return _fcmToken;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _getDeviceName(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  return "unknown";
}
