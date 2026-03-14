"use client";
import { useEffect, useRef } from "react";
import { useWaiterStore } from "@/store/waiterStore";
import { waiterDb } from "@/lib/waiterDb";
import { supabase } from "@/lib/supabase";
import {
  drainSyncQueue,
  getCurrentBackoffMs,
  resetBackoff,
} from "@/lib/syncEngine";

/**
 * ConnectivityMonitor — headless component mounted in layout.tsx
 *
 * Responsibilities:
 * 1. Track online/offline via browser events
 * 2. Poll sync queue count every 15s (fixed)
 * 3. When items exist + online + supabase ready:
 *    - Drain up to 10 items per cycle
 *    - Exponential backoff on failures (15s -> 300s max)
 *    - Move items to dead queue after 10 failed retries
 * 4. Update store with pendingSyncs, failedSyncs, lastSyncedAt
 */
export default function ConnectivityMonitor() {
  const {
    waiter,
    setOnline,
    setPendingSyncs,
    setFailedSyncs,
    setLastSyncedAt,
  } = useWaiterStore();

  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDrainingRef = useRef(false);

  useEffect(() => {
    // ---- Online/offline tracking ----
    function update() {
      setOnline(navigator.onLine);
    }
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();

    // ---- Fixed 15s polling for queue count ----
    const countInterval = setInterval(async () => {
      try {
        const cnt = await waiterDb.syncQueue.count();
        setPendingSyncs(cnt);
        const failedCnt = await waiterDb.failedQueue.count();
        setFailedSyncs(failedCnt);
      } catch {
        // DB not ready yet — ignore
      }
    }, 15_000);

    // ---- Drain scheduler ----
    function scheduleDrain() {
      if (drainTimerRef.current) {
        clearTimeout(drainTimerRef.current);
      }
      const delay = getCurrentBackoffMs();
      drainTimerRef.current = setTimeout(runDrain, delay);
    }

    async function runDrain() {
      if (isDrainingRef.current) return;
      if (!navigator.onLine || !supabase || !waiter?.venue_id) {
        scheduleDrain();
        return;
      }

      let cnt: number;
      try {
        cnt = await waiterDb.syncQueue.count();
      } catch {
        scheduleDrain();
        return;
      }

      if (cnt === 0) {
        scheduleDrain();
        return;
      }

      isDrainingRef.current = true;
      try {
        const result = await drainSyncQueue(waiterDb, supabase);
        setPendingSyncs(result.remainingCount);
        setFailedSyncs(result.failedCount);

        if (result.processed > 0) {
          setLastSyncedAt(new Date().toISOString());
        }
      } catch {
        // Unexpected error in drain — backoff is handled inside drainSyncQueue
      } finally {
        isDrainingRef.current = false;
      }

      scheduleDrain();
    }

    // Kick off the first drain cycle
    scheduleDrain();

    // When coming back online, reset backoff and drain immediately
    function onOnline() {
      resetBackoff();
      if (!isDrainingRef.current) {
        if (drainTimerRef.current) clearTimeout(drainTimerRef.current);
        void runDrain();
      }
    }
    window.addEventListener("online", onOnline);

    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("online", onOnline);
      clearInterval(countInterval);
      if (drainTimerRef.current) {
        clearTimeout(drainTimerRef.current);
      }
    };
  }, [waiter?.venue_id]);

  return null;
}
