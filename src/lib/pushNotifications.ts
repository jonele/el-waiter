"use client";
import { Capacitor } from "@capacitor/core";
import { supabase } from "./supabase";

export async function registerPushNotifications(waiterId?: string, venueId?: string) {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");

    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== "granted") return;

    await PushNotifications.register();

    PushNotifications.addListener("registration", async (token) => {
      if (!waiterId || !venueId) return;
      // Store device token in Supabase for server-side push delivery
      await supabase?.from("waiter_push_tokens").upsert({
        waiter_id: waiterId,
        venue_id: venueId,
        token: token.value,
        platform: Capacitor.getPlatform(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "waiter_id,platform" });
    });

    PushNotifications.addListener("pushNotificationReceived", (notification) => {
      // Foreground notification — handled by presentationOptions in capacitor.config.ts
      console.log("Push received:", notification.title);
    });

    PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      // User tapped notification — navigate if data provided
      const data = action.notification.data as { path?: string };
      if (data?.path && typeof window !== "undefined") {
        window.location.href = data.path;
      }
    });
  } catch {
    // Non-native or permissions denied — silent
  }
}
