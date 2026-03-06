"use client";
import { useEffect } from "react";
import { useWaiterStore } from "@/store/waiterStore";
import { waiterDb } from "@/lib/waiterDb";
import { supabase } from "@/lib/supabase";

export default function ConnectivityMonitor() {
  const { waiter, settings, setOnline, setPendingSyncs } = useWaiterStore();

  useEffect(() => {
    function update() { setOnline(navigator.onLine); }
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();

    const interval = setInterval(async () => {
      const cnt = await waiterDb.syncQueue.count();
      setPendingSyncs(cnt);
      if (cnt > 0 && navigator.onLine && supabase && waiter?.venue_id) {
        void drainQueue();
      }
    }, 15000);

    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      clearInterval(interval);
    };
  }, [waiter?.venue_id]);

  async function drainQueue() {
    const items = await waiterDb.syncQueue.limit(10).toArray();
    for (const item of items) {
      try {
        if (item.type === "order_send") {
          const order = JSON.parse(item.payload);
          await supabase!.from("kitchen_orders").upsert({
            id: order.id, venue_id: order.venue_id,
            tab_name: order.table_name, cashier_name: order.waiter_name,
            items: order.items, status: "pending", created_at: order.created_at,
          });
          await waiterDb.orders.update(order.id, { synced: true });
        }
        if (item.id !== undefined) await waiterDb.syncQueue.delete(item.id);
      } catch {
        if (item.id !== undefined) {
          await waiterDb.syncQueue.update(item.id, { retries: item.retries + 1 });
        }
      }
    }
    const cnt = await waiterDb.syncQueue.count();
    setPendingSyncs(cnt);
  }

  return null;
}
