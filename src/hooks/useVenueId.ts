import { useWaiterStore } from "@/store/waiterStore";

/**
 * Single source of truth for venue ID.
 * Prefers deviceVenueId (from QR scan) over waiter.venue_id (from profile).
 * Every component that needs venue_id should use this hook.
 */
export function useVenueId(): string {
  const deviceVenueId = useWaiterStore((s) => s.deviceVenueId);
  const waiterVenueId = useWaiterStore((s) => s.waiter?.venue_id);
  return deviceVenueId || waiterVenueId || "";
}
