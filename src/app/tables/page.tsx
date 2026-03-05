"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { waiterDb } from "@/lib/waiterDb";
import { useWaiterStore } from "@/store/waiterStore";
import { supabase } from "@/lib/supabase";
import type { DbTable, DbFloorSection, DbOrder } from "@/lib/waiterDb";

const STATUS_LABEL: Record<string, string> = {
  free: "Ελεύθερο",
  occupied: "Κατειλημμένο",
  waiting: "Αναμονή",
};

const STATUS_COLOR: Record<string, string> = {
  free: "bg-status-free border-status-free/30",
  occupied: "bg-status-occupied border-status-occupied/30",
  waiting: "bg-status-waiting border-status-waiting/30",
};

export default function TablesPage() {
  const router = useRouter();
  const { waiter, settings, isOnline, pendingSyncs, logout } = useWaiterStore();
  const [sections, setSections] = useState<DbFloorSection[]>([]);
  const [tables, setTables] = useState<DbTable[]>([]);
  const [orderTotals, setOrderTotals] = useState<Record<string, number>>({});
  const [activeSection, setActiveSection] = useState<string>("all");
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!waiter) { router.replace("/"); return; }
    loadLocal();
    if (isOnline) syncFromSupabase();
  }, [waiter, settings.venueId]);

  async function loadLocal() {
    const [secs, tbls, orders] = await Promise.all([
      waiterDb.floorSections.where("venue_id").equals(settings.venueId).sortBy("sort_order"),
      waiterDb.posTables.where("venue_id").equals(settings.venueId).sortBy("sort_order"),
      waiterDb.orders.where("status").anyOf(["open","sent"]).toArray(),
    ]);
    setSections(secs);
    setTables(tbls.filter((t) => t.is_active));
    const totals: Record<string, number> = {};
    for (const o of orders) totals[o.table_id] = (totals[o.table_id] || 0) + o.total;
    setOrderTotals(totals);
  }

  async function syncFromSupabase() {
    if (!supabase || !settings.venueId) return;
    setSyncing(true);
    try {
      const [{ data: secs }, { data: tbls }] = await Promise.all([
        supabase.from("pos_floor_sections").select("*").eq("venue_id", settings.venueId),
        supabase.from("pos_tables").select("*").eq("venue_id", settings.venueId),
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

  const filtered = activeSection === "all"
    ? tables
    : tables.filter((t) => t.floor_section_id === activeSection);

  function openTable(t: DbTable) {
    useWaiterStore.getState().setActiveTable(t);
    router.push("/order");
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="pt-safe bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">{waiter?.icon || "👤"}</span>
          <span className="font-semibold text-white">{waiter?.name}</span>
          {pendingSyncs > 0 && (
            <span className="rounded-full bg-yellow-500/20 text-yellow-400 text-xs px-2 py-0.5">
              {pendingSyncs} εκκρεμή
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${isOnline ? "bg-green-500" : "bg-red-500"}`} />
          <button
            onClick={() => router.push("/settings")}
            className="text-gray-400 p-2 touch-btn"
            aria-label="Ρυθμίσεις"
          >
            ⚙️
          </button>
          <button
            onClick={() => { logout(); router.replace("/"); }}
            className="text-gray-400 text-sm px-2 py-1 touch-btn"
          >
            Αποσύνδεση
          </button>
        </div>
      </div>

      {/* Section tabs */}
      {sections.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 py-2 bg-gray-900/50 border-b border-gray-800">
          <button
            onClick={() => setActiveSection("all")}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium touch-btn transition-colors
              ${activeSection === "all" ? "bg-brand text-white" : "bg-gray-800 text-gray-400"}`}
          >
            Όλα
          </button>
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium touch-btn transition-colors
                ${activeSection === s.id ? "bg-brand text-white" : "bg-gray-800 text-gray-400"}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Tables grid */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {syncing && tables.length === 0 && (
          <p className="text-center text-gray-500 mt-10">Συγχρονισμός...</p>
        )}
        {!syncing && filtered.length === 0 && (
          <p className="text-center text-gray-500 mt-10">Δεν βρέθηκαν τραπέζια</p>
        )}
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 pb-safe">
          {filtered.map((t) => {
            const total = orderTotals[t.id];
            const minOk = !settings.minConsumptionEur || !total || total >= settings.minConsumptionEur;
            return (
              <button
                key={t.id}
                onClick={() => openTable(t)}
                className={`relative flex flex-col items-center justify-center gap-1 rounded-2xl border-2 p-4 touch-btn
                  transition-transform active:scale-95 ${STATUS_COLOR[t.status] || STATUS_COLOR.free}`}
              >
                <span className="text-lg font-bold text-white leading-none">{t.name}</span>
                <span className="text-xs text-gray-300">{STATUS_LABEL[t.status]}</span>
                {total !== undefined && (
                  <span className="text-xs font-semibold text-white mt-1">{total.toFixed(2)}€</span>
                )}
                {!minOk && (
                  <span className="absolute -top-1 -right-1 text-base" title="Ελάχιστη κατανάλωση">⚠️</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
