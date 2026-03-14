"use client";
import { useEffect, useRef } from "react";
import { useWaiterStore } from "@/store/waiterStore";
import {
  initPushNotifications,
  registerDeviceToken,
  onNotificationReceived,
  onNotificationTapped,
  getFcmToken,
} from "@/lib/fcm";

/**
 * Initializes FCM push notifications on native Capacitor.
 * - Requests permission + registers for push on mount
 * - Upserts device token to Supabase when waiter is logged in
 * - Shows an in-app alert for foreground notifications
 * - Navigates on notification tap (background)
 * Renders nothing.
 */
export default function PushNotificationHandler() {
  const waiter = useWaiterStore((s) => s.waiter);
  const deviceVenueId = useWaiterStore((s) => s.deviceVenueId);
  const initDone = useRef(false);

  // ---- Init once on mount ----
  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;

    void initPushNotifications();
  }, []);

  // ---- Register token when waiter + venue available ----
  useEffect(() => {
    const venueId = waiter?.venue_id ?? deviceVenueId;
    const waiterId = waiter?.id;
    if (!venueId || !waiterId) return;

    // Token may arrive async — poll briefly then give up
    let attempts = 0;
    const interval = setInterval(() => {
      const token = getFcmToken();
      if (token) {
        void registerDeviceToken(venueId, waiterId, token);
        clearInterval(interval);
      }
      attempts++;
      if (attempts > 20) clearInterval(interval); // give up after ~10s
    }, 500);

    return () => clearInterval(interval);
  }, [waiter?.id, waiter?.venue_id, deviceVenueId]);

  // ---- Foreground notification handler ----
  useEffect(() => {
    const unsubForeground = onNotificationReceived((notification) => {
      // In-app toast: use native alert as minimal implementation.
      // Can be replaced with a proper toast library later.
      if (typeof window !== "undefined" && notification.title) {
        const msg = notification.body
          ? `${notification.title}\n${notification.body}`
          : notification.title;
        // Non-blocking: setTimeout so it doesn't freeze the UI thread
        setTimeout(() => {
          if (typeof window !== "undefined") {
            window.alert(msg);
          }
        }, 100);
      }
    });

    const unsubTapped = onNotificationTapped((notification) => {
      // Navigate if notification contains a path
      const path = notification.data?.path;
      if (path && typeof window !== "undefined") {
        window.location.href = path;
      }
    });

    return () => {
      unsubForeground();
      unsubTapped();
    };
  }, []);

  return null;
}
