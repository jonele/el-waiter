"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { waiterDb } from "@/lib/waiterDb";
import { useWaiterStore } from "@/store/waiterStore";
import { supabase, decodeUnicodeEscapes, isShiftActive } from "@/lib/supabase";
// BottomNav removed — all navigation in top header
import PinchZoomContainer from "@/components/PinchZoomContainer";
import QRScanner from "@/components/QRScanner";
import { registerPushNotifications } from "@/lib/pushNotifications";
import { pullVenueConfig } from "@/lib/venueConfig";
import type { DbTable, DbFloorSection, DbOrder, RsrvReservation, WaitlistEntry } from "@/lib/waiterDb";
import type { Theme } from "@/store/waiterStore";
import type { BillRequest } from "@/lib/supabase";
import { API_BASE } from "@/lib/apiBase";
import { dinfo, derror } from "@/lib/debugLog";

// Premium table card styles — ported from RSRV FloorPlanTheme
function getStatusStyle(status: string, isDark: boolean) {
  const styles: Record<string, { bg: string; border: string; dot: string; dotCls: string; text: string; muted: string }> = isDark ? {
    free:     { bg: "linear-gradient(180deg, #262626 0%, #1f1f1f 100%)", border: "#404040", dot: "#22c55e", dotCls: "animate-pulse", text: "#fafafa", muted: "#a1a1aa" },
    occupied: { bg: "linear-gradient(180deg, #262626 0%, #1f1f1f 100%)", border: "#3f3f46", dot: "#71717a", dotCls: "", text: "#a1a1aa", muted: "#71717a" },
    waiting:  { bg: "linear-gradient(180deg, #2a2517 0%, #221e12 100%)", border: "#4a3f20", dot: "#f59e0b", dotCls: "animate-pulse-fast", text: "#fcd34d", muted: "#a1a1aa" },
    reserved: { bg: "linear-gradient(180deg, #1a2928 0%, #152221 100%)", border: "#2d4a47", dot: "#2dd4bf", dotCls: "", text: "#5eead4", muted: "#a1a1aa" },
  } : {
    free:     { bg: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)", border: "#d1d5db", dot: "#22c55e", dotCls: "animate-pulse", text: "#374151", muted: "#64748b" },
    occupied: { bg: "linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)", border: "#94a3b8", dot: "#64748b", dotCls: "", text: "#475569", muted: "#94a3b8" },
    waiting:  { bg: "linear-gradient(180deg, #fffbeb 0%, #fef3c7 100%)", border: "#fcd34d", dot: "#f59e0b", dotCls: "animate-pulse-fast", text: "#b45309", muted: "#64748b" },
    reserved: { bg: "linear-gradient(180deg, #f0fdfa 0%, #e6fffa 100%)", border: "#5eead4", dot: "#14b8a6", dotCls: "", text: "#0d9488", muted: "#64748b" },
  };
  return styles[status] ?? styles.free;
}

const THEME_CYCLE: Theme[] = ["dark", "grey", "light", "beach"];
const THEME_ICON: Record<Theme, string> = { dark: "\uD83C\uDF19", grey: "\uD83C\uDF2B", light: "\u2600\uFE0F", beach: "\uD83C\uDFD6\uFE0F" };

type PageTab = "tables" | "reservations";

const RSRV_STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  pending:   { bg: "rgba(245,158,11,0.25)", text: "#fbbf24" },
  confirmed: { bg: "rgba(59,130,246,0.25)", text: "#60a5fa" },
  seated:    { bg: "rgba(239,68,68,0.25)",  text: "#f87171" },
  completed: { bg: "rgba(161,161,170,0.2)", text: "#a1a1aa" },
  cancelled: { bg: "rgba(161,161,170,0.2)", text: "#a1a1aa" },
  no_show:   { bg: "rgba(161,161,170,0.2)", text: "#a1a1aa" },
};

const SOURCE_EMOJI: Record<string, string> = {
  phone: "\uD83D\uDCDE",
  walk_in: "\uD83D\uDEB6",
  website: "\uD83C\uDF10",
  app: "\uD83D\uDCF1",
  vip: "\uD83D\uDC51",
  instagram: "\uD83D\uDCF7",
  google: "G",
};

const SITTING_OPTIONS = [
  { label: "1:30", minutes: 90 },
  { label: "2:00", minutes: 120 },
  { label: "4:00", minutes: 240 },
  { label: "\u0391\u03BD\u03BF\u03B9\u03C7\u03C4\u03CC", minutes: 0 },
];

const WALK_IN_SOURCES = [
  { key: "walk_in", emoji: "\uD83D\uDEB6", label: "Walk-in" },
  { key: "phone", emoji: "\uD83D\uDCDE", label: "\u03A4\u03B7\u03BB" },
  { key: "vip", emoji: "\uD83D\uDC51", label: "VIP" },
  { key: "instagram", emoji: "\uD83D\uDCF7", label: "Insta" },
  { key: "google", emoji: "G", label: "Google" },
];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nowTimeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function minutesAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

function isLate(reservation: RsrvReservation): boolean {
  if (reservation.status !== "confirmed" && reservation.status !== "pending") return false;
  const [h, m] = reservation.reservation_time.split(":").map(Number);
  const resTime = new Date();
  resTime.setHours(h, m, 0, 0);
  return Date.now() - resTime.getTime() > 15 * 60 * 1000;
}

function lastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : parts[0];
}

export default function TablesPage() {
  const router = useRouter();
  const { waiter, settings, isOnline, pendingSyncs, failedSyncs, lastSyncedAt, theme, setTheme, setVenueConfig, deviceVenueId } = useWaiterStore();
  const [sections, setSections] = useState<DbFloorSection[]>([]);
  const [tables, setTables] = useState<DbTable[]>([]);
  const [orderTotals, setOrderTotals] = useState<Record<string, number>>({});
  const [orderWaiters, setOrderWaiters] = useState<Record<string, string>>({});
  const [activeSection, setActiveSection] = useState<string>("all");
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [tableSearch, setTableSearch] = useState("");

  // Page-level tab
  const [pageTab, setPageTab] = useState<PageTab>("tables");

  // Move request state
  const [moveReqSource, setMoveReqSource] = useState<DbTable | null>(null);
  const [pendingMoveTableId, setPendingMoveTableId] = useState<string | null>(null);
  const [pendingMoveId, setPendingMoveId] = useState<string | null>(null);
  const [moveDenied, setMoveDenied] = useState<string | null>(null);

  // Bill request state
  const [pendingBillTableId, setPendingBillTableId] = useState<string | null>(null);
  const [billFlash, setBillFlash] = useState<{ tableId: string; type: "processed" | "cancelled" } | null>(null);

  // Kitchen orders state: map of table_name -> latest status
  const [kitchenStatus, setKitchenStatus] = useState<Record<string, "pending" | "in_progress" | "done">>({});

  // Staff messaging state
  const [showMessageSheet, setShowMessageSheet] = useState(false);
  const [msgTarget, setMsgTarget] = useState("boss");
  const [msgBody, setMsgBody] = useState("");
  const [incomingMsg, setIncomingMsg] = useState<{ from: string; body: string } | null>(null);

  // Reservation state
  const [reservations, setReservations] = useState<RsrvReservation[]>([]);
  const [rsrvLoading, setRsrvLoading] = useState(false);
  const [selectedRsrv, setSelectedRsrv] = useState<RsrvReservation | null>(null);
  const [rsrvAssignMode, setRsrvAssignMode] = useState(false);
  const rsrvInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Waitlist state
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [waitLoading, setWaitLoading] = useState(false);
  const [showAddWaitlist, setShowAddWaitlist] = useState(false);
  const [wlName, setWlName] = useState("");
  const [wlSize, setWlSize] = useState(2);
  const [wlPhone, setWlPhone] = useState("");
  const [selectedWl, setSelectedWl] = useState<WaitlistEntry | null>(null);
  const [wlAssignMode, setWlAssignMode] = useState(false);

  // Walk-in bottom sheet state
  const [walkInTable, setWalkInTable] = useState<DbTable | null>(null);
  const [wiName, setWiName] = useState("");
  const [wiPhone, setWiPhone] = useState("");
  const [wiSize, setWiSize] = useState(2);
  const [wiSitting, setWiSitting] = useState(240);
  const [wiSource, setWiSource] = useState("walk_in");
  const [wiSubmitting, setWiSubmitting] = useState(false);

  // Keypad state
  const [keypadInput, setKeypadInput] = useState("");

  // View mode: keypad (default/primary), map (grid), list (open tables)
  const [viewMode, setViewMode] = useState<"keypad" | "map" | "list">("map");

  // Staff profiles for messaging
  const [staffProfiles, setStaffProfiles] = useState<{ name: string; icon: string }[]>([]);
  // All venue open orders (fetched on-demand when Ανοιχτά view opened)
  const [allOpenOrders, setAllOpenOrders] = useState<{ table_name: string; cashier_name: string; total: number; items_count: number }[]>([]);

  // Check-in state
  const [showCheckin, setShowCheckin] = useState(false);
  const [checkinQuery, setCheckinQuery] = useState("");
  const [checkinResults, setCheckinResults] = useState<RsrvReservation[]>([]);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [checkinScanning, setCheckinScanning] = useState(false);

  const venueId = deviceVenueId || waiter?.venue_id || "";

  // Keypad matched table (live preview)
  const keypadMatch = (() => {
    if (!keypadInput.trim()) return null;
    const q = keypadInput.trim().toLowerCase();
    return tables.find((t) => t.name.toLowerCase() === q)
      || tables.find((t) => t.name.toLowerCase().startsWith(q))
      || null;
  })();

  // No-match sheet state
  const [showNoMatch, setShowNoMatch] = useState(false);
  const [noMatchQuery, setNoMatchQuery] = useState("");
  const [splitParent, setSplitParent] = useState<DbTable | null>(null);

  // All tables sorted numerically — always show everything so waiter can pick
  const [noMatchTables, setNoMatchTables] = useState<DbTable[]>([]);
  const noMatchSuggestions = noMatchTables.length > 0 ? noMatchTables : tables.filter((t) => t.is_active).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  // Find next available sub-table letter for a parent
  function nextSubLetter(parentName: string): string {
    const existing = tables
      .filter((t) => t.name.toLowerCase().startsWith(parentName.toLowerCase()) && t.name.length > parentName.length)
      .map((t) => t.name.slice(parentName.length).toUpperCase());
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (const l of letters) {
      if (!existing.includes(l)) return l;
    }
    return "A";
  }

  function handleKeypadNum(v: string) {
    if (v === "C") { setKeypadInput(""); return; }
    if (v === "\u2190") { setKeypadInput((p) => p.slice(0, -1)); return; }
    setKeypadInput((p) => p + v);
  }

  function handleKeypadGo() {
    const input = keypadInput.trim();
    if (!input) return;

    if (keypadMatch) {
      openTable(keypadMatch);
      setKeypadInput("");
      return;
    }

    // Check if this looks like a split request (e.g. "108A" where "108" exists)
    const letterMatch = input.match(/^(\d+)([A-Za-z]+)$/);
    if (letterMatch) {
      const parentName = letterMatch[1];
      const parent = tables.find((t) => t.name === parentName);
      if (parent) {
        // Parent exists — auto-create sub-table
        createSubTable(parent, letterMatch[2].toUpperCase());
        return;
      }
    }

    // No match at all — fetch fresh tables from Supabase, THEN show sheet
    setNoMatchQuery(input);
    const vid = venueId || useWaiterStore.getState().deviceVenueId || "";
    if (supabase && vid) {
      void (async () => {
        const { data } = await supabase.from("pos_tables").select("*").eq("venue_id", vid).eq("is_active", true);
        if (data && data.length > 0) {
          const mapped = data.map((t) => ({
            id: t.id, venue_id: t.venue_id, name: t.name,
            floor_section_id: t.floor_section_id, capacity: t.capacity ?? 4,
            status: (t.status ?? "free") as "free" | "occupied" | "waiting",
            sort_order: t.sort_order ?? 0, is_active: true,
          } as DbTable)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
          setNoMatchTables(mapped);
          // Also sync to local DB so next time they're available offline
          await waiterDb.posTables.bulkPut(data.map((t) => ({
            id: t.id, venue_id: t.venue_id, name: t.name,
            floor_section_id: t.floor_section_id, capacity: t.capacity ?? 4,
            status: t.status ?? "free", sort_order: t.sort_order ?? 0, is_active: t.is_active ?? true,
          })));
          // Refresh main tables state too
          setTables(mapped);
        }
        // Show sheet AFTER data is loaded
        setShowNoMatch(true);
      })().catch(() => {
        setSyncError("\u0391\u03C0\u03BF\u03C4\u03C5\u03C7\u03AF\u03B1 \u03C6\u03CC\u03C1\u03C4\u03C9\u03C3\u03B7\u03C2 \u03C4\u03C1\u03B1\u03C0\u03B5\u03B6\u03B9\u03CE\u03BD");
        setTimeout(() => setSyncError(null), 4000);
        setShowNoMatch(true); // still show sheet with whatever we have
      });
    } else {
      // No Supabase — show sheet with whatever we have
      setShowNoMatch(true);
    }
  }

  async function createSubTable(parent: DbTable, suffix: string) {
    const subName = `${parent.name}${suffix}`;
    // Check if sub-table already exists
    const existing = tables.find((t) => t.name.toLowerCase() === subName.toLowerCase());
    if (existing) {
      openTable(existing);
      setKeypadInput("");
      setShowNoMatch(false);
      setSplitParent(null);
      return;
    }
    // Create sub-table in Supabase
    if (supabase) {
      const { data } = await supabase.from("pos_tables").insert({
        venue_id: venueId,
        name: subName,
        floor_section_id: parent.floor_section_id,
        capacity: Math.max(1, Math.floor(parent.capacity / 2)),
        status: "free",
        sort_order: parent.sort_order + 1,
        is_active: true,
      }).select().single();
      if (data) {
        // Add to local DB + state
        await waiterDb.posTables.bulkPut([{
          id: data.id, venue_id: data.venue_id, name: data.name,
          floor_section_id: data.floor_section_id, capacity: data.capacity,
          status: data.status, sort_order: data.sort_order, is_active: true,
        }]);
        setTables((prev) => [...prev, {
          id: data.id, venue_id: data.venue_id, name: data.name,
          floor_section_id: data.floor_section_id, capacity: data.capacity,
          status: data.status as "free" | "occupied" | "waiting",
          sort_order: data.sort_order, is_active: true,
        } as DbTable]);
        openTable(data as DbTable);
      }
    }
    setKeypadInput("");
    setShowNoMatch(false);
    setSplitParent(null);
  }

  // ---------- Fetch all open orders for Ανοιχτά view ----------
  async function fetchAllOpenOrders() {
    if (!supabase) return;
    const vid = venueId || waiter?.venue_id || "";
    if (!vid) return;
    const { data } = await supabase
      .from("kitchen_orders")
      .select("tab_name, cashier_name, items, status")
      .eq("venue_id", vid)
      .in("status", ["pending", "sent"]);
    if (data) {
      setAllOpenOrders(data.map((o) => ({
        table_name: o.tab_name,
        cashier_name: o.cashier_name,
        total: Array.isArray(o.items) ? (o.items as { price: number; quantity: number }[]).reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0) : 0,
        items_count: Array.isArray(o.items) ? o.items.length : 0,
      })));
    }
  }

  // ---------- Check-in: search + seat ----------
  async function checkinSearch(q: string) {
    if (!q.trim() || !venueId) return;
    setCheckinLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/rsrv/lookup?venueId=${encodeURIComponent(venueId)}&q=${encodeURIComponent(q.trim())}`);
      if (r.ok) {
        const data = await r.json();
        setCheckinResults(data.results || []);
      }
    } catch {
      setSyncError("\u0391\u03C0\u03BF\u03C4\u03C5\u03C7\u03AF\u03B1 \u03B1\u03BD\u03B1\u03B6\u03AE\u03C4\u03B7\u03C3\u03B7\u03C2");
      setTimeout(() => setSyncError(null), 4000);
    }
    setCheckinLoading(false);
  }

  async function seatReservation(rsrv: RsrvReservation, table: DbTable) {
    try {
      await fetch(`${API_BASE}/api/rsrv/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId: rsrv.id, status: "seated", venueId }),
      });
      // Update table status
      if (supabase && table.id) {
        void supabase.from("pos_tables").update({
          status: "occupied",
          seated_customer_name: rsrv.customer_name,
          seated_covers: rsrv.party_size,
        }).eq("id", table.id);
      }
      await waiterDb.posTables.update(table.id, { status: "occupied" });
      setTables((prev) => prev.map((t) => t.id === table.id ? { ...t, status: "occupied", seated_customer_name: rsrv.customer_name, seated_covers: rsrv.party_size } : t));
      setShowCheckin(false);
      setCheckinQuery("");
      setCheckinResults([]);
      void fetchReservations();
    } catch {
      setSyncError("\u0391\u03C0\u03BF\u03C4\u03C5\u03C7\u03AF\u03B1 check-in");
      setTimeout(() => setSyncError(null), 4000);
    }
  }

  function handleCheckinQrScan(raw: string) {
    const val = raw.trim();
    setCheckinScanning(false);
    // Extract confirmation code from QR (could be URL or plain code)
    let code = val;
    try {
      const url = new URL(val);
      code = url.searchParams.get("code") || url.pathname.split("/").pop() || val;
    } catch { /* plain code */ }
    setCheckinQuery(code);
    void checkinSearch(code);
  }

  // ---------- Reservation fetch ----------
  const fetchReservations = useCallback(async () => {
    if (!venueId) return;
    setRsrvLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/rsrv/reservations?venueId=${encodeURIComponent(venueId)}&date=${todayStr()}`);
      if (r.ok) {
        const data = await r.json();
        setReservations(Array.isArray(data) ? data : (data.reservations ?? []));
      }
    } catch {
      if (isOnline) setSyncError("\u0391\u03C0\u03BF\u03C4\u03C5\u03C7\u03AF\u03B1 \u03C6\u03CC\u03C1\u03C4\u03C9\u03C3\u03B7\u03C2 \u03BA\u03C1\u03B1\u03C4\u03AE\u03C3\u03B5\u03C9\u03BD");
      setTimeout(() => setSyncError(null), 4000);
    }
    setRsrvLoading(false);
  }, [venueId, isOnline]);

  // ---------- Waitlist fetch ----------
  const fetchWaitlist = useCallback(async () => {
    if (!venueId) return;
    setWaitLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/rsrv/waitlist?venueId=${encodeURIComponent(venueId)}`);
      if (r.ok) {
        const data = await r.json();
        setWaitlist(Array.isArray(data) ? data : (data.waitlist ?? []));
      }
    } catch {
      if (isOnline) setSyncError("\u0391\u03C0\u03BF\u03C4\u03C5\u03C7\u03AF\u03B1 \u03C6\u03CC\u03C1\u03C4\u03C9\u03C3\u03B7\u03C2 \u03BB\u03AF\u03C3\u03C4\u03B1\u03C2 \u03B1\u03BD\u03B1\u03BC\u03BF\u03BD\u03AE\u03C2");
      setTimeout(() => setSyncError(null), 4000);
    }
    setWaitLoading(false);
  }, [venueId]);

  // ---------- Auto-poll reservations + waitlist ----------
  useEffect(() => {
    if (pageTab === "reservations") {
      void fetchReservations();
      void fetchWaitlist();
      rsrvInterval.current = setInterval(() => { void fetchReservations(); void fetchWaitlist(); }, 30000);
      return () => { if (rsrvInterval.current) clearInterval(rsrvInterval.current); };
    }
    return () => { if (rsrvInterval.current) clearInterval(rsrvInterval.current); };
  }, [pageTab, fetchReservations, fetchWaitlist]);

  // Also fetch reservations on initial mount for table overlay data
  useEffect(() => {
    if (venueId) void fetchReservations();
  }, [venueId, fetchReservations]);

  useEffect(() => {
    if (!waiter) { router.replace("/"); return; }
    loadLocal();
    if (isOnline) {
      syncFromSupabase();
      fetchKitchenOrders();
      // Pull shared venue config from POS (fire-and-forget)
      void pullVenueConfig(waiter.venue_id).then((cfg) => {
        if (cfg) setVenueConfig(cfg);
      }).catch(() => {});
    }
    // Register native push notifications (no-op on web)
    void registerPushNotifications(waiter.id, waiter.venue_id);
    // Load online staff (active shifts) for messaging — refresh every 60s
    async function loadOnlineStaff() {
      if (!supabase || !waiter) return;
      const vid = venueId || waiter.venue_id;
      const { data } = await supabase
        .from("waiter_shifts")
        .select("waiter_id, waiter_name")
        .eq("venue_id", vid)
        .is("logout_at", null);
      if (!data) return;
      // Get icons from local profiles
      const profiles = await waiterDb.waiterProfiles.where("venue_id").equals(vid).toArray();
      const iconMap: Record<string, string> = {};
      for (const p of profiles) iconMap[p.id] = p.icon || "\uD83D\uDC64";
      setStaffProfiles(
        data
          .filter((s) => s.waiter_name !== waiter.name)
          .map((s) => ({ name: s.waiter_name, icon: iconMap[s.waiter_id] || "\uD83D\uDC64" }))
      );
    }
    void loadOnlineStaff();
    const staffInterval = setInterval(loadOnlineStaff, 60000);
    return () => clearInterval(staffInterval);
  }, [waiter, waiter?.venue_id]);

  // Session exclusivity: check every 30s if our shift is still active
  useEffect(() => {
    const { currentShiftId, logout } = useWaiterStore.getState();
    if (!currentShiftId || !isOnline) return;
    const interval = setInterval(async () => {
      const active = await isShiftActive(currentShiftId);
      if (!active) {
        clearInterval(interval);
        logout();
        router.replace("/?kicked=1");
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [isOnline, router]);

  // Cleanup bill subscription on unmount
  useEffect(() => {
    return () => {
      if (supabase) void supabase.removeAllChannels();
    };
  }, []);

  // Staff @mention realtime subscription for incoming messages
  useEffect(() => {
    if (!supabase || !waiter?.venue_id) return;
    const vid = waiter.venue_id;
    const waiterName = (waiter.name ?? "").toLowerCase();
    const channel = supabase
      .channel(`staff-msgs-waiter-${vid}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pos_staff_messages", filter: `venue_id=eq.${vid}` },
        (payload) => {
          const msg = payload.new as { from_name: string; to_target: string; body: string };
          const isForUs =
            msg.to_target === "all" ||
            msg.to_target.toLowerCase() === waiterName;
          if (isForUs) {
            setIncomingMsg({ from: msg.from_name, body: msg.body });
            setTimeout(() => setIncomingMsg(null), 4000);
          }
        }
      )
      .subscribe();
    return () => { void supabase!.removeChannel(channel); };
  }, [waiter?.venue_id, waiter?.name]);

  // Realtime: live pos_tables status updates + hostess bill notifications
  useEffect(() => {
    if (!supabase || !waiter?.venue_id) return;
    const vid = waiter.venue_id;
    const role = waiter.role?.toLowerCase() || "";
    const isHostess = role === "hostess" || role === "beach_hostess";

    const ch = supabase
      .channel(`tables-live-${vid}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pos_tables", filter: `venue_id=eq.${vid}` },
        (payload) => {
          const row = payload.new as { id: string; status: string; seated_customer_name?: string };
          setTables((prev) => prev.map((t) =>
            t.id === row.id ? { ...t, status: row.status as DbTable["status"], seated_customer_name: row.seated_customer_name ?? null } : t
          ));
        }
      );

    if (isHostess) {
      ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "bill_requests", filter: `venue_id=eq.${vid}` },
        (payload) => {
          const row = payload.new as { table_name: string; waiter_name?: string };
          setIncomingMsg({ from: "\uD83E\uDDFE \u039B\u03BF\u03B3\u03B1\u03C1\u03B9\u03B1\u03C3\u03BC\u03CC\u03C2", body: `\u03A4\u03C1\u03B1\u03C0\u03AD\u03B6\u03B9 ${row.table_name}${row.waiter_name ? ` (${row.waiter_name})` : ""}` });
          setTimeout(() => setIncomingMsg(null), 5000);
        }
      );
    }

    ch.subscribe();
    return () => { void supabase!.removeChannel(ch); };
  }, [waiter?.venue_id, waiter?.role]);

  async function loadLocal() {
    const vid = venueId || waiter?.venue_id || "";
    if (!vid) return;
    const [secs, tbls, orders] = await Promise.all([
      waiterDb.floorSections.where("venue_id").equals(vid).sortBy("sort_order"),
      waiterDb.posTables.where("venue_id").equals(vid).sortBy("sort_order"),
      waiterDb.orders.where("status").anyOf(["open", "sent"]).toArray(),
    ]);
    setSections(secs);
    setTables(tbls.filter((t) => t.is_active));
    const totals: Record<string, number> = {};
    const waiters: Record<string, string> = {};
    for (const o of orders) {
      totals[o.table_id] = (totals[o.table_id] || 0) + o.total;
      waiters[o.table_id] = o.waiter_name;
    }
    setOrderTotals(totals);
    setOrderWaiters(waiters);
  }

  async function syncFromSupabase() {
    const vid = venueId || waiter?.venue_id || "";
    if (!supabase || !vid) { dinfo(`syncFromSupabase: skip (supabase=${!!supabase}, vid=${vid})`); return; }
    dinfo(`syncFromSupabase: start venue=${vid.slice(0, 8)}`);
    setSyncing(true);
    try {
      const [{ data: secs, error: secsErr }, { data: tbls, error: tblsErr }] = await Promise.all([
        supabase.from("pos_floor_sections").select("*").eq("venue_id", vid),
        supabase.from("pos_tables").select("*").eq("venue_id", vid),
      ]);
      if (secsErr) derror(`sections: ${secsErr.message}`);
      if (tblsErr) derror(`tables: ${tblsErr.message}`);
      dinfo(`syncFromSupabase: got ${secs?.length ?? 0} sections, ${tbls?.length ?? 0} tables`);

      // Set state IMMEDIATELY from Supabase — don't wait for SQLite
      if (secs) {
        const mappedSecs = secs.map((s) => ({
          id: s.id, venue_id: s.venue_id, name: s.name,
          sort_order: s.sort_order ?? 0, is_active: s.is_active ?? true,
        } as DbFloorSection));
        setSections(mappedSecs);
      }
      if (tbls) {
        const mappedTbls = tbls.map((t) => ({
          id: t.id, venue_id: t.venue_id, name: t.name,
          floor_section_id: t.floor_section_id, capacity: t.capacity ?? 4,
          status: (t.status ?? "free") as DbTable["status"], sort_order: t.sort_order ?? 0,
          is_active: t.is_active ?? true,
          seated_customer_name: t.seated_customer_name ?? null,
          seated_covers: t.seated_covers ?? null,
          seated_allergies: (t.seated_allergies as string[] | null) ?? [],
          seated_dietary: (t.seated_dietary as string[] | null) ?? [],
        } as DbTable)).filter((t) => t.is_active);
        setTables(mappedTbls);
      }

      // Background: persist to SQLite for offline use (fire-and-forget)
      if (secs) {
        void waiterDb.floorSections.bulkPut(secs.map((s) => ({
          id: s.id, venue_id: s.venue_id, name: s.name,
          sort_order: s.sort_order ?? 0, is_active: s.is_active ?? true,
        }))).catch(() => {});
      }
      if (tbls) {
        void waiterDb.posTables.bulkPut(tbls.map((t) => ({
          id: t.id, venue_id: t.venue_id, name: t.name,
          floor_section_id: t.floor_section_id, capacity: t.capacity ?? 4,
          status: t.status ?? "free", sort_order: t.sort_order ?? 0,
          is_active: t.is_active ?? true,
          seated_customer_name: t.seated_customer_name ?? null,
          seated_covers: t.seated_covers ?? null,
          seated_allergies: (t.seated_allergies as string[] | null) ?? [],
          seated_dietary: (t.seated_dietary as string[] | null) ?? [],
        }))).catch(() => {});
      }
    } catch (err) {
      setSyncError(`Σφάλμα συγχρονισμού: ${err instanceof Error ? err.message : "Ελέγξτε σύνδεση"}`);
      setTimeout(() => setSyncError(null), 5000);
    }
    setSyncing(false);
  }

  async function fetchKitchenOrders() {
    if (!supabase || !waiter) return;
    const { data } = await supabase
      .from("kitchen_orders")
      .select("tab_name, status, created_at")
      .eq("venue_id", waiter.venue_id)
      .order("created_at", { ascending: false });
    if (!data) return;
    const map: Record<string, "pending" | "in_progress" | "done"> = {};
    for (const row of data) {
      if (!map[row.tab_name]) {
        map[row.tab_name] = row.status as "pending" | "in_progress" | "done";
      }
    }
    setKitchenStatus(map);
  }

  async function submitBillRequest(t: DbTable) {
    if (!supabase || !waiter) return;
    if (pendingBillTableId === t.id) return;
    const { data, error } = await supabase
      .from("bill_requests")
      .insert({
        venue_id: waiter.venue_id,
        table_id: t.id,
        table_name: t.name,
        waiter_id: waiter.id,
        waiter_name: waiter.name,
        status: "pending",
      })
      .select("id")
      .single();
    if (error || !data) return;
    void supabase.from("pos_tables").update({ status: "bill_requested" }).eq("id", t.id);
    setPendingBillTableId(t.id);
    subscribeToBillRequest(data.id as string, t.id);
  }

  function subscribeToBillRequest(requestId: string, tableId: string) {
    if (!supabase) return;
    const channel = supabase
      .channel(`bill-request-${requestId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "bill_requests",
        filter: `id=eq.${requestId}`,
      }, (payload) => {
        const row = payload.new as BillRequest;
        if (row.status === "processed" || row.status === "cancelled") {
          setPendingBillTableId(null);
          setBillFlash({ tableId, type: row.status });
          setTimeout(() => setBillFlash(null), 2500);
          void supabase!.removeChannel(channel);
        }
      })
      .subscribe();
  }

  async function submitMoveRequest(from: DbTable, to: DbTable) {
    if (!supabase || !waiter) return;
    const { data, error } = await supabase
      .from("table_move_requests")
      .insert({
        venue_id: waiter.venue_id,
        from_table_id: from.id,
        from_table_name: from.name,
        to_table_id: to.id,
        to_table_name: to.name,
        waiter_id: waiter.id,
        waiter_name: waiter.name,
        status: "pending" as const,
      })
      .select("id")
      .single();
    if (error || !data) return;
    setPendingMoveId(data.id);
    setPendingMoveTableId(from.id);
    setMoveReqSource(null);
    subscribeToApproval(data.id, from, to);
  }

  function subscribeToApproval(requestId: string, from: DbTable, to: DbTable) {
    if (!supabase) return;
    const channel = supabase
      .channel(`move-approval-${requestId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "table_move_requests",
        filter: `id=eq.${requestId}`,
      }, async (payload) => {
        const row = payload.new as { status: string };
        if (row.status === "approved") {
          const orders = await waiterDb.orders
            .where("table_id").equals(from.id)
            .filter((o: DbOrder) => o.status === "open" || o.status === "sent")
            .toArray();
          for (const o of orders) {
            await waiterDb.orders.update(o.id, { table_id: to.id, table_name: to.name });
          }
          await waiterDb.posTables.update(from.id, { status: "free" });
          await waiterDb.posTables.update(to.id, { status: "occupied" });
          void supabase!.from("pos_tables").update({ status: "free" }).eq("id", from.id);
          void supabase!.from("pos_tables").update({ status: "occupied" }).eq("id", to.id);
          setPendingMoveId(null);
          setPendingMoveTableId(null);
          loadLocal();
          void supabase!.removeChannel(channel);
        } else if (row.status === "denied") {
          setPendingMoveId(null);
          setPendingMoveTableId(null);
          setMoveDenied(from.id);
          setTimeout(() => setMoveDenied(null), 2500);
          void supabase!.removeChannel(channel);
        }
      })
      .subscribe();
  }

  // ---------- RSRV actions ----------
  async function patchRsrvStatus(reservationId: string, status: string) {
    await fetch(`${API_BASE}/api/rsrv/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reservationId, status, venueId }),
    });
    setSelectedRsrv(null);
    setRsrvAssignMode(false);
    void fetchReservations();
  }

  async function assignTableToRsrv(rsrv: RsrvReservation, table: DbTable) {
    await fetch(`${API_BASE}/api/rsrv/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reservationId: rsrv.id, status: "seated", venueId, table_id: table.id }),
    });
    setSelectedRsrv(null);
    setRsrvAssignMode(false);
    void fetchReservations();
  }

  // ---------- Walk-in submit ----------
  async function submitWalkIn() {
    if (!walkInTable || wiSubmitting) return;
    setWiSubmitting(true);
    try {
      await fetch(`${API_BASE}/api/rsrv/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venue_id: venueId,
          customer_name: wiName.trim() || "Walk-in",
          customer_phone: wiPhone.trim() || null,
          party_size: wiSize,
          reservation_date: todayStr(),
          reservation_time: nowTimeStr(),
          status: "seated",
          source: wiSource,
          table_id: walkInTable.id,
          has_children: false,
          dietary_notes: null,
          staff_notes: wiSitting > 0 ? `Sitting: ${wiSitting}min` : null,
        }),
      });
      setWalkInTable(null);
      setWiName(""); setWiPhone(""); setWiSize(2); setWiSitting(240); setWiSource("walk_in");
      // Beach hostess stays on floor plan, waiters go to order page
      if (!isBeachHostess) {
        useWaiterStore.getState().setActiveTable(walkInTable);
        router.push("/order");
      }
      // Refresh reservations to show the new walk-in
      void fetchReservations();
    } catch {
      setSyncError("\u0391\u03C0\u03BF\u03C4\u03C5\u03C7\u03AF\u03B1 \u03BA\u03B1\u03C4\u03B1\u03C7\u03CE\u03C1\u03B7\u03C3\u03B7\u03C2 walk-in");
      setTimeout(() => setSyncError(null), 4000);
    }
    setWiSubmitting(false);
  }

  // ---------- Waitlist add ----------
  async function addToWaitlist() {
    if (!wlName.trim()) return;
    await fetch(`${API_BASE}/api/rsrv/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venue_id: venueId,
        party_name: wlName.trim(),
        party_size: wlSize,
        phone: wlPhone.trim() || null,
      }),
    });
    setShowAddWaitlist(false);
    setWlName(""); setWlSize(2); setWlPhone("");
    void fetchWaitlist();
  }

  // ---------- Table-level reservation lookup ----------
  const tableReservationMap: Record<string, RsrvReservation> = {};
  for (const r of reservations) {
    if (r.table_id && (r.status === "confirmed" || r.status === "pending" || r.status === "seated")) {
      tableReservationMap[r.table_id] = r;
    }
  }

  const filtered = tables
    .filter((t) => activeSection === "all" || t.floor_section_id === activeSection)
    .filter((t) => !tableSearch || t.name.toLowerCase().includes(tableSearch.toLowerCase()))
    .sort((a, b) => {
      // Group by section first, then sort by name within section
      if (a.floor_section_id !== b.floor_section_id) {
        return (a.floor_section_id || "").localeCompare(b.floor_section_id || "");
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });

  function handleTableSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && tableSearch) {
      const exact = filtered.find(
        (t) => t.name.toLowerCase() === tableSearch.toLowerCase()
      ) || filtered[0];
      if (exact) { openTable(exact); setTableSearch(""); }
    }
  }

  function openTable(t: DbTable) {
    useWaiterStore.getState().setActiveTable(t);
    router.push("/order");
  }

  const isBeachHostess = (() => {
    const r = waiter?.role?.toLowerCase() || "";
    return r === "beach_hostess" || r === "hostess";
  })();

  function handleTableTap(t: DbTable) {
    // If in assignment mode for reservation
    if (rsrvAssignMode && selectedRsrv) {
      void assignTableToRsrv(selectedRsrv, t);
      return;
    }
    // If in assignment mode for waitlist
    if (wlAssignMode && selectedWl) {
      void assignTableToWl(selectedWl, t);
      return;
    }
    // Beach hostess: empty table → walk-in sheet, occupied → reservation action sheet
    if (isBeachHostess) {
      const isOccupied = t.status === "occupied" || orderTotals[t.id] !== undefined;
      if (!isOccupied) {
        setWalkInTable(t);
      } else {
        // Find matching reservation for this table and show action sheet
        const matchedRsrv = reservations.find(r => r.table_id === t.id || r.table_name === t.name);
        if (matchedRsrv) {
          setSelectedRsrv(matchedRsrv);
        }
      }
      return;
    }
    // Normal table tap → go to order page
    openTable(t);
  }

  function handleEmptyTableLongPress(t: DbTable) {
    const isOccupied = t.status === "occupied" || orderTotals[t.id] !== undefined;
    if (!isOccupied) {
      setWalkInTable(t);
    }
  }

  async function assignTableToWl(wl: WaitlistEntry, table: DbTable) {
    // Create a reservation from waitlist entry, then seat them
    await fetch(`${API_BASE}/api/rsrv/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venue_id: venueId,
        customer_name: wl.party_name,
        customer_phone: wl.phone || null,
        party_size: wl.party_size,
        reservation_date: todayStr(),
        reservation_time: nowTimeStr(),
        status: "seated",
        source: "waitlist",
        table_id: table.id,
        has_children: false,
        dietary_notes: null,
        staff_notes: null,
      }),
    });
    setSelectedWl(null);
    setWlAssignMode(false);
    void fetchWaitlist();
    void fetchReservations();
  }

  function cycleTheme() {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length];
    setTheme(next);
  }

  void pendingMoveId; // used in move request subscription

  return (
    <div className="flex h-screen flex-col" style={{ background: "var(--c-bg)" }}>

      {/* Header */}
      <div
        className="pt-safe sticky top-0 z-30 backdrop-blur-md border-b px-3 py-2 flex items-center justify-between"
        style={{ background: "var(--c-header)", borderColor: "var(--c-border)" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-bold text-base" style={{ color: "var(--brand, #3B82F6)" }}>Joey</span>
              <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded" style={{ background: "var(--brand, #3B82F6)", color: "white", opacity: 0.9 }}>v2.8.1</span>
              {useWaiterStore.getState().demoMode && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded" style={{ background: "#f59e0b", color: "#000" }}>DEMO</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-sm shrink-0"
                style={{ background: "var(--c-surface2)" }}
              >
                {waiter?.icon || "👤"}
              </div>
              <span className="text-xs" style={{ color: "var(--c-text2)" }}>{waiter?.name}</span>
              <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-green-400 animate-pulse" : "bg-red-500"}`} />
            </div>
          </div>
          {pendingSyncs > 0 && (
            <span className="rounded-full bg-amber-500/20 text-amber-400 text-xs px-2 py-0.5 font-semibold">
              {pendingSyncs} \u03B5\u03BA\u03BA\u03C1\u03B5\u03BC\u03AE
            </span>
          )}
          {failedSyncs > 0 && (
            <span className="rounded-full bg-red-500/20 text-red-400 text-xs px-2 py-0.5 font-semibold">
              {failedSyncs} \u03B1\u03C0\u03AD\u03C4\u03C5\u03C7\u03B1\u03BD
            </span>
          )}
          {pendingSyncs === 0 && failedSyncs === 0 && lastSyncedAt && (
            <span className="text-[10px]" style={{ color: "var(--c-text2)" }}>
              {new Date(lastSyncedAt).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>

        <div className="flex items-center -mr-2">
          <button
            onClick={() => { setShowCheckin(true); setCheckinResults([]); setCheckinQuery(""); }}
            className="flex items-center justify-center w-[48px] h-[48px] text-lg transition-transform active:scale-90"
            aria-label="Check-in κράτησης"
            style={{ color: "var(--c-text2)" }}
          >
            📋
          </button>
          <button
            onClick={() => setShowMessageSheet(true)}
            className="flex items-center justify-center w-[48px] h-[48px] text-lg transition-transform active:scale-90"
            aria-label="Μήνυμα προσωπικού"
            style={{ color: "var(--c-text2)" }}
          >
            💬
          </button>
          <button
            onClick={cycleTheme}
            className="flex items-center justify-center w-[48px] h-[48px] text-lg transition-transform active:scale-90"
            aria-label="\u0391\u03BB\u03BB\u03B1\u03B3\u03AE \u03B8\u03AD\u03BC\u03B1\u03C4\u03BF\u03C2"
          >
            {THEME_ICON[theme]}
          </button>
          <button
            onClick={() => router.push("/settings")}
            className="flex items-center justify-center w-[48px] h-[48px] transition-colors active:opacity-60"
            style={{ color: "var(--c-text2)" }}
            aria-label="\u03A1\u03C5\u03B8\u03BC\u03AF\u03C3\u03B5\u03B9\u03C2"
          >
            <GearSvg />
          </button>
        </div>
      </div>

      {/* ROW 1: Main tabs — Τραπέζια | Κρατήσεις | Takeaway */}
      <div
        className="flex gap-1.5 px-3 py-1.5 border-b shrink-0"
        style={{ background: "var(--c-bg)", borderColor: "var(--c-border)" }}
      >
        <button
          onClick={() => setPageTab("tables")}
          className={`flex-1 rounded-xl h-9 text-sm font-bold transition-colors flex items-center justify-center gap-1.5 ${
            pageTab === "tables" ? "bg-brand text-white" : "active:opacity-70"
          }`}
          style={pageTab !== "tables" ? { background: "var(--c-surface2)", color: "var(--c-text2)" } : {}}
        >
          {"\uD83C\uDF7D\uFE0F"} {"\u03A4\u03C1\u03B1\u03C0\u03AD\u03B6\u03B9\u03B1"}
        </button>
        <button
          onClick={() => { setPageTab("reservations"); }}
          className={`flex-1 rounded-xl h-9 text-sm font-bold transition-colors flex items-center justify-center gap-1.5 ${
            pageTab === "reservations" ? "bg-brand text-white" : "active:opacity-70"
          }`}
          style={pageTab !== "reservations" ? { background: "var(--c-surface2)", color: "var(--c-text2)" } : {}}
        >
          {"\uD83D\uDCCB"} {"\u039A\u03C1\u03B1\u03C4\u03AE\u03C3\u03B5\u03B9\u03C2"}
          {(reservations.filter(r => r.status === "confirmed" || r.status === "pending").length + waitlist.length) > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold" style={{ background: "rgba(255,255,255,0.25)" }}>
              {reservations.filter(r => r.status === "confirmed" || r.status === "pending").length + waitlist.length}
            </span>
          )}
        </button>
        <button
          onClick={() => router.push("/order?takeaway=1")}
          className="flex-1 rounded-xl h-9 text-sm font-bold transition-colors flex items-center justify-center gap-1.5 active:opacity-70"
          style={{ background: "var(--c-surface2)", color: "#f59e0b" }}
        >
          {"\uD83D\uDECD\uFE0F"} Takeaway
        </button>
      </div>

      {/* ROW 2: Section pills + view icons — only in tables tab, non-keypad */}
      {pageTab === "tables" && viewMode !== "keypad" && (
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 border-b shrink-0"
          style={{ background: "var(--c-bg)", borderColor: "var(--c-border)" }}
        >
          {/* Section pills — scrollable */}
          <div className="flex-1 flex gap-1.5 overflow-x-auto min-w-0">
            {[{ id: "all", name: "\u038C\u03BB\u03B1" }, ...sections.filter((sec) => tables.some((t) => t.floor_section_id === sec.id))].map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`shrink-0 rounded-full px-3 h-8 text-xs font-semibold transition-colors ${
                  activeSection === s.id ? "bg-brand text-white" : "active:opacity-70"
                }`}
                style={activeSection !== s.id ? { background: "var(--c-surface2)", color: "var(--c-text2)" } : {}}
              >
                {decodeUnicodeEscapes(s.name)}
              </button>
            ))}
          </div>
          {/* View toggle icons — right side: keypad (#) and open tables list */}
          <div className="flex gap-1 shrink-0 ml-1" style={{ borderLeft: "1px solid var(--c-border)", paddingLeft: 6 }}>
            <button
              onClick={() => setViewMode("keypad")}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black transition-colors active:opacity-70"
              style={{ background: "var(--c-surface2)", color: "var(--c-text2)" }}
              aria-label="Keypad"
            >
              #
            </button>
            <button
              onClick={() => { setViewMode("list"); void fetchAllOpenOrders(); }}
              className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs transition-colors ${
                viewMode === "list" ? "bg-brand text-white" : "active:opacity-70"
              }`}
              style={viewMode !== "list" ? { background: "var(--c-surface2)", color: "var(--c-text2)" } : {}}
              aria-label="Open tables list"
            >
              {"\uD83D\uDCCB"}
            </button>
          </div>
        </div>
      )}

      {/* ROW 2 alt: Back to grid button when in keypad mode */}
      {pageTab === "tables" && viewMode === "keypad" && (
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 border-b shrink-0"
          style={{ background: "var(--c-bg)", borderColor: "var(--c-border)" }}
        >
          <button
            onClick={() => setViewMode("map")}
            className="rounded-full px-3 h-8 text-xs font-semibold flex items-center gap-1.5 transition-colors active:opacity-70"
            style={{ background: "var(--c-surface2)", color: "var(--c-text2)" }}
          >
            {"\uD83C\uDF7D\uFE0F"} {"\u03A4\u03C1\u03B1\u03C0\u03AD\u03B6\u03B9\u03B1"}
          </button>
          <button
            onClick={() => { setViewMode("list"); void fetchAllOpenOrders(); }}
            className="rounded-full px-3 h-8 text-xs font-semibold flex items-center gap-1.5 transition-colors active:opacity-70"
            style={{ background: "var(--c-surface2)", color: "var(--c-text2)" }}
          >
            {"\uD83D\uDCCB"} {"\u0391\u03BD\u03BF\u03B9\u03C7\u03C4\u03AC"}
          </button>
          <span className="flex-1" />
          <span
            className="rounded-full px-3 h-8 text-xs font-bold flex items-center"
            style={{ background: "var(--brand, #3B82F6)", color: "#fff" }}
          >
            # Keypad
          </span>
        </div>
      )}

      {/* ============ TABLES TAB ============ */}
      {pageTab === "tables" && (
        <>
          {/* Assignment mode banner */}
          {(rsrvAssignMode || wlAssignMode) && (
            <div
              className="mx-4 mt-2 rounded-2xl px-4 py-3 flex items-center justify-between"
              style={{ background: "rgba(59,130,246,0.2)", border: "1px solid rgba(59,130,246,0.4)" }}
            >
              <span className="text-sm font-semibold" style={{ color: "#60a5fa" }}>
                {"\u0395\u03C0\u03B9\u03BB\u03AD\u03BE\u03C4\u03B5 \u03C4\u03C1\u03B1\u03C0\u03AD\u03B6\u03B9 \u03B3\u03B9\u03B1: "}{rsrvAssignMode ? selectedRsrv?.customer_name : selectedWl?.party_name}
              </span>
              <button
                onClick={() => { setRsrvAssignMode(false); setWlAssignMode(false); setSelectedRsrv(null); setSelectedWl(null); }}
                className="w-[60px] h-[40px] rounded-xl flex items-center justify-center text-sm font-bold transition-transform active:scale-90"
                style={{ background: "rgba(239,68,68,0.2)", color: "#f87171" }}
              >
                {"\u0391\u03BA\u03CD\u03C1\u03C9\u03C3\u03B7"}
              </button>
            </div>
          )}

          {/* ---- KEYPAD VIEW (PRIMARY) ---- */}
          {viewMode === "keypad" && (
            <div className="flex-1 flex overflow-hidden">
              {/* Main numpad area */}
              <div className="flex-1 flex flex-col p-3 gap-3">
                {/* Display: typed number + matched table info */}
                <div
                  className="rounded-2xl px-5 py-4 flex items-center gap-4"
                  style={{ background: "var(--c-surface)", border: "2px solid var(--c-border)" }}
                >
                  <span
                    className="text-4xl font-black leading-none flex-1"
                    style={{ color: keypadMatch ? "var(--brand, #3B82F6)" : keypadInput ? "var(--c-text)" : "var(--c-text3)" }}
                  >
                    {keypadInput || "0"}
                  </span>
                  {keypadMatch && (
                    <div className="flex flex-col items-end">
                      <span className="text-sm font-semibold" style={{ color: "var(--c-text2)" }}>
                        {keypadMatch.capacity} seats
                      </span>
                      <button
                        onClick={() => { setKeypadInput(""); }}
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs transition-transform active:scale-90"
                        style={{ background: "var(--c-surface2)", color: "var(--c-text3)" }}
                        aria-label="Καθαρισμός"
                      >
                        {"\u2715"}
                      </button>
                    </div>
                  )}
                  {!keypadMatch && keypadInput && (
                    <button
                      onClick={() => { setKeypadInput(""); }}
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs transition-transform active:scale-90"
                      style={{ background: "var(--c-surface2)", color: "var(--c-text3)" }}
                      aria-label="Καθαρισμός"
                    >
                      {"\u2715"}
                    </button>
                  )}
                </div>

                {/* Numpad grid — matching legacy POS layout */}
                <div className="flex-1 grid grid-cols-3 gap-2">
                  {["1","2","3","4","5","6","7","8","9","0","\u2190","C"].map((v) => (
                    <button
                      key={v}
                      onClick={() => v === "C" || v === "\u2190" ? handleKeypadNum(v) : handleKeypadNum(v)}
                      className="flex items-center justify-center transition-transform active:scale-90 rounded-xl"
                      style={{
                        fontSize: v === "\u2190" || v === "C" ? 20 : 28,
                        fontWeight: 700,
                        background: v === "C" ? "var(--c-surface2)" : "var(--c-surface)",
                        color: v === "C" ? "var(--c-text2)" : "var(--c-text)",
                        border: "2px solid var(--c-border)",
                        boxShadow: "var(--c-num-shadow)",
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>

                {/* GO button — full width, always active when input exists */}
                <button
                  onClick={handleKeypadGo}
                  disabled={!keypadInput.trim()}
                  className="w-full rounded-2xl h-16 text-xl font-black transition-transform active:scale-95 disabled:opacity-30"
                  style={{
                    background: keypadInput.trim() ? "var(--brand, #3B82F6)" : "var(--c-surface2)",
                    color: keypadInput.trim() ? "#fff" : "var(--c-text3)",
                  }}
                >
                  {keypadInput.trim() ? `\u2192 ${keypadMatch?.name || keypadInput.trim()}` : "\u0395\u03B9\u03C3\u03AC\u03B3\u03B5\u03C4\u03B5 \u03B1\u03C1\u03B9\u03B8\u03BC\u03CC"}
                </button>
              </div>

              {/* Right sidebar: letter buttons for sub-tables */}
              <div
                className="w-12 overflow-y-auto flex flex-col gap-1 py-2 pr-2"
                style={{ background: "var(--c-bg)" }}
              >
                {["A","B","C","D","E","F","G","H","I","J","K","L","M"].map((letter) => (
                  <button
                    key={letter}
                    onClick={() => setKeypadInput((p) => p + letter)}
                    className="w-10 h-9 rounded-lg flex items-center justify-center text-sm font-bold transition-transform active:scale-90"
                    style={{
                      background: "var(--c-surface)",
                      color: "var(--c-text2)",
                      border: "1px solid var(--c-border)",
                    }}
                  >
                    {letter}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ---- OPEN TABLES LIST VIEW (My tables + Others) ---- */}
          {viewMode === "list" && (
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {/* MY TABLES — from local DB */}
              {(() => {
                const myTables = tables
                  .filter((t) => orderTotals[t.id] && orderWaiters[t.id] === waiter?.name)
                  .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                return (
                  <>
                    <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--brand, #3B82F6)" }}>
                      {"\uD83D\uDC64 \u0394\u03B9\u03BA\u03AC \u03BC\u03BF\u03C5"} ({myTables.length})
                    </p>
                    {myTables.length === 0 ? (
                      <p className="text-xs mb-4 pl-2" style={{ color: "var(--c-text3)" }}>{"\u039A\u03B1\u03BD\u03AD\u03BD\u03B1 \u03B1\u03BD\u03BF\u03B9\u03C7\u03C4\u03CC \u03C4\u03C1\u03B1\u03C0\u03AD\u03B6\u03B9"}</p>
                    ) : (
                      myTables.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => openTable(t)}
                          className="w-full flex items-center gap-3 px-4 min-h-[56px] border-b transition-transform active:scale-[0.98] mb-0.5"
                          style={{ background: "var(--c-surface)", borderColor: "var(--c-border)" }}
                        >
                          <span className="text-base font-black min-w-[50px]" style={{ color: "var(--c-text)" }}>{t.name}</span>
                          <span className="flex-1" />
                          <span className="text-sm font-bold" style={{ color: "var(--brand, #3B82F6)" }}>
                            {(orderTotals[t.id] || 0).toFixed(2)}{"\u20AC"}
                          </span>
                          <span style={{ color: "var(--c-text3)" }}>{"\u203A"}</span>
                        </button>
                      ))
                    )}

                    {/* OTHERS — from Supabase kitchen_orders */}
                    {(() => {
                      const otherOrders = allOpenOrders.filter((o) => o.cashier_name !== waiter?.name);
                      if (otherOrders.length === 0) return null;
                      // Group by waiter
                      const byWaiter: Record<string, typeof otherOrders> = {};
                      for (const o of otherOrders) {
                        if (!byWaiter[o.cashier_name]) byWaiter[o.cashier_name] = [];
                        byWaiter[o.cashier_name].push(o);
                      }
                      return Object.entries(byWaiter).map(([waiterName, orders]) => (
                        <div key={waiterName} className="mt-4">
                          <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--c-text2)" }}>
                            {staffProfiles.find((p) => p.name === waiterName)?.icon || "\uD83D\uDC64"} {waiterName} ({orders.length})
                          </p>
                          {orders.map((o, idx) => (
                            <div
                              key={`${waiterName}-${idx}`}
                              className="flex items-center gap-3 px-4 min-h-[48px] border-b mb-0.5"
                              style={{ background: "var(--c-surface2)", borderColor: "var(--c-border)", borderRadius: 8 }}
                            >
                              <span className="text-sm font-bold min-w-[50px]" style={{ color: "var(--c-text)" }}>{o.table_name}</span>
                              <span className="text-xs" style={{ color: "var(--c-text3)" }}>{o.items_count} {"\u03C0\u03C1."}</span>
                              <span className="flex-1" />
                              <span className="text-sm font-semibold" style={{ color: "var(--c-text2)" }}>
                                {o.total.toFixed(2)}{"\u20AC"}
                              </span>
                            </div>
                          ))}
                        </div>
                      ));
                    })()}
                  </>
                );
              })()}
            </div>
          )}

          {/* ---- TABLES GRID VIEW (with pinch-to-zoom) ---- */}
          {viewMode === "map" && (
          <PinchZoomContainer className="flex-1 overflow-y-auto px-4 py-3">
            {syncing && tables.length === 0 && (
              <p className="text-center mt-10 text-sm" style={{ color: "var(--c-text3)" }}>{"\u03A3\u03C5\u03B3\u03C7\u03C1\u03BF\u03BD\u03B9\u03C3\u03BC\u03CC\u03C2..."}</p>
            )}
            {!syncing && filtered.length === 0 && (
              <div className="text-center mt-10">
                <p className="text-sm" style={{ color: "var(--c-text3)" }}>{"\u0394\u03B5\u03BD \u03B2\u03C1\u03AD\u03B8\u03B7\u03BA\u03B1\u03BD \u03C4\u03C1\u03B1\u03C0\u03AD\u03B6\u03B9\u03B1"}</p>
                {activeSection !== "all" && tables.length > 0 && (
                  <button
                    onClick={() => setActiveSection("all")}
                    className="mt-3 rounded-xl px-5 py-2.5 text-sm font-semibold transition-transform active:scale-95"
                    style={{ background: "var(--brand, #3B82F6)", color: "#fff" }}
                  >
                    {"\u0395\u03BC\u03C6\u03AC\u03BD\u03B9\u03C3\u03B7 \u03CC\u03BB\u03C9\u03BD"}
                  </button>
                )}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5">
              {filtered.map((t) => {
                const total = orderTotals[t.id];
                const minOk = !settings.minConsumptionEur || !total || total >= settings.minConsumptionEur;
                const isDark = theme === "dark" || theme === "grey";
                const st = getStatusStyle(t.status, isDark);
                const isPendingMove = pendingMoveTableId === t.id;
                const isDenied = moveDenied === t.id;
                const isOccupied = t.status === "occupied" || orderTotals[t.id] !== undefined;
                const isPendingBill = pendingBillTableId === t.id;
                const isBillFlash = billFlash?.tableId === t.id;
                const kitchenSt = kitchenStatus[t.name];
                const tblRsrv = tableReservationMap[t.id];
                const tblLate = tblRsrv ? isLate(tblRsrv) : false;
                return (
                  <button
                    key={t.id}
                    onClick={() => handleTableTap(t)}
                    onContextMenu={(e) => { e.preventDefault(); handleEmptyTableLongPress(t); }}
                    onTouchStart={(e) => {
                      const timer = setTimeout(() => handleEmptyTableLongPress(t), 500);
                      const el = e.currentTarget;
                      const cancel = () => { clearTimeout(timer); el.removeEventListener("touchend", cancel); el.removeEventListener("touchmove", cancel); };
                      el.addEventListener("touchend", cancel, { once: true });
                      el.addEventListener("touchmove", cancel, { once: true });
                    }}
                    className={`relative flex flex-col items-center justify-center rounded-md transition-all duration-200 active:scale-95 ${
                      (rsrvAssignMode || wlAssignMode) && !isOccupied ? "ring-2 ring-offset-1 ring-green-400 animate-pulse" : ""
                    }`}
                    style={{
                      minHeight: 72,
                      padding: "8px 4px",
                      background: tblLate ? (isDark ? "rgba(239,68,68,0.35)" : "rgba(239,68,68,0.18)") : st.bg,
                      border: `1.5px solid ${tblLate ? "#ef4444" : st.border}`,
                      boxShadow: tblLate
                        ? "0 0 12px rgba(239,68,68,0.5)"
                        : isDark
                          ? "0 1px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.03)"
                          : "0 1px 3px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.5)",
                      animation: tblLate ? "pulse 1.5s ease-in-out infinite" : undefined,
                    }}
                  >
                    {/* Status indicator dot — RSRV style with ring */}
                    <span
                      className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${st.dotCls}`}
                      style={{
                        backgroundColor: st.dot,
                        boxShadow: `0 0 0 1.5px ${isDark ? "#1a1a1a" : "#fff"}`,
                      }}
                    />

                    {!minOk && (
                      <span className="absolute top-0.5 left-0.5 text-[9px] text-amber-400 leading-none">{"\u26A0"}</span>
                    )}

                    {/* Move button — smaller, more subtle */}
                    {isOccupied && !isPendingMove && (
                      <button
                        className="absolute top-0.5 left-0.5 w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold transition-transform active:scale-90"
                        style={{ background: "rgba(245,158,11,0.25)", color: "#fbbf24" }}
                        onClick={(e) => { e.stopPropagation(); setMoveReqSource(t); }}
                        aria-label="Μετακίνηση τραπεζιού"
                      >
                        {"\u21C4"}
                      </button>
                    )}

                    {/* Bill flash feedback */}
                    {isBillFlash && billFlash && (
                      <div className="absolute inset-0 rounded-md flex flex-col items-center justify-center" style={{ background: billFlash.type === "processed" ? "rgba(22,163,74,0.7)" : "rgba(63,63,70,0.8)" }}>
                        <span className="text-sm leading-none">{billFlash.type === "processed" ? "\u2713" : "\u2715"}</span>
                        <span className="text-[9px] font-semibold mt-0.5" style={{ color: billFlash.type === "processed" ? "#86efac" : "#a1a1aa" }}>
                          {billFlash.type === "processed" ? "\u0395\u03BE\u03BF\u03C6\u03BB." : "\u0391\u03BA\u03C5\u03C1."}
                        </span>
                      </div>
                    )}

                    {/* Table number — RSRV typography */}
                    <span className="text-[13px] font-bold tracking-tight leading-none" style={{ color: st.text }}>
                      {t.name}
                    </span>

                    {/* Capacity — icon + number */}
                    <span className="flex items-center gap-0.5 mt-0.5">
                      <svg className="w-2.5 h-2.5" style={{ color: st.muted }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                      <span className="text-[10px] font-medium" style={{ color: st.muted }}>{t.capacity}</span>
                    </span>

                    {/* Reservation info on table */}
                    {tblRsrv && !isOccupied && (
                      <span
                        className="text-[10px] leading-none max-w-[80px] truncate font-semibold mt-0.5"
                        style={{ color: tblLate ? "#f87171" : "#60a5fa" }}
                      >
                        {lastName(tblRsrv.customer_name)} {tblRsrv.reservation_time.slice(0, 5)}
                      </span>
                    )}

                    {isOccupied && t.seated_customer_name && (
                      <span
                        className="text-xs leading-none max-w-[80px] truncate"
                        style={{ color: "var(--c-text2)" }}
                      >
                        {"\uD83D\uDC64 "}
                        {t.seated_customer_name.length > 16
                          ? t.seated_customer_name.slice(0, 16) + "\u2026"
                          : t.seated_customer_name}
                        {t.seated_covers ? ` \u00B7 ${t.seated_covers}p` : ""}
                      </span>
                    )}
                    {total !== undefined && (
                      <span
                        className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                        style={{ background: "rgba(0,0,0,0.25)", color: "var(--c-card-text)" }}
                      >
                        {total.toFixed(2)}{"\u20AC"}
                      </span>
                    )}
                    {/* Allergy / dietary badges */}
                    {((t.seated_allergies && t.seated_allergies.length > 0) || (t.seated_dietary && t.seated_dietary.length > 0)) && !isPendingMove && !isBillFlash && (
                      <span className="absolute bottom-1.5 left-8 flex items-center gap-1">
                        {t.seated_allergies && t.seated_allergies.length > 0 && (
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none"
                            style={{ background: "rgba(239,68,68,0.25)", color: "#fca5a5" }}
                          >
                            {"\u26A0 "}{t.seated_allergies.length}
                          </span>
                        )}
                        {t.seated_dietary && t.seated_dietary.length > 0 && (
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none"
                            style={{ background: "rgba(16,185,129,0.2)", color: "#6ee7b7" }}
                          >
                            {"\uD83C\uDF31"}
                          </span>
                        )}
                      </span>
                    )}

                    {/* Kitchen status — compact */}
                    {kitchenSt && !isPendingMove && !isBillFlash && (
                      <span className="absolute bottom-0.5 left-0.5 text-[10px] leading-none">
                        {kitchenSt === "done" ? "\u2705" : "\uD83C\uDF73"}
                      </span>
                    )}

                    {/* Order total badge */}
                    {total !== undefined && (
                      <span className="text-[9px] font-semibold mt-0.5 tracking-tight" style={{ color: st.muted }}>
                        {total.toFixed(2)}{"\u20AC"}
                      </span>
                    )}

                    {/* Bill pending */}
                    {isPendingBill && !isBillFlash && (
                      <span className="absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    )}

                    {/* Pending move overlay */}
                    {isPendingMove && (
                      <div className="absolute inset-0 bg-amber-900/70 rounded-md flex flex-col items-center justify-center">
                        <span className="text-lg leading-none">{"\u23F3"}</span>
                        <span className="text-[9px] font-semibold mt-0.5" style={{ color: "#fcd34d" }}>{"\u0391\u03BD\u03B1\u03BC\u03BF\u03BD\u03AE"}</span>
                      </div>
                    )}

                    {/* Denied overlay */}
                    {isDenied && (
                      <div className="absolute inset-0 bg-red-900/70 rounded-md flex flex-col items-center justify-center">
                        <span className="text-[10px] font-bold" style={{ color: "#fca5a5" }}>{"\u2717"}</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </PinchZoomContainer>
          )}
        </>
      )}

      {/* ============ RESERVATIONS + WAITLIST TAB (combined) ============ */}
      {pageTab === "reservations" && (
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {/* --- Reservations section --- */}
          {rsrvLoading && reservations.length === 0 && (
            <p className="text-center mt-6 text-sm" style={{ color: "var(--c-text3)" }}>{"\u03A6\u03CC\u03C1\u03C4\u03C9\u03C3\u03B7..."}</p>
          )}
          {!rsrvLoading && reservations.length === 0 && waitlist.length === 0 && (
            <p className="text-center mt-10 text-sm" style={{ color: "var(--c-text3)" }}>{"\u0394\u03B5\u03BD \u03C5\u03C0\u03AC\u03C1\u03C7\u03BF\u03C5\u03BD \u03BA\u03C1\u03B1\u03C4\u03AE\u03C3\u03B5\u03B9\u03C2 \u03C3\u03AE\u03BC\u03B5\u03C1\u03B1"}</p>
          )}
          {reservations.length > 0 && (
            <>
              <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--brand, #3B82F6)" }}>
                {"\uD83D\uDCCB \u039A\u03C1\u03B1\u03C4\u03AE\u03C3\u03B5\u03B9\u03C2"} ({reservations.filter(r => r.status === "confirmed" || r.status === "pending").length})
              </p>
              <div className="flex flex-col gap-2 mb-4">
                {reservations.map((r) => {
                  const sc = RSRV_STATUS_COLOR[r.status] ?? RSRV_STATUS_COLOR.completed;
                  const statusLabel: Record<string, string> = {
                    pending: "\u0395\u03BA\u03BA\u03C1\u03B5\u03BC\u03AE\u03C2",
                    confirmed: "\u0395\u03C0\u03B9\u03B2\u03B5\u03B2\u03B1\u03B9\u03C9\u03BC\u03AD\u03BD\u03B7",
                    seated: "\u039A\u03AC\u03B8\u03B9\u03C3\u03B5",
                    completed: "\u039F\u03BB\u03BF\u03BA\u03BB\u03B7\u03C1\u03CE\u03B8\u03B7\u03BA\u03B5",
                    cancelled: "\u0391\u03BA\u03C5\u03C1\u03CE\u03B8\u03B7\u03BA\u03B5",
                    no_show: "No-show",
                  };
                  return (
                    <button
                      key={r.id}
                      onClick={() => setSelectedRsrv(r)}
                      className="flex items-center justify-between rounded-2xl border px-4 py-3 min-h-[60px] transition-transform active:scale-[0.98]"
                      style={{ background: "var(--c-surface)", borderColor: "var(--c-border)" }}
                    >
                      <div className="flex flex-col items-start gap-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {r.source === "vip" && <span className="text-sm leading-none">{"\uD83D\uDC51"}</span>}
                          <span className="font-bold text-sm truncate" style={{ color: "var(--c-text)" }}>
                            {r.customer_name}
                          </span>
                          <span className="text-xs font-semibold" style={{ color: "var(--c-text2)" }}>
                            {r.party_size} {"\u03AC\u03C4."}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {r.customer_phone && (
                            <span className="text-xs" style={{ color: "var(--c-text3)" }}>{r.customer_phone}</span>
                          )}
                          {r.source && r.source !== "vip" && (
                            <span className="text-xs" style={{ color: "var(--c-text3)" }}>
                              {SOURCE_EMOJI[r.source] ?? r.source}
                            </span>
                          )}
                          {r.table_name && (
                            <span className="text-xs font-semibold" style={{ color: "#60a5fa" }}>
                              {"\u03A4\u03C1. "}{r.table_name}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
                        <span className="text-sm font-bold" style={{ color: "var(--c-text)" }}>
                          {r.reservation_time.slice(0, 5)}
                        </span>
                        <span
                          className="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
                          style={{ background: sc.bg, color: sc.text }}
                        >
                          {statusLabel[r.status] ?? r.status}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* --- Waitlist section (inline under reservations) --- */}
          <div className="mt-2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#fbbf24" }}>
                {"\u23F3 \u0391\u03BD\u03B1\u03BC\u03BF\u03BD\u03AE"} ({waitlist.length})
              </p>
              <button
                onClick={() => setShowAddWaitlist(true)}
                className="rounded-full px-3 h-7 text-xs font-bold flex items-center gap-1 transition-transform active:scale-95"
                style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa" }}
              >
                + {"\u03A0\u03C1\u03BF\u03C3\u03B8\u03AE\u03BA\u03B7"}
              </button>
            </div>
            {waitLoading && waitlist.length === 0 && (
              <p className="text-center py-4 text-sm" style={{ color: "var(--c-text3)" }}>{"\u03A6\u03CC\u03C1\u03C4\u03C9\u03C3\u03B7..."}</p>
            )}
            {!waitLoading && waitlist.length === 0 && (
              <p className="text-center py-4 text-sm" style={{ color: "var(--c-text3)" }}>{"\u039A\u03B5\u03BD\u03AE \u03BB\u03AF\u03C3\u03C4\u03B1 \u03B1\u03BD\u03B1\u03BC\u03BF\u03BD\u03AE\u03C2"}</p>
            )}
            <div className="flex flex-col gap-2">
              {waitlist.map((w) => (
                <button
                  key={w.id}
                  onClick={() => { setSelectedWl(w); setWlAssignMode(true); setPageTab("tables"); }}
                  className="flex items-center justify-between rounded-2xl border px-4 py-3 min-h-[56px] transition-transform active:scale-[0.98]"
                  style={{ background: "var(--c-surface)", borderColor: "var(--c-border)" }}
                >
                  <div className="flex flex-col items-start gap-1">
                    <span className="font-bold text-sm" style={{ color: "var(--c-text)" }}>{w.party_name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs" style={{ color: "var(--c-text2)" }}>{w.party_size} {"\u03AC\u03C4."}</span>
                      {w.phone && <span className="text-xs" style={{ color: "var(--c-text3)" }}>{w.phone}</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-xs font-semibold" style={{ color: "#fbbf24" }}>
                      {minutesAgo(w.created_at)} {"\u03BB\u03B5\u03C0\u03C4\u03AC"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ============ RESERVATION ACTION SHEET ============ */}
      {selectedRsrv && !rsrvAssignMode && (
        <div
          className="fixed inset-0 z-50 bg-black/60"
          onClick={() => setSelectedRsrv(null)}
        >
          <div
            className="fixed bottom-0 left-0 right-0 rounded-t-3xl overflow-y-auto"
            style={{ background: "var(--c-header)", maxHeight: "80vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ background: "var(--c-border)" }} />
            </div>
            {/* header */}
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--c-border)" }}>
              <div>
                <p className="font-bold text-base" style={{ color: "var(--c-text)" }}>
                  {selectedRsrv.source === "vip" && "\uD83D\uDC51 "}{selectedRsrv.customer_name}
                </p>
                <p className="text-sm" style={{ color: "var(--c-text2)" }}>
                  {selectedRsrv.party_size} {"\u03AC\u03C4\u03BF\u03BC\u03B1"} {"\u00B7"} {selectedRsrv.reservation_time.slice(0, 5)}
                </p>
              </div>
              <button
                className="w-10 h-10 flex items-center justify-center rounded-xl transition-opacity active:opacity-50"
                style={{ color: "var(--c-text2)" }}
                onClick={() => setSelectedRsrv(null)}
                aria-label="Κλείσιμο"
              >{"\u2715"}</button>
            </div>
            {/* Info box */}
            <div className="px-4 py-3 flex flex-col gap-2">
              {selectedRsrv.customer_phone && (
                <div className="flex items-center gap-2">
                  <span className="text-sm" style={{ color: "var(--c-text3)" }}>{"\uD83D\uDCDE"}</span>
                  <a href={`tel:${selectedRsrv.customer_phone}`} className="text-sm font-medium" style={{ color: "#60a5fa" }}>
                    {selectedRsrv.customer_phone}
                  </a>
                </div>
              )}
              {selectedRsrv.dietary_notes && (
                <div className="rounded-xl px-3 py-2" style={{ background: "rgba(16,185,129,0.1)" }}>
                  <span className="text-xs font-semibold" style={{ color: "#6ee7b7" }}>{"\uD83C\uDF31 "}{selectedRsrv.dietary_notes}</span>
                </div>
              )}
              {selectedRsrv.staff_notes && (
                <div className="rounded-xl px-3 py-2" style={{ background: "rgba(245,158,11,0.1)" }}>
                  <span className="text-xs font-semibold" style={{ color: "#fbbf24" }}>{"\uD83D\uDCDD "}{selectedRsrv.staff_notes}</span>
                </div>
              )}
              {selectedRsrv.has_children && (
                <div className="rounded-xl px-3 py-2" style={{ background: "rgba(59,130,246,0.1)" }}>
                  <span className="text-xs font-semibold" style={{ color: "#60a5fa" }}>{"\uD83D\uDC76 \u039C\u03B5 \u03C0\u03B1\u03B9\u03B4\u03B9\u03AC"}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: "var(--c-text3)" }}>
                  {"\u0391\u03BD\u03B1\u03BC\u03B5\u03BD\u03CC\u03BC\u03B5\u03BD\u03B7 \u03B1\u03C0\u03BF\u03C7\u03CE\u03C1\u03B7\u03C3\u03B7: ~"}{(() => {
                    const [h, m] = selectedRsrv.reservation_time.split(":").map(Number);
                    const dep = new Date();
                    dep.setHours(h + 4, m, 0, 0);
                    return dep.toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit" });
                  })()}
                </span>
              </div>
              {selectedRsrv.table_name && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold" style={{ color: "#60a5fa" }}>{"\u03A4\u03C1\u03B1\u03C0\u03AD\u03B6\u03B9: "}{selectedRsrv.table_name}</span>
                </div>
              )}
            </div>
            {/* Action buttons */}
            <div className="px-4 pb-[calc(24px+env(safe-area-inset-bottom))] flex flex-col gap-2">
              {(selectedRsrv.status === "confirmed" || selectedRsrv.status === "pending") && (
                <button
                  onClick={() => void patchRsrvStatus(selectedRsrv.id, "seated")}
                  className="w-full min-h-[60px] rounded-2xl flex items-center justify-center gap-2 text-base font-bold transition-transform active:scale-95"
                  style={{ background: "rgba(34,197,94,0.2)", color: "#4ade80" }}
                >
                  {"\uD83D\uDFE2 \u0386\u03C6\u03B9\u03BE\u03B7"}
                </button>
              )}
              {(selectedRsrv.status === "confirmed" || selectedRsrv.status === "pending") && (
                <button
                  onClick={() => { setRsrvAssignMode(true); setPageTab("tables"); }}
                  className="w-full min-h-[60px] rounded-2xl flex items-center justify-center gap-2 text-base font-bold transition-transform active:scale-95"
                  style={{ background: "rgba(59,130,246,0.2)", color: "#60a5fa" }}
                >
                  {"\uD83D\uDD35 \u0391\u03BD\u03AC\u03B8\u03B5\u03C3\u03B7 \u03C4\u03C1\u03B1\u03C0\u03B5\u03B6\u03B9\u03BF\u03CD"}
                </button>
              )}
              {selectedRsrv.status === "seated" && (
                <button
                  onClick={() => void patchRsrvStatus(selectedRsrv.id, "completed")}
                  className="w-full min-h-[60px] rounded-2xl flex items-center justify-center gap-2 text-base font-bold transition-transform active:scale-95"
                  style={{ background: "rgba(245,158,11,0.2)", color: "#fbbf24" }}
                >
                  {"\uD83D\uDFE1 \u0391\u03C0\u03BF\u03C7\u03CE\u03C1\u03B7\u03C3\u03B5"}
                </button>
              )}
              {selectedRsrv.status !== "cancelled" && selectedRsrv.status !== "completed" && (
                <button
                  onClick={() => void patchRsrvStatus(selectedRsrv.id, "cancelled")}
                  className="w-full min-h-[60px] rounded-2xl flex items-center justify-center gap-2 text-base font-bold transition-transform active:scale-95"
                  style={{ background: "rgba(239,68,68,0.2)", color: "#f87171" }}
                >
                  {"\uD83D\uDD34 \u0391\u03BA\u03CD\u03C1\u03C9\u03C3\u03B7"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============ WALK-IN BOTTOM SHEET ============ */}
      {walkInTable && (
        <div
          className="fixed inset-0 z-50 bg-black/60"
          onClick={() => setWalkInTable(null)}
        >
          <div
            className="fixed bottom-0 left-0 right-0 rounded-t-3xl overflow-y-auto"
            style={{ background: "var(--c-header)", maxHeight: "85vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ background: "var(--c-border)" }} />
            </div>
            {/* header */}
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--c-border)" }}>
              <p className="font-bold text-base" style={{ color: "var(--c-text)" }}>
                {"\u0386\u03BD\u03BF\u03B9\u03B3\u03BC\u03B1 \u03C4\u03C1\u03B1\u03C0\u03B5\u03B6\u03B9\u03BF\u03CD "}{walkInTable.name}
              </p>
              <button
                className="w-10 h-10 flex items-center justify-center rounded-xl transition-opacity active:opacity-50"
                style={{ color: "var(--c-text2)" }}
                onClick={() => setWalkInTable(null)}
                aria-label="Κλείσιμο"
              >{"\u2715"}</button>
            </div>
            <div className="px-4 py-4 flex flex-col gap-4">
              {/* Party size stepper */}
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--c-text2)" }}>{"\u0386\u03C4\u03BF\u03BC\u03B1"}</label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setWiSize(Math.max(1, wiSize - 1))}
                    className="w-[60px] h-[60px] rounded-2xl flex items-center justify-center text-2xl font-bold transition-transform active:scale-90"
                    style={{ background: "var(--c-surface2)", color: "var(--c-text)" }}
                    aria-label="Λιγότερα άτομα"
                  >{"\u2212"}</button>
                  <span className="text-3xl font-black w-12 text-center" style={{ color: "var(--c-text)" }}>{wiSize}</span>
                  <button
                    onClick={() => setWiSize(wiSize + 1)}
                    className="w-[60px] h-[60px] rounded-2xl flex items-center justify-center text-2xl font-bold transition-transform active:scale-90"
                    style={{ background: "var(--c-surface2)", color: "var(--c-text)" }}
                    aria-label="Περισσότερα άτομα"
                  >+</button>
                </div>
              </div>
              {/* Name */}
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--c-text2)" }}>{"\u038C\u03BD\u03BF\u03BC\u03B1"}</label>
                <input
                  type="text"
                  value={wiName}
                  onChange={(e) => setWiName(e.target.value)}
                  placeholder="Walk-in"
                  className="w-full rounded-2xl px-4 py-3 text-base font-semibold outline-none"
                  style={{ background: "var(--c-surface2)", color: "var(--c-text)", border: "1.5px solid var(--c-border)" }}
                />
              </div>
              {/* Phone */}
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--c-text2)" }}>{"\u03A4\u03B7\u03BB\u03AD\u03C6\u03C9\u03BD\u03BF"}</label>
                <input
                  type="tel"
                  value={wiPhone}
                  onChange={(e) => setWiPhone(e.target.value)}
                  placeholder="\u03A0\u03C1\u03BF\u03B1\u03B9\u03C1\u03B5\u03C4\u03B9\u03BA\u03CC"
                  className="w-full rounded-2xl px-4 py-3 text-base font-semibold outline-none"
                  style={{ background: "var(--c-surface2)", color: "var(--c-text)", border: "1.5px solid var(--c-border)" }}
                />
              </div>
              {/* Sitting time pills */}
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--c-text2)" }}>{"\u03A7\u03C1\u03CC\u03BD\u03BF\u03C2 \u03BA\u03B1\u03B8\u03AF\u03C3\u03BC\u03B1\u03C4\u03BF\u03C2"}</label>
                <div className="flex gap-2 flex-wrap">
                  {SITTING_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => setWiSitting(opt.minutes)}
                      className={`rounded-full px-4 h-10 text-sm font-semibold transition-colors ${
                        wiSitting === opt.minutes ? "bg-brand text-white" : "active:opacity-70"
                      }`}
                      style={wiSitting !== opt.minutes ? { background: "var(--c-surface2)", color: "var(--c-text2)" } : {}}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Source selector */}
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--c-text2)" }}>{"\u03A0\u03B7\u03B3\u03AE"}</label>
                <div className="flex gap-2 overflow-x-auto">
                  {WALK_IN_SOURCES.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => setWiSource(s.key)}
                      className={`shrink-0 rounded-full px-4 h-10 text-sm font-semibold transition-colors flex items-center gap-1.5 ${
                        wiSource === s.key ? "bg-brand text-white" : "active:opacity-70"
                      }`}
                      style={wiSource !== s.key ? { background: "var(--c-surface2)", color: "var(--c-text2)" } : {}}
                    >
                      <span>{s.emoji}</span>
                      <span>{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* Submit button */}
              <button
                onClick={() => void submitWalkIn()}
                disabled={wiSubmitting}
                className="w-full min-h-[60px] rounded-2xl flex items-center justify-center gap-2 text-base font-bold transition-transform active:scale-95"
                style={{ background: wiSubmitting ? "rgba(34,197,94,0.1)" : "rgba(34,197,94,0.25)", color: "#4ade80" }}
              >
                {wiSubmitting ? "\u0391\u03BD\u03B1\u03BC\u03BF\u03BD\u03AE..." : "\u0386\u03BD\u03BF\u03B9\u03B3\u03BC\u03B1"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ ADD TO WAITLIST SHEET ============ */}
      {showAddWaitlist && (
        <div
          className="fixed inset-0 z-50 bg-black/60"
          onClick={() => setShowAddWaitlist(false)}
        >
          <div
            className="fixed bottom-0 left-0 right-0 rounded-t-3xl overflow-y-auto"
            style={{ background: "var(--c-header)", maxHeight: "70vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ background: "var(--c-border)" }} />
            </div>
            {/* header */}
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--c-border)" }}>
              <p className="font-bold text-base" style={{ color: "var(--c-text)" }}>{"\u03A0\u03C1\u03BF\u03C3\u03B8\u03AE\u03BA\u03B7 \u03C3\u03C4\u03B7\u03BD \u03B1\u03BD\u03B1\u03BC\u03BF\u03BD\u03AE"}</p>
              <button
                className="w-10 h-10 flex items-center justify-center rounded-xl transition-opacity active:opacity-50"
                style={{ color: "var(--c-text2)" }}
                onClick={() => setShowAddWaitlist(false)}
                aria-label="Κλείσιμο"
              >{"\u2715"}</button>
            </div>
            <div className="px-4 py-4 flex flex-col gap-4">
              {/* Name */}
              <input
                type="text"
                value={wlName}
                onChange={(e) => setWlName(e.target.value)}
                placeholder={"\u038C\u03BD\u03BF\u03BC\u03B1 *"}
                className="w-full rounded-2xl px-4 py-3 text-base font-semibold outline-none"
                style={{ background: "var(--c-surface2)", color: "var(--c-text)", border: "1.5px solid var(--c-border)" }}
              />
              {/* Party size stepper */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setWlSize(Math.max(1, wlSize - 1))}
                  className="w-[60px] h-[60px] rounded-2xl flex items-center justify-center text-2xl font-bold transition-transform active:scale-90"
                  style={{ background: "var(--c-surface2)", color: "var(--c-text)" }}
                  aria-label="Λιγότερα άτομα"
                >{"\u2212"}</button>
                <span className="text-3xl font-black w-12 text-center" style={{ color: "var(--c-text)" }}>{wlSize}</span>
                <button
                  onClick={() => setWlSize(wlSize + 1)}
                  className="w-[60px] h-[60px] rounded-2xl flex items-center justify-center text-2xl font-bold transition-transform active:scale-90"
                  style={{ background: "var(--c-surface2)", color: "var(--c-text)" }}
                  aria-label="Περισσότερα άτομα"
                >+</button>
              </div>
              {/* Phone */}
              <input
                type="tel"
                value={wlPhone}
                onChange={(e) => setWlPhone(e.target.value)}
                placeholder={"\u03A4\u03B7\u03BB\u03AD\u03C6\u03C9\u03BD\u03BF (\u03C0\u03C1\u03BF\u03B1\u03B9\u03C1\u03B5\u03C4\u03B9\u03BA\u03CC)"}
                className="w-full rounded-2xl px-4 py-3 text-base font-semibold outline-none"
                style={{ background: "var(--c-surface2)", color: "var(--c-text)", border: "1.5px solid var(--c-border)" }}
              />
              {/* Submit */}
              <button
                onClick={() => void addToWaitlist()}
                disabled={!wlName.trim()}
                className="w-full min-h-[60px] rounded-2xl flex items-center justify-center gap-2 text-base font-bold transition-transform active:scale-95"
                style={{
                  background: wlName.trim() ? "rgba(59,130,246,0.25)" : "rgba(59,130,246,0.1)",
                  color: wlName.trim() ? "#60a5fa" : "rgba(96,165,250,0.4)",
                }}
              >
                {"\u03A0\u03C1\u03BF\u03C3\u03B8\u03AE\u03BA\u03B7"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move destination bottom sheet */}
      {moveReqSource && (
        <div
          className="fixed inset-0 z-50 bg-black/60"
          onClick={() => setMoveReqSource(null)}
        >
          <div
            className="fixed bottom-0 left-0 right-0 rounded-t-3xl overflow-y-auto"
            style={{ background: "var(--c-header)", maxHeight: "80vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ background: "var(--c-border)" }} />
            </div>
            {/* header */}
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--c-border)" }}>
              <p className="font-bold text-base" style={{ color: "var(--c-text)" }}>
                {"\u039C\u03B5\u03C4\u03B1\u03C6\u03BF\u03C1\u03AC \u03B1\u03C0\u03CC "}{moveReqSource.name}
              </p>
              <button
                className="w-10 h-10 flex items-center justify-center rounded-xl transition-opacity active:opacity-50"
                style={{ color: "var(--c-text2)" }}
                onClick={() => setMoveReqSource(null)}
                aria-label="Κλείσιμο"
              >{"\u2715"}</button>
            </div>
            {/* table grid */}
            <div className="p-4 grid grid-cols-3 gap-3 sm:grid-cols-4 pb-[calc(32px+env(safe-area-inset-bottom))]">
              {tables
                .filter(t => t.id !== moveReqSource.id && t.is_active)
                .map(t => {
                  const isFree = !orderTotals[t.id];
                  return (
                    <button
                      key={t.id}
                      onClick={() => submitMoveRequest(moveReqSource, t)}
                      className="relative flex flex-col items-center justify-center gap-1 rounded-3xl border-2 min-h-[88px] px-2 py-3 transition-transform active:scale-90 duration-100"
                      style={{
                        background: isFree ? "#0D2818" : "#0D1B2E",
                        borderColor: isFree ? "#166534" : "#1E3A8A",
                      }}
                    >
                      <span className="text-xl font-black leading-none" style={{ color: "var(--c-card-text)" }}>
                        {t.name}
                      </span>
                      {orderTotals[t.id] !== undefined && (
                        <span className="text-[10px] font-semibold rounded-full px-2 py-0.5" style={{ background: "rgba(0,0,0,0.25)", color: "var(--c-card-text)" }}>
                          {orderTotals[t.id].toFixed(2)}{"\u20AC"}
                        </span>
                      )}
                      <span className="text-[10px]" style={{ color: isFree ? "#4ADE80" : "#60A5FA" }}>
                        {isFree ? "\u0395\u03BB\u03B5\u03CD\u03B8\u03B5\u03C1\u03BF" : "\u03A0\u03B9\u03B1\u03C3\u03BC\u03AD\u03BD\u03BF"}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* Staff message bottom sheet */}
      {showMessageSheet && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100 }}
          onClick={() => setShowMessageSheet(false)}
        >
          <div
            style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "var(--c-surface)", borderRadius: "20px 20px 0 0", padding: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ fontWeight: 700, marginBottom: 16, color: "var(--c-text)", fontSize: 16 }}>
              {"\uD83D\uDCAC \u039C\u03AE\u03BD\u03C5\u03BC\u03B1 \u03C3\u03C4\u03BF \u03C0\u03C1\u03BF\u03C3\u03C9\u03C0\u03B9\u03BA\u03CC"}
            </p>
            {/* Target chips — all active staff + boss + all */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {[
                { key: "all", label: "\uD83D\uDCE2 \u038C\u03BB\u03BF\u03B9" },
                { key: "boss", label: "\uD83D\uDC51 Boss" },
                ...staffProfiles.map((p) => ({ key: p.name.toLowerCase(), label: `${p.icon} ${p.name}` })),
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setMsgTarget(t.key)}
                  style={{
                    padding: "8px 14px", borderRadius: 20, border: "none",
                    background: msgTarget === t.key ? "#3b82f6" : "var(--c-surface2)",
                    color: msgTarget === t.key ? "#fff" : "var(--c-text2)",
                    fontWeight: 600, fontSize: 13, cursor: "pointer",
                    transition: "transform 0.1s",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <textarea
              value={msgBody}
              onChange={(e) => setMsgBody(e.target.value)}
              placeholder={"\u0393\u03C1\u03AC\u03C8\u03B5 \u03BC\u03AE\u03BD\u03C5\u03BC\u03B1..."}
              style={{
                width: "100%", background: "var(--c-surface2)", border: "none",
                borderRadius: 10, padding: 12, color: "var(--c-text)", fontSize: 14,
                minHeight: 80, resize: "none", boxSizing: "border-box",
              }}
            />
            <button
              onClick={async () => {
                if (!msgBody.trim() || !supabase) return;
                void supabase.from("pos_staff_messages").insert({
                  venue_id: waiter?.venue_id ?? "",
                  from_name: waiter?.name ?? "Waiter",
                  from_device_type: "waiter",
                  to_target: msgTarget,
                  body: msgBody.trim(),
                });
                setMsgBody("");
                setShowMessageSheet(false);
              }}
              style={{
                width: "100%", marginTop: 12, padding: "14px 0",
                background: "#3b82f6", color: "#fff", borderRadius: 12,
                border: "none", fontWeight: 700, fontSize: 15, cursor: "pointer",
              }}
            >
              {"\u0391\u03C0\u03BF\u03C3\u03C4\u03BF\u03BB\u03AE \u2192"}
            </button>
          </div>
        </div>
      )}

      {/* No-match bottom sheet: suggestions + split */}
      {showNoMatch && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowNoMatch(false); setSplitParent(null); } }}
          style={{ background: "rgba(0,0,0,0.5)" }}
        >
          <div
            className="rounded-t-3xl px-4 pt-5 pb-safe max-h-[80vh] overflow-y-auto"
            style={{
              background: "var(--c-surface)",
              borderTop: "1px solid var(--c-border)",
              animation: "slideUp 0.2s ease-out",
            }}
          >
            {!splitParent ? (
              <>
                {/* No match header */}
                <div className="text-center mb-4">
                  <p className="text-lg font-black" style={{ color: "var(--c-text)" }}>
                    {"\u26A0\uFE0F"} {"\u0394\u03B5\u03BD \u03B2\u03C1\u03AD\u03B8\u03B7\u03BA\u03B5"} "{noMatchQuery}"
                  </p>
                  <p className="text-sm mt-1" style={{ color: "var(--c-text2)" }}>
                    {"\u0395\u03C0\u03B9\u03BB\u03AD\u03BE\u03C4\u03B5 \u03C4\u03C1\u03B1\u03C0\u03AD\u03B6\u03B9 \u03AE \u03C3\u03C0\u03AC\u03C3\u03C4\u03B5 \u03AD\u03BD\u03B1 \u03C3\u03B5 \u03C5\u03C0\u03BF-\u03C4\u03C1\u03B1\u03C0\u03AD\u03B6\u03B9"}
                  </p>
                </div>

                {/* Available tables — scrollable grid, tap to open or long-press to split */}
                <div className="mb-4">
                  <p className="text-xs font-bold mb-2 uppercase tracking-wide" style={{ color: "var(--c-text3)" }}>
                    {"\u0395\u03C0\u03B9\u03BB\u03AD\u03BE\u03C4\u03B5 \u03C4\u03C1\u03B1\u03C0\u03AD\u03B6\u03B9:"} ({noMatchSuggestions.length})
                  </p>
                  <div className="grid grid-cols-5 gap-2 max-h-[40vh] overflow-y-auto rounded-xl p-1">
                    {noMatchSuggestions.map((t) => {
                      const st = getStatusStyle(t.status, theme === "dark" || theme === "grey");
                      return (
                        <button
                          key={t.id}
                          onClick={() => { openTable(t); setKeypadInput(""); setShowNoMatch(false); }}
                          onContextMenu={(e) => { e.preventDefault(); setSplitParent(t); }}
                          className="rounded-xl min-h-[56px] flex flex-col items-center justify-center gap-0.5 transition-transform active:scale-90"
                          style={{
                            background: st.bg,
                            border: `2px solid ${st.border}`,
                          }}
                        >
                          <span className="text-base font-black" style={{ color: "var(--c-card-text)" }}>{t.name}</span>
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ background: st.dot }}
                          />
                        </button>
                      );
                    })}
                  </div>
                  {noMatchSuggestions.length > 0 && (
                    <p className="text-[10px] mt-1.5 text-center" style={{ color: "var(--c-text3)" }}>
                      {"\u03A0\u03B1\u03C4\u03AE\u03C3\u03C4\u03B5 \u03C0\u03B1\u03C1\u03B1\u03C4\u03B5\u03C4\u03B1\u03BC\u03AD\u03BD\u03B1 \u03B3\u03B9\u03B1 split"}
                    </p>
                  )}
                </div>

                {/* Quick split shortcut — show only if there are numeric tables */}
                {tables.some((t) => /^\d+$/.test(t.name)) && (
                <div className="mb-4">
                  <button
                    onClick={() => {
                      // Find closest table to split
                      const num = parseInt(noMatchQuery);
                      const closest = !isNaN(num) ? tables
                        .filter((t) => /^\d+$/.test(t.name))
                        .sort((a, b) => Math.abs(parseInt(a.name) - num) - Math.abs(parseInt(b.name) - num))[0]
                        : null;
                      if (closest) setSplitParent(closest);
                    }}
                    className="w-full rounded-xl py-3 text-sm font-semibold transition-transform active:scale-95 flex items-center justify-center gap-2"
                    style={{ background: "var(--c-surface2)", color: "var(--c-text)", border: "1px solid var(--c-border)" }}
                  >
                    {"\u2702\uFE0F"} {"\u0394\u03B9\u03B1\u03C7\u03C9\u03C1\u03B9\u03C3\u03BC\u03CC\u03C2 \u03C4\u03C1\u03B1\u03C0\u03B5\u03B6\u03B9\u03BF\u03CD"}
                  </button>
                </div>
                )}

                <button
                  onClick={() => { setShowNoMatch(false); }}
                  className="w-full rounded-2xl py-4 font-bold text-sm transition-transform active:scale-95"
                  style={{ background: "rgba(239,68,68,0.1)", color: "#f87171" }}
                >
                  {"\u0391\u039A\u03A5\u03A1\u03A9\u03A3\u0397"}
                </button>
              </>
            ) : (
              <>
                {/* Split confirmation: pick sub-letter */}
                <div className="text-center mb-4">
                  <p className="text-lg font-black" style={{ color: "var(--c-text)" }}>
                    {"\u2702\uFE0F"} Split {splitParent.name}
                  </p>
                  <p className="text-sm mt-1" style={{ color: "var(--c-text2)" }}>
                    {"\u0395\u03C0\u03B9\u03BB\u03AD\u03BE\u03C4\u03B5 \u03C5\u03C0\u03BF-\u03C4\u03C1\u03B1\u03C0\u03AD\u03B6\u03B9:"}
                  </p>
                </div>

                <div className="grid grid-cols-4 gap-3 mb-4">
                  {["A","B","C","D","E","F","G","H"].map((letter) => {
                    const subName = `${splitParent.name}${letter}`;
                    const exists = tables.some((t) => t.name.toUpperCase() === subName.toUpperCase());
                    const isNext = letter === nextSubLetter(splitParent.name);
                    return (
                      <button
                        key={letter}
                        onClick={() => {
                          if (exists) {
                            const ex = tables.find((t) => t.name.toUpperCase() === subName.toUpperCase());
                            if (ex) { openTable(ex); setKeypadInput(""); setShowNoMatch(false); setSplitParent(null); }
                          } else {
                            void createSubTable(splitParent, letter);
                          }
                        }}
                        className="rounded-2xl py-4 flex flex-col items-center gap-1 transition-transform active:scale-90 border-2"
                        style={{
                          background: exists ? "var(--c-occ)" : isNext ? "rgba(59,130,246,0.15)" : "var(--c-surface2)",
                          borderColor: exists ? "var(--c-occ-b)" : isNext ? "var(--brand, #3B82F6)" : "var(--c-border)",
                          color: "var(--c-text)",
                        }}
                      >
                        <span className="text-xl font-black">{subName}</span>
                        <span className="text-[10px]" style={{ color: "var(--c-text2)" }}>
                          {exists ? "\u03A5\u03C0\u03AC\u03C1\u03C7\u03B5\u03B9" : isNext ? "\u0395\u03C0\u03CC\u03BC\u03B5\u03BD\u03BF" : "\u039D\u03AD\u03BF"}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={() => setSplitParent(null)}
                  className="w-full rounded-2xl py-4 font-bold text-sm transition-transform active:scale-95"
                  style={{ background: "var(--c-surface2)", color: "var(--c-text2)" }}
                >
                  {"\u2190 \u03A0\u03AF\u03C3\u03C9"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Check-in bottom sheet */}
      {showCheckin && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowCheckin(false); setCheckinScanning(false); } }}
          style={{ background: "rgba(0,0,0,0.5)" }}
        >
          <div
            className="rounded-t-3xl px-4 pt-5 pb-safe max-h-[85vh] overflow-y-auto"
            style={{ background: "var(--c-surface)", borderTop: "1px solid var(--c-border)", animation: "slideUp 0.2s ease-out" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <p className="text-lg font-black" style={{ color: "var(--c-text)" }}>
                {"\uD83D\uDCCB"} Check-in {"\u039A\u03C1\u03AC\u03C4\u03B7\u03C3\u03B7\u03C2"}
              </p>
              <button
                onClick={() => { setShowCheckin(false); setCheckinScanning(false); }}
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: "var(--c-surface2)", color: "var(--c-text3)" }}
                aria-label="\u039A\u03BB\u03B5\u03AF\u03C3\u03B9\u03BC\u03BF"
              >
                {"\u2715"}
              </button>
            </div>

            {/* QR scan toggle */}
            {!checkinScanning ? (
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setCheckinScanning(true)}
                  className="flex-1 rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2 transition-transform active:scale-95"
                  style={{ background: "var(--brand, #3B82F6)", color: "#fff" }}
                  aria-label="\u03A3\u03BA\u03B1\u03BD\u03AC\u03C1\u03B9\u03C3\u03BC\u03B1 QR"
                >
                  {"\uD83D\uDCF7"} {"\u03A3\u03BA\u03B1\u03BD\u03AC\u03C1\u03B9\u03C3\u03BC\u03B1 QR"}
                </button>
              </div>
            ) : (
              <div className="mb-4">
                <QRScanner onScan={handleCheckinQrScan} active={checkinScanning} />
                <button
                  onClick={() => setCheckinScanning(false)}
                  className="w-full mt-2 rounded-xl py-2 text-sm font-semibold"
                  style={{ background: "var(--c-surface2)", color: "var(--c-text2)" }}
                >
                  {"\u0391\u03BA\u03CD\u03C1\u03C9\u03C3\u03B7 \u03C3\u03BA\u03B1\u03BD\u03B1\u03C1\u03AF\u03C3\u03BC\u03B1\u03C4\u03BF\u03C2"}
                </button>
              </div>
            )}

            {/* Search input */}
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={checkinQuery}
                onChange={(e) => setCheckinQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void checkinSearch(checkinQuery); }}
                placeholder={"\u038C\u03BD\u03BF\u03BC\u03B1, \u03C4\u03B7\u03BB\u03AD\u03C6\u03C9\u03BD\u03BF, \u03AE \u03BA\u03C9\u03B4\u03B9\u03BA\u03CC\u03C2 RSRV..."}
                className="flex-1 rounded-xl px-4 py-3 text-sm outline-none"
                style={{ background: "var(--c-surface2)", color: "var(--c-text)", border: "1.5px solid var(--c-border)" }}
              />
              <button
                onClick={() => void checkinSearch(checkinQuery)}
                disabled={!checkinQuery.trim() || checkinLoading}
                className="rounded-xl px-5 py-3 text-sm font-bold transition-transform active:scale-95 disabled:opacity-40"
                style={{ background: "var(--brand, #3B82F6)", color: "#fff" }}
                aria-label="\u0391\u03BD\u03B1\u03B6\u03AE\u03C4\u03B7\u03C3\u03B7"
              >
                {checkinLoading ? "..." : "\uD83D\uDD0D"}
              </button>
            </div>

            {/* Results */}
            {checkinResults.length > 0 && (
              <div className="space-y-2 mb-4">
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--c-text3)" }}>
                  {"\u0392\u03C1\u03AD\u03B8\u03B7\u03BA\u03B1\u03BD"} {checkinResults.length} {"\u03BA\u03C1\u03B1\u03C4\u03AE\u03C3\u03B5\u03B9\u03C2"}
                </p>
                {checkinResults.map((rsrv) => (
                  <div
                    key={rsrv.id}
                    className="rounded-2xl px-4 py-3"
                    style={{ background: "var(--c-surface2)", border: "1px solid var(--c-border)" }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="font-bold text-sm" style={{ color: "var(--c-text)" }}>{rsrv.customer_name}</p>
                        <p className="text-xs" style={{ color: "var(--c-text2)" }}>
                          {rsrv.reservation_time?.slice(0, 5)} {"\u00B7"} {rsrv.party_size} {"\u03AC\u03C4\u03BF\u03BC\u03B1"}
                          {rsrv.customer_phone && ` \u00B7 ${rsrv.customer_phone}`}
                        </p>
                      </div>
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                        style={{
                          background: rsrv.status === "confirmed" ? "rgba(59,130,246,0.2)" : rsrv.status === "seated" ? "rgba(34,197,94,0.2)" : "rgba(245,158,11,0.2)",
                          color: rsrv.status === "confirmed" ? "#60a5fa" : rsrv.status === "seated" ? "#22c55e" : "#f59e0b",
                        }}
                      >
                        {rsrv.status === "confirmed" ? "\u0395\u03C0\u03B9\u03B2\u03B5\u03B2\u03B1\u03B9\u03C9\u03BC\u03AD\u03BD\u03B7" : rsrv.status === "seated" ? "\u039A\u03B1\u03B8\u03B9\u03C3\u03BC\u03AD\u03BD\u03BF\u03B9" : rsrv.status}
                      </span>
                    </div>
                    {rsrv.status !== "seated" && rsrv.status !== "completed" && rsrv.status !== "cancelled" && (
                      <div className="flex gap-2 mt-2">
                        {/* Quick seat to assigned table */}
                        {rsrv.table_id && (
                          <button
                            onClick={() => {
                              const tbl = tables.find((t) => t.id === rsrv.table_id) || tables.find((t) => t.name === rsrv.table_name);
                              if (tbl) void seatReservation(rsrv, tbl);
                            }}
                            className="flex-1 rounded-xl py-2.5 text-sm font-bold transition-transform active:scale-95"
                            style={{ background: "var(--brand, #3B82F6)", color: "#fff" }}
                          >
                            {"\u2713"} Seat {"\u2192"} {rsrv.table_name || "?"}
                          </button>
                        )}
                        {/* Pick table to seat */}
                        {!rsrv.table_id && (
                          <button
                            onClick={() => {
                              setSelectedRsrv(rsrv);
                              setRsrvAssignMode(true);
                              setShowCheckin(false);
                            }}
                            className="flex-1 rounded-xl py-2.5 text-sm font-bold transition-transform active:scale-95"
                            style={{ background: "rgba(59,130,246,0.15)", color: "var(--brand, #3B82F6)", border: "1px solid var(--brand, #3B82F6)" }}
                          >
                            {"\u0395\u03C0\u03B9\u03BB\u03BF\u03B3\u03AE \u03C4\u03C1\u03B1\u03C0\u03B5\u03B6\u03B9\u03BF\u03CD"}
                          </button>
                        )}
                      </div>
                    )}
                    {rsrv.status === "seated" && (
                      <p className="text-xs mt-1 font-semibold" style={{ color: "#22c55e" }}>
                        {"\u2713 \u0397\u03B4\u03B7 \u03BA\u03B1\u03B8\u03B9\u03C3\u03BC\u03AD\u03BD\u03BF\u03B9"}
                        {rsrv.table_name && ` — ${rsrv.table_name}`}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {checkinResults.length === 0 && checkinQuery && !checkinLoading && (
              <p className="text-center text-sm py-4" style={{ color: "var(--c-text3)" }}>
                {"\u0394\u03B5\u03BD \u03B2\u03C1\u03AD\u03B8\u03B7\u03BA\u03B5 \u03BA\u03C1\u03AC\u03C4\u03B7\u03C3\u03B7 \u03B3\u03B9\u03B1"} "{checkinQuery}"
              </p>
            )}
          </div>
        </div>
      )}

      {/* Sync error toast */}
      {syncError && (
        <div style={{
          position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)",
          background: "#ef4444", color: "#fff", padding: "10px 20px",
          borderRadius: 12, fontWeight: 700, fontSize: 13, zIndex: 9999,
          boxShadow: "0 4px 20px rgba(0,0,0,0.4)", maxWidth: "90vw", textAlign: "center",
        }}>
          {"\u26A0\uFE0F"} {syncError}
        </div>
      )}

      {/* Incoming staff message toast */}
      {incomingMsg && (
        <div style={{
          position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)",
          background: "#f59e0b", color: "#000", padding: "10px 20px",
          borderRadius: 12, fontWeight: 700, fontSize: 14, zIndex: 9999,
          boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          whiteSpace: "nowrap",
        }}>
          {"\uD83D\uDCAC"} {incomingMsg.from}: {incomingMsg.body}
        </div>
      )}
    </div>
  );
}

function WalletSvg() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <rect x="2" y="6" width="20" height="14" rx="2" />
      <path strokeLinecap="round" d="M2 10h20" />
      <circle cx="17" cy="15" r="1.5" fill="currentColor" />
    </svg>
  );
}

function GearSvg() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
