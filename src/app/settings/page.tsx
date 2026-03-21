"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWaiterStore } from "@/store/waiterStore";
import { supabase, endShift } from "@/lib/supabase";
import { waiterDb } from "@/lib/waiterDb";
import type { Theme } from "@/store/waiterStore";

const THEMES: { key: Theme; label: string; icon: string }[] = [
  { key: "dark",  label: "Σκοτεινό",  icon: "🌙" },
  { key: "grey",  label: "Γκρίζο",    icon: "🌫" },
  { key: "light", label: "Φωτεινό",   icon: "☀️" },
  { key: "beach", label: "Παραλία",   icon: "🏖️" },
];

export default function SettingsPage() {
  const router = useRouter();
  const { waiter, settings, updateSettings, isOnline, pendingSyncs, failedSyncs, lastSyncedAt, theme, setTheme, logout, deviceVenueId, currentShiftId } = useWaiterStore();
  const [form, setForm] = useState(settings);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  useEffect(() => { setForm(settings); }, [settings]);

  function save() {
    updateSettings(form);
    router.back();
  }

  async function syncAll() {
    const venueId = deviceVenueId || waiter?.venue_id;
    if (!supabase || !venueId) { setSyncMsg("Η συσκευή δεν έχει ρυθμιστεί. Επέστρεψε στην αρχική σελίδα."); return; }
    setSyncing(true);
    setSyncMsg("");
    try {
      const [{ data: secs }, { data: tbls }, { data: cats }, { data: itms }, { data: waiters }] = await Promise.all([
        supabase.from("pos_floor_sections").select("*").eq("venue_id", venueId),
        supabase.from("pos_tables").select("*").eq("venue_id", venueId),
        supabase.from("menu_categories").select("*").eq("venue_id", venueId).eq("is_active", true),
        supabase.from("menu_items").select("*").eq("venue_id", venueId).eq("is_active", true),
        supabase.from("waiter_profiles").select("*").eq("venue_id", venueId).eq("active", true),
      ]);
      if (secs) await waiterDb.floorSections.bulkPut(secs.map((s) => ({
        id: s.id, venue_id: s.venue_id, name: s.name,
        sort_order: s.sort_order ?? 0, is_active: s.is_active ?? true,
      })));
      if (tbls) await waiterDb.posTables.bulkPut(tbls.map((t) => ({
        id: t.id, venue_id: t.venue_id, name: t.name, floor_section_id: t.floor_section_id,
        capacity: t.capacity ?? 4, status: t.status ?? "free",
        sort_order: t.sort_order ?? 0, is_active: t.is_active ?? true,
      })));
      if (cats) await waiterDb.menuCategories.bulkPut(cats);
      if (itms) await waiterDb.menuItems.bulkPut(itms);
      if (waiters) await waiterDb.waiterProfiles.bulkPut(waiters.map((w) => ({
        id: w.id, venue_id: w.venue_id, name: w.name, icon: w.icon ?? "👤",
        color: w.color ?? "#1E3A5F", pin: w.pin, active: w.active ?? true,
        sort_order: w.sort_order ?? 0,
      })));
      setSyncMsg(`Επιτυχία! ${tbls?.length ?? 0} τραπέζια, ${cats?.length ?? 0} κατηγορίες, ${itms?.length ?? 0} προϊόντα, ${waiters?.length ?? 0} σερβιτόροι.`);
    } catch {
      setSyncMsg("Σφάλμα συγχρονισμού. Ελέγξτε τη σύνδεσή σας.");
    }
    setSyncing(false);
  }

  async function clearData() {
    if (!confirm("Να διαγραφούν τα τοπικά δεδομένα;")) return;
    await Promise.all([
      waiterDb.waiterProfiles.clear(),
      waiterDb.floorSections.clear(),
      waiterDb.posTables.clear(),
      waiterDb.menuCategories.clear(),
      waiterDb.menuItems.clear(),
    ]);
    setSyncMsg("Δεδομένα διαγράφηκαν.");
  }

  async function handleLogout() {
    if (currentShiftId) await endShift(currentShiftId);
    logout();
    router.replace("/");
  }

  return (
    <div className="flex h-screen flex-col" style={{ background: "var(--c-bg)" }}>

      {/* Header */}
      <div
        className="pt-safe sticky top-0 z-30 backdrop-blur-md border-b px-4 py-3 flex items-center gap-3"
        style={{ background: "var(--c-header)", borderColor: "var(--c-border)" }}
      >
        <button
          onClick={() => router.back()}
          className="flex items-center justify-center w-[60px] h-[60px] -ml-3 transition-opacity active:opacity-50"
          style={{ color: "var(--c-text2)" }}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <p className="font-bold text-lg" style={{ color: "var(--c-text)" }}>Ρυθμίσεις</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5 pb-safe">

        {/* Wallet shortcut */}
        <button
          onClick={() => router.push("/wallet")}
          className="w-full rounded-2xl px-4 py-4 flex items-center justify-between transition-transform active:scale-[0.98]"
          style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)" }}
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">💰</span>
            <div>
              <p className="font-semibold text-sm" style={{ color: "var(--c-text)" }}>Πορτοφόλι</p>
              <p className="text-xs" style={{ color: "var(--c-text2)" }}>Στατιστικά & κέρδη βάρδιας</p>
            </div>
          </div>
          <span style={{ color: "var(--c-text3)" }}>›</span>
        </button>

        {/* Divider */}
        <div style={{ height: 1, background: "var(--c-border)" }} />

        {/* Theme selector */}
        <div className="space-y-2">
          <label className="text-sm font-semibold" style={{ color: "var(--c-text2)" }}>Θέμα εφαρμογής</label>
          <div className="grid grid-cols-4 gap-2">
            {THEMES.map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setTheme(key)}
                className="flex flex-col items-center justify-center gap-1.5 rounded-2xl py-4 text-sm font-semibold transition-all active:scale-95 border-2"
                style={{
                  background: theme === key ? "var(--c-surface2)" : "var(--c-surface)",
                  borderColor: theme === key ? "var(--brand, #3B82F6)" : "var(--c-border)",
                  color: theme === key ? "#3B82F6" : "var(--c-text2)",
                }}
              >
                <span className="text-2xl">{icon}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "var(--c-border)" }} />

        {/* Bridge URL */}
        <div className="space-y-1">
          <label className="text-sm font-medium" style={{ color: "var(--c-text2)" }}>Bridge URL (LAN)</label>
          <input
            value={form.bridgeUrl}
            onChange={(e) => setForm({ ...form, bridgeUrl: e.target.value.trim() })}
            placeholder="http://192.168.1.X:8088"
            className="w-full rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: "var(--c-surface2)", color: "var(--c-text)" }}
          />
        </div>

        {/* Min consumption */}
        <div className="space-y-1">
          <label className="text-sm font-medium" style={{ color: "var(--c-text2)" }}>Ελάχιστη κατανάλωση (€)</label>
          <input
            type="number"
            inputMode="decimal"
            value={form.minConsumptionEur || ""}
            onChange={(e) => setForm({ ...form, minConsumptionEur: parseFloat(e.target.value) || 0 })}
            placeholder="0 = απενεργοποιημένο"
            className="w-full rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: "var(--c-surface2)", color: "var(--c-text)" }}
          />
        </div>

        {/* Bluetooth toggle */}
        <div
          className="flex items-center justify-between rounded-2xl px-4 py-4"
          style={{ background: "var(--c-surface)" }}
        >
          <div>
            <p className="font-medium text-sm" style={{ color: "var(--c-text)" }}>Bluetooth πληρωμές</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--c-text2)" }}>Fallback αν δεν υπάρχει LAN</p>
          </div>
          <button
            onClick={() => setForm({ ...form, btEnabled: !form.btEnabled })}
            className={`relative h-7 w-12 rounded-full transition-colors touch-btn ${form.btEnabled ? "bg-brand" : ""}`}
            style={!form.btEnabled ? { background: "var(--c-surface2)" } : {}}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform shadow ${form.btEnabled ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>

        {/* Sync status */}
        <div
          className="rounded-2xl px-4 py-4 space-y-3"
          style={{ background: "var(--c-surface)" }}
        >
          <div className="flex items-center justify-between">
            <p className="font-medium text-sm" style={{ color: "var(--c-text)" }}>Κατάσταση σύνδεσης</p>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${isOnline ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
              <span className="text-sm" style={{ color: "var(--c-text2)" }}>{isOnline ? "Online" : "Offline"}</span>
            </div>
          </div>
          {pendingSyncs > 0 && (
            <p className="text-amber-400 text-sm">{pendingSyncs} εκκρεμείς παραγγελίες</p>
          )}
          {failedSyncs > 0 && (
            <p className="text-red-400 text-sm">{failedSyncs} αποτυχημένες (dead queue)</p>
          )}
          {lastSyncedAt && (
            <p className="text-xs" style={{ color: "var(--c-text2)" }}>
              Τελ. συγχρονισμός: {new Date(lastSyncedAt).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
          )}
          {syncMsg && (
            <p className={`text-sm ${syncMsg.startsWith("Σφάλμα") ? "text-red-400" : "text-green-400"}`}>{syncMsg}</p>
          )}
          <button
            onClick={syncAll}
            disabled={syncing || !isOnline}
            className="w-full rounded-xl py-3 font-semibold text-sm touch-btn disabled:opacity-40 border border-brand/40 text-brand"
            style={{ background: "rgba(59,130,246,0.08)" }}
          >
            {syncing ? "Συγχρονισμός..." : "Συγχρονισμός δεδομένων"}
          </button>
          <button
            onClick={clearData}
            className="w-full rounded-xl py-3 font-semibold text-sm touch-btn text-red-400 border border-red-500/20"
            style={{ background: "rgba(239,68,68,0.06)" }}
          >
            Διαγραφή τοπικών δεδομένων
          </button>
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-full rounded-2xl py-4 font-bold text-sm touch-btn text-red-400 border border-red-500/20 active:scale-95 transition-transform"
          style={{ background: "rgba(239,68,68,0.06)" }}
        >
          Αποσύνδεση
        </button>
      </div>

      {/* Save button */}
      <div
        className="border-t px-4 py-3 pb-safe"
        style={{ background: "var(--c-surface)", borderColor: "var(--c-border)" }}
      >
        <button
          onClick={save}
          className="w-full rounded-2xl bg-brand h-14 font-black text-white text-lg touch-btn active:scale-[0.97] transition-transform"
        >
          Αποθήκευση
        </button>
      </div>
    </div>
  );
}
