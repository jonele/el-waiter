"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { waiterDb } from "@/lib/waiterDb";
import { useWaiterStore } from "@/store/waiterStore";
import { supabase } from "@/lib/supabase";
import BottomNav from "@/components/BottomNav";
import type { DbTable, DbFloorSection, DbOrder } from "@/lib/waiterDb";
import type { Theme } from "@/store/waiterStore";
import type { BillRequest } from "@/lib/supabase";

const STATUS_BG: Record<string, { bg: string; border: string; dot: string; dotCls: string }> = {
  free:     { bg: "var(--c-free)",  border: "var(--c-free-b)",  dot: "var(--status-free-dot, #4ade80)",  dotCls: "animate-pulse" },
  occupied: { bg: "var(--c-occ)",   border: "var(--c-occ-b)",   dot: "var(--status-occ-dot, #60a5fa)",   dotCls: "" },
  waiting:  { bg: "var(--c-wait)",  border: "var(--c-wait-b)",  dot: "var(--status-wait-dot, #fbbf24)",  dotCls: "animate-pulse-fast" },
};

const THEME_CYCLE: Theme[] = ["dark", "grey", "light"];
const THEME_ICON: Record<Theme, string> = { dark: "🌙", grey: "🌫", light: "☀️" };

export default function TablesPage() {
  const router = useRouter();
  const { waiter, settings, isOnline, pendingSyncs, theme, setTheme } = useWaiterStore();
  const [sections, setSections] = useState<DbFloorSection[]>([]);
  const [tables, setTables] = useState<DbTable[]>([]);
  const [orderTotals, setOrderTotals] = useState<Record<string, number>>({});
  const [activeSection, setActiveSection] = useState<string>("all");
  const [syncing, setSyncing] = useState(false);
  const [tableSearch, setTableSearch] = useState("");

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

  useEffect(() => {
    if (!waiter) { router.replace("/"); return; }
    loadLocal();
    if (isOnline) {
      syncFromSupabase();
      fetchKitchenOrders();
    }
  }, [waiter, waiter!.venue_id]);

  // Cleanup bill subscription on unmount
  useEffect(() => {
    return () => {
      if (supabase) void supabase.removeAllChannels();
    };
  }, []);

  async function loadLocal() {
    const [secs, tbls, orders] = await Promise.all([
      waiterDb.floorSections.where("venue_id").equals(waiter!.venue_id).sortBy("sort_order"),
      waiterDb.posTables.where("venue_id").equals(waiter!.venue_id).sortBy("sort_order"),
      waiterDb.orders.where("status").anyOf(["open", "sent"]).toArray(),
    ]);
    setSections(secs);
    setTables(tbls.filter((t) => t.is_active));
    const totals: Record<string, number> = {};
    for (const o of orders) totals[o.table_id] = (totals[o.table_id] || 0) + o.total;
    setOrderTotals(totals);
  }

  async function syncFromSupabase() {
    if (!supabase || !waiter!.venue_id) return;
    setSyncing(true);
    try {
      const [{ data: secs }, { data: tbls }] = await Promise.all([
        supabase.from("pos_floor_sections").select("*").eq("venue_id", waiter!.venue_id),
        supabase.from("pos_tables").select("*").eq("venue_id", waiter!.venue_id),
      ]);
      if (secs) {
        await waiterDb.floorSections.bulkPut(secs.map((s) => ({
          id: s.id, venue_id: s.venue_id, name: s.name,
          sort_order: s.sort_order ?? 0, is_active: s.is_active ?? true,
        })));
      }
      if (tbls) {
        await waiterDb.posTables.bulkPut(tbls.map((t) => ({
          id: t.id, venue_id: t.venue_id, name: t.name,
          floor_section_id: t.floor_section_id, capacity: t.capacity ?? 4,
          status: t.status ?? "free", sort_order: t.sort_order ?? 0,
          is_active: t.is_active ?? true,
        })));
      }
      loadLocal();
    } catch {}
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
    // Keep only the latest order per tab_name
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
    if (pendingBillTableId === t.id) return; // already pending
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
          // Move all open/sent orders from `from` table to `to` table in Dexie
          const orders = await waiterDb.orders
            .where("table_id").equals(from.id)
            .filter((o: DbOrder) => o.status === "open" || o.status === "sent")
            .toArray();
          for (const o of orders) {
            await waiterDb.orders.update(o.id, { table_id: to.id, table_name: to.name });
          }
          await waiterDb.posTables.update(from.id, { status: "free" });
          await waiterDb.posTables.update(to.id, { status: "occupied" });
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

  const filtered = tables
    .filter((t) => activeSection === "all" || t.floor_section_id === activeSection)
    .filter((t) => !tableSearch || t.name.toLowerCase().includes(tableSearch.toLowerCase()));

  // Jump directly to table if exact match
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

  function cycleTheme() {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length];
    setTheme(next);
  }

  return (
    <div className="flex h-screen flex-col" style={{ background: "var(--c-bg)" }}>

      {/* Header */}
      <div
        className="pt-safe sticky top-0 z-30 backdrop-blur-md border-b px-4 py-3 flex items-center justify-between"
        style={{ background: "var(--c-header)", borderColor: "var(--c-border)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-2xl shrink-0"
            style={{ background: "var(--c-surface2)" }}
          >
            {waiter?.icon || "👤"}
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-semibold text-sm" style={{ color: "var(--c-text)" }}>{waiter?.name}</span>
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-green-400 animate-pulse" : "bg-red-500"}`} />
              <span className="text-[10px]" style={{ color: "var(--c-text2)" }}>
                {isOnline ? "Συνδεδεμένος" : "Εκτός σύνδεσης"}
              </span>
            </div>
          </div>
          {pendingSyncs > 0 && (
            <span className="rounded-full bg-amber-500/20 text-amber-400 text-xs px-2 py-0.5 font-semibold">
              {pendingSyncs} εκκρεμή
            </span>
          )}
        </div>

        <div className="flex items-center -mr-2">
          {/* Theme toggle */}
          <button
            onClick={cycleTheme}
            className="flex items-center justify-center w-[60px] h-[60px] text-xl transition-transform active:scale-90"
            aria-label="Αλλαγή θέματος"
          >
            {THEME_ICON[theme]}
          </button>
          <button
            onClick={() => router.push("/wallet")}
            className="flex items-center justify-center w-[60px] h-[60px] transition-colors active:opacity-60"
            style={{ color: "var(--c-text2)" }}
            aria-label="Πορτοφόλι"
          >
            <WalletSvg />
          </button>
          <button
            onClick={() => router.push("/settings")}
            className="flex items-center justify-center w-[60px] h-[60px] transition-colors active:opacity-60"
            style={{ color: "var(--c-text2)" }}
            aria-label="Ρυθμίσεις"
          >
            <GearSvg />
          </button>
        </div>
      </div>

      {/* Section tabs */}
      {sections.length > 0 && (
        <div
          className="flex gap-2 overflow-x-auto px-4 py-2.5 border-b shrink-0"
          style={{ background: "var(--c-bg)", borderColor: "var(--c-border)" }}
        >
          {[{ id: "all", name: "Όλα" }, ...sections].map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`shrink-0 rounded-full px-4 h-10 text-sm font-medium transition-colors ${
                activeSection === s.id ? "bg-brand text-white" : "active:opacity-70"
              }`}
              style={activeSection !== s.id ? { background: "var(--c-surface2)", color: "var(--c-text2)" } : {}}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Table number search bar */}
      <div className="px-4 pt-3 pb-1 shrink-0">
        <input
          type="text"
          inputMode="numeric"
          value={tableSearch}
          onChange={(e) => setTableSearch(e.target.value)}
          onKeyDown={handleTableSearchKey}
          placeholder="Αριθμός τραπεζιού..."
          className="w-full rounded-2xl px-4 py-3 text-base font-semibold outline-none"
          style={{
            background: "var(--c-surface2)",
            color: "var(--c-text)",
            border: `1.5px solid ${tableSearch ? "var(--brand, #3B82F6)" : "var(--c-border)"}`,
          }}
        />
      </div>

      {/* Tables grid */}
      <div className="flex-1 overflow-y-auto px-4 py-3 pb-[calc(80px+env(safe-area-inset-bottom))]">
        {syncing && tables.length === 0 && (
          <p className="text-center mt-10 text-sm" style={{ color: "var(--c-text3)" }}>Συγχρονισμός...</p>
        )}
        {!syncing && filtered.length === 0 && (
          <p className="text-center mt-10 text-sm" style={{ color: "var(--c-text3)" }}>Δεν βρέθηκαν τραπέζια</p>
        )}
        <div className="grid grid-cols-3 gap-3">
          {filtered.map((t) => {
            const total = orderTotals[t.id];
            const minOk = !settings.minConsumptionEur || !total || total >= settings.minConsumptionEur;
            const st = STATUS_BG[t.status] ?? STATUS_BG.free;
            const isPendingMove = pendingMoveTableId === t.id;
            const isDenied = moveDenied === t.id;
            const isOccupied = t.status === "occupied" || orderTotals[t.id] !== undefined;
            const isPendingBill = pendingBillTableId === t.id;
            const isBillFlash = billFlash?.tableId === t.id;
            const kitchenSt = kitchenStatus[t.name];
            return (
              <button
                key={t.id}
                onClick={() => openTable(t)}
                className="relative flex flex-col items-center justify-center gap-1 rounded-3xl border-2 min-h-[96px] px-2 py-4 transition-transform active:scale-90 duration-100"
                style={{ background: st.bg, borderColor: st.border }}
              >
                {/* Status dot — hide on occupied when bill button shown */}
                {!isOccupied && (
                  <span
                    className={`absolute top-2.5 right-2.5 h-2.5 w-2.5 rounded-full ${st.dotCls}`}
                    style={{ background: st.dot }}
                  />
                )}
                {!minOk && (
                  <span className="absolute top-2 left-2 text-xs text-amber-400 leading-none">⚠</span>
                )}

                {/* Move button — only on occupied tables that are not pending */}
                {isOccupied && !isPendingMove && (
                  <button
                    className="absolute top-1.5 left-1.5 w-9 h-9 rounded-xl flex items-center justify-center text-base font-bold transition-transform active:scale-90"
                    style={{ background: "rgba(245,158,11,0.25)", color: "#fbbf24" }}
                    onClick={(e) => { e.stopPropagation(); setMoveReqSource(t); }}
                  >
                    ⇄
                  </button>
                )}

                {/* Bill request button — top-right, only on occupied tables */}
                {isOccupied && !isPendingMove && !isBillFlash && (
                  <button
                    className="absolute top-1.5 right-1.5 w-9 h-9 rounded-xl flex items-center justify-center text-base transition-transform active:scale-90"
                    style={{
                      background: isPendingBill ? "rgba(245,158,11,0.35)" : "rgba(255,255,255,0.12)",
                      color: isPendingBill ? "#fbbf24" : "var(--c-card-text)",
                    }}
                    onClick={(e) => { e.stopPropagation(); void submitBillRequest(t); }}
                    aria-label="Αίτημα λογαριασμού"
                  >
                    💳
                  </button>
                )}

                {/* Bill pending badge */}
                {isPendingBill && !isBillFlash && (
                  <span className="absolute bottom-1.5 right-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none"
                    style={{ background: "rgba(245,158,11,0.3)", color: "#fbbf24" }}>
                    Ζητήθηκε
                  </span>
                )}

                {/* Bill flash feedback */}
                {isBillFlash && billFlash && (
                  <div className={`absolute inset-0 rounded-3xl flex flex-col items-center justify-center ${billFlash.type === "processed" ? "bg-green-900/70" : "bg-zinc-800/80"}`}>
                    <span className="text-lg leading-none">{billFlash.type === "processed" ? "✓" : "✕"}</span>
                    <span className="text-xs font-semibold mt-1" style={{ color: billFlash.type === "processed" ? "#86efac" : "#a1a1aa" }}>
                      {billFlash.type === "processed" ? "Εξοφλήθηκε" : "Ακυρώθηκε"}
                    </span>
                  </div>
                )}

                {/* Kitchen status badge */}
                {kitchenSt && !isPendingMove && !isBillFlash && (
                  <span
                    className="absolute bottom-1.5 left-1.5 text-sm leading-none"
                    title={kitchenSt === "done" ? "Έτοιμο" : "Στην κουζίνα"}
                  >
                    {kitchenSt === "done" ? "✅" : "🍳"}
                  </span>
                )}

                <span className="text-2xl font-black leading-none" style={{ color: "var(--c-card-text)" }}>
                  {t.name}
                </span>
                {total !== undefined && (
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                    style={{ background: "rgba(0,0,0,0.25)", color: "var(--c-card-text)" }}
                  >
                    {total.toFixed(2)}€
                  </span>
                )}

                {/* Pending move overlay */}
                {isPendingMove && (
                  <div className="absolute inset-0 bg-amber-900/70 rounded-3xl flex flex-col items-center justify-center">
                    <span className="text-2xl leading-none">⏳</span>
                    <span className="text-xs font-semibold mt-1" style={{ color: "#fcd34d" }}>Αναμένεται...</span>
                  </div>
                )}

                {/* Denied overlay */}
                {isDenied && (
                  <div className="absolute inset-0 bg-red-900/70 rounded-3xl flex flex-col items-center justify-center">
                    <span className="text-sm font-bold" style={{ color: "#fca5a5" }}>✗ Απορρίφθηκε</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

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
                Μεταφορά από {moveReqSource.name}
              </p>
              <button
                className="w-10 h-10 flex items-center justify-center rounded-xl transition-opacity active:opacity-50"
                style={{ color: "var(--c-text2)" }}
                onClick={() => setMoveReqSource(null)}
              >✕</button>
            </div>
            {/* table grid — exclude source table, show all other active tables */}
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
                          {orderTotals[t.id].toFixed(2)}€
                        </span>
                      )}
                      <span className="text-[10px]" style={{ color: isFree ? "#4ADE80" : "#60A5FA" }}>
                        {isFree ? "Ελεύθερο" : "Πιασμένο"}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      <BottomNav />
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
