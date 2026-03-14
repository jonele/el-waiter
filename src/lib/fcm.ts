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

let _initialized = false;
let _fcmToken: string | null = null;
const _foregroundCallbacks: NotificationCallback[] = [];
const _tappedCallbacks: NotificationCallback[] = [];

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Requests push permission, registers for FCM, and sets up listeners.
 * No-op on web — only runs on native Capacitor platforms.
 * Safe to call multiple times (idempotent).
 */
export async function initPushNotifications(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  if (_initialized) return _fcmToken;

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");

    // ---- Permission ----
    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== "granted") {
      return null;
    }

    // ---- Register ----
    await PushNotifications.register();

    // ---- Token listener ----
    await PushNotifications.addListener("registration", (token) => {
      _fcmToken = token.value;
    });

    // ---- Registration error ----
    await PushNotifications.addListener("registrationError", (_err) => {
      // Silent — don't crash the app for push failures
    });

    // ---- Foreground notification ----
    await PushNotifications.addListener(
      "pushNotificationReceived",
      (notification) => {
        const payload: PushNotificationPayload = {
          id: notification.id,
          title: notification.title ?? undefined,
          body: notification.body ?? undefined,
          data: notification.data as Record<string, string> | undefined,
        };
        for (const cb of _foregroundCallbacks) {
          try { cb(payload); } catch { /* callback error — silent */ }
        }
      }
    );

    // ---- Tap-to-open from background ----
    await PushNotifications.addListener(
      "pushNotificationActionPerformed",
      (action) => {
        const n = action.notification;
        const payload: PushNotificationPayload = {
          id: n.id,
          title: n.title ?? undefined,
          body: n.body ?? undefined,
          data: n.data as Record<string, string> | undefined,
        };
        for (const cb of _tappedCallbacks) {
          try { cb(payload); } catch { /* callback error — silent */ }
        }
      }
    );

    _initialized = true;
    return _fcmToken;
  } catch {
    // Non-native or plugin unavailable — silent
    return null;
  }
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
