"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useWaiterStore } from "@/store/waiterStore";
import { supabase } from "@/lib/supabase";

interface ReadyOrder {
  id: string;
  tab_name: string;
  notified_at: number;
}

// Global singleton so the banner persists across page navigations
let globalDismissed = new Set<string>();

export default function KdsListener() {
  const { waiter, settings } = useWaiterStore();
  const [readyOrders, setReadyOrders] = useState<ReadyOrder[]>([]);
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);
  const permRef = useRef(false);

  const requestNotifPermission = useCallback(async () => {
    if (permRef.current) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
    permRef.current = true;
  }, []);

  function fireNotification(tabName: string) {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      new Notification("Έτοιμη παραγγελία!", {
        body: `Τραπέζι ${tabName} — πάρε την παραγγελία!`,
        icon: "/icon-192.png",
        tag: `kds-${tabName}`,
        requireInteraction: true,
      });
    }
  }

  useEffect(() => {
    if (!waiter || !settings.venueId || !supabase) return;

    void requestNotifPermission();

    const channel = supabase!
      .channel(`kds-ready-${settings.venueId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "kitchen_orders",
          filter: `venue_id=eq.${settings.venueId}`,
        },
        (payload) => {
          const row = payload.new as { id: string; tab_name: string; status: string };
          if (row.status !== "ready") return;
          if (globalDismissed.has(row.id)) return;

          setReadyOrders((prev) => {
            if (prev.find((o) => o.id === row.id)) return prev;
            fireNotification(row.tab_name);
            return [...prev, { id: row.id, tab_name: row.tab_name, notified_at: Date.now() }];
          });
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      void supabase!.removeChannel(channel);
      channelRef.current = null;
    };
  }, [waiter?.id, settings.venueId]);

  function dismiss(id: string) {
    globalDismissed.add(id);
    setReadyOrders((prev) => prev.filter((o) => o.id !== id));
  }

  if (readyOrders.length === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 space-y-1 pt-safe">
      {readyOrders.map((o) => (
        <div
          key={o.id}
          className="mx-3 mt-1 flex items-center justify-between rounded-2xl bg-green-600 px-4 py-3 shadow-lg"
          style={{ animation: "slideDown 0.3s ease-out" }}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">🍽️</span>
            <div>
              <p className="text-white font-bold text-sm">Έτοιμη παραγγελία!</p>
              <p className="text-green-100 text-xs">Τραπέζι {o.tab_name} — πάρε την!</p>
            </div>
          </div>
          <button
            onClick={() => dismiss(o.id)}
            className="ml-3 rounded-xl bg-green-700/60 px-3 py-2 text-white font-semibold text-sm touch-btn"
          >
            Παρελήφθη ✓
          </button>
        </div>
      ))}

      <style>{`
        @keyframes slideDown {
          from { transform: translateY(-100%); opacity: 0; }
          to   { transform: translateY(0);     opacity: 1; }
        }
      `}</style>
    </div>
  );
}
