"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { waiterDb } from "@/lib/waiterDb";
import { useWaiterStore } from "@/store/waiterStore";
import { supabase } from "@/lib/supabase";
import BottomNav from "@/components/BottomNav";
import type { DbTable, DbFloorSection } from "@/lib/waiterDb";

const CARD_BG: Record<string, string> = {
  free:     "bg-emerald-950 border-emerald-800/30",
  occupied: "bg-blue-950 border-blue-800/30",
  waiting:  "bg-amber-950 border-amber-800/30",
};

const DOT_CLASS: Record<string, string> = {
  free:     "bg-green-400 animate-pulse",
  occupied: "bg-blue-400",
  waiting:  "bg-amber-400 animate-pulse-fast",
};

export default function TablesPage() {
  const router = useRouter();
  const { waiter, settings, isOnline, pendingSyncs } = useWaiterStore();
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
      waiterDb.orders.where("status").anyOf(["open", "sent"]).toArray(),
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
      <div className="pt-safe sticky top-0 z-30 bg-gray-900/85 backdrop-blur-md border-b border-white/5 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-950 flex items-center justify-center text-2xl shrink-0">
            {waiter?.icon || "👤"}
          </div>
          <div className="flex flex-col leading-tight">
            <span className="font-semibold text-white text-sm">{waiter?.name}</span>
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-green-400 animate-pulse" : "bg-red-500"}`} />
              <span className="text-[10px] text-gray-500">
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

        {/* Right actions — wallet + settings as large touch targets */}
        <div className="flex items-center -mr-2">
          <button
            onClick={() => router.push("/wallet")}
            className="flex items-center justify-center w-[60px] h-[60px] text-gray-400 active:text-white transition-colors"
            aria-label="Πορτοφόλι"
          >
            <WalletSvg />
          </button>
          <button
            onClick={() => router.push("/settings")}
            className="flex items-center justify-center w-[60px] h-[60px] text-gray-400 active:text-white transition-colors"
            aria-label="Ρυθμίσεις"
          >
            <GearSvg />
          </button>
        </div>
      </div>

      {/* Section tabs */}
      {sections.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 py-2.5 bg-gray-950 border-b border-white/5 shrink-0">
          {[{ id: "all", name: "Όλα" }, ...sections].map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`shrink-0 rounded-full px-4 h-10 text-sm font-medium transition-colors
                ${activeSection === s.id
                  ? "bg-brand text-white"
                  : "bg-gray-800/70 text-gray-400 active:bg-gray-700"}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Tables grid */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-[calc(80px+env(safe-area-inset-bottom))]">
        {syncing && tables.length === 0 && (
          <p className="text-center text-gray-600 mt-10 text-sm">Συγχρονισμός...</p>
        )}
        {!syncing && filtered.length === 0 && (
          <p className="text-center text-gray-600 mt-10 text-sm">Δεν βρέθηκαν τραπέζια</p>
        )}
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {filtered.map((t) => {
            const total = orderTotals[t.id];
            const minOk = !settings.minConsumptionEur || !total || total >= settings.minConsumptionEur;
            const cardBg = CARD_BG[t.status] ?? CARD_BG.free;
            const dotCls = DOT_CLASS[t.status] ?? DOT_CLASS.free;
            return (
              <button
                key={t.id}
                onClick={() => openTable(t)}
                className={`relative flex flex-col items-center justify-center gap-1 rounded-3xl border-2 min-h-[96px] px-2 py-4
                  transition-transform active:scale-90 duration-100 ${cardBg}`}
              >
                {/* Status dot */}
                <span className={`absolute top-2.5 right-2.5 h-2.5 w-2.5 rounded-full ${dotCls}`} />

                {/* Min consumption warning */}
                {!minOk && (
                  <span className="absolute top-2 left-2 text-xs leading-none">⚠</span>
                )}

                {/* Table name */}
                <span className="text-2xl font-black text-white leading-none">{t.name}</span>

                {/* Amount badge */}
                {total !== undefined && (
                  <span className="rounded-full bg-black/30 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                    {total.toFixed(2)}€
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

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
