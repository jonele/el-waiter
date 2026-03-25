"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWaiterStore } from "@/store/waiterStore";
import { supabase, endShift } from "@/lib/supabase";
import { waiterDb } from "@/lib/waiterDb";
import { getLog, getLogText, clearLog, onLogChange } from "@/lib/debugLog";
import type { Theme } from "@/store/waiterStore";

const THEMES: { key: Theme; label: string; icon: string }[] = [
  { key: "dark",  label: "Σκοτεινό",  icon: "🌙" },
  { key: "grey",  label: "Γκρίζο",    icon: "🌫" },
  { key: "light", label: "Φωτεινό",   icon: "☀️" },
  { key: "beach", label: "Παραλία",   icon: "🏖️" },
];

export default function SettingsPage() {
  const router = useRouter();
  const { waiter, settings, updateSettings, isOnline, pendingSyncs, failedSyncs, lastSyncedAt, theme, setTheme, logout, deviceVenueId, currentShiftId, demoMode, setDemoMode } = useWaiterStore();
  // Guard against corrupted/missing settings from localStorage hydration
  const safeSettings = settings ?? { bridgeUrl: "http://192.168.0.10:8088", btEnabled: false, minConsumptionEur: 0 };
  const [form, setForm] = useState(safeSettings);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [logEntries, setLogEntries] = useState(getLog());

  useEffect(() => onLogChange(() => setLogEntries(getLog())), []);

  useEffect(() => { setForm(settings ?? { bridgeUrl: "http://192.168.0.10:8088", btEnabled: false, minConsumptionEur: 0 }); }, [settings]);

  function save() {
    updateSettings(form);
    router.back();
  }

  async function syncAll() {
    const venueId = deviceVenueId || waiter?.venue_id;
    if (!supabase || !venueId) { setSyncMsg("\u274C \u0397 \u03C3\u03C5\u03C3\u03BA\u03B5\u03C5\u03AE \u03B4\u03B5\u03BD \u03AD\u03C7\u03B5\u03B9 \u03C1\u03C5\u03B8\u03BC\u03B9\u03C3\u03C4\u03B5\u03AF."); return; }
    setSyncing(true);
    setSyncMsg("\u23F3 \u039B\u03AE\u03C8\u03B7 \u03B4\u03B5\u03B4\u03BF\u03BC\u03AD\u03BD\u03C9\u03BD...");
    try {
      setSyncMsg("\u23F3 \u039B\u03AE\u03C8\u03B7 \u03C4\u03BC\u03B7\u03BC\u03AC\u03C4\u03C9\u03BD...");
      const { data: secs } = await supabase.from("pos_floor_sections").select("*").eq("venue_id", venueId);
      if (secs) await waiterDb.floorSections.bulkPut(secs.map((s) => ({
        id: s.id, venue_id: s.venue_id, name: s.name,
        sort_order: s.sort_order ?? 0, is_active: s.is_active ?? true,
      })));

      setSyncMsg(`\u23F3 \u039B\u03AE\u03C8\u03B7 \u03C4\u03C1\u03B1\u03C0\u03B5\u03B6\u03B9\u03CE\u03BD... (${secs?.length ?? 0} \u03C4\u03BC\u03AE\u03BC\u03B1\u03C4\u03B1)`);
      const { data: tbls } = await supabase.from("pos_tables").select("*").eq("venue_id", venueId);
      if (tbls) await waiterDb.posTables.bulkPut(tbls.map((t) => ({
        id: t.id, venue_id: t.venue_id, name: t.name, floor_section_id: t.floor_section_id,
        capacity: t.capacity ?? 4, status: t.status ?? "free",
        sort_order: t.sort_order ?? 0, is_active: t.is_active ?? true,
      })));

      setSyncMsg(`\u23F3 \u039B\u03AE\u03C8\u03B7 \u03BC\u03B5\u03BD\u03BF\u03CD... (${tbls?.length ?? 0} \u03C4\u03C1\u03B1\u03C0\u03AD\u03B6\u03B9\u03B1)`);
      const { data: cats } = await supabase.from("menu_categories").select("*").eq("venue_id", venueId).eq("is_active", true);
      if (cats) await waiterDb.menuCategories.bulkPut(cats);

      setSyncMsg(`\u23F3 \u039B\u03AE\u03C8\u03B7 \u03C0\u03C1\u03BF\u03CA\u03CC\u03BD\u03C4\u03C9\u03BD... (${cats?.length ?? 0} \u03BA\u03B1\u03C4\u03B7\u03B3\u03BF\u03C1\u03AF\u03B5\u03C2)`);
      const { data: itms } = await supabase.from("menu_items").select("*").eq("venue_id", venueId).eq("is_active", true);
      if (itms) await waiterDb.menuItems.bulkPut(itms);

      setSyncMsg(`\u23F3 \u039B\u03AE\u03C8\u03B7 \u03C0\u03C1\u03BF\u03C3\u03C9\u03C0\u03B9\u03BA\u03BF\u03CD... (${itms?.length ?? 0} \u03C0\u03C1\u03BF\u03CA\u03CC\u03BD\u03C4\u03B1)`);
      const { data: waiters } = await supabase.from("waiter_profiles").select("*").eq("venue_id", venueId).eq("active", true);
      if (waiters) await waiterDb.waiterProfiles.bulkPut(waiters.map((w) => ({
        id: w.id, venue_id: w.venue_id, name: w.name, icon: w.icon ?? "\uD83D\uDC64",
        color: w.color ?? "#1E3A5F", pin: w.pin, active: w.active ?? true,
        sort_order: w.sort_order ?? 0,
      })));

      setSyncMsg(`\u2705 \u0395\u03C0\u03B9\u03C4\u03C5\u03C7\u03AF\u03B1! ${secs?.length ?? 0} \u03C4\u03BC\u03AE\u03BC\u03B1\u03C4\u03B1, ${tbls?.length ?? 0} \u03C4\u03C1\u03B1\u03C0\u03AD\u03B6\u03B9\u03B1, ${cats?.length ?? 0} \u03BA\u03B1\u03C4\u03B7\u03B3\u03BF\u03C1\u03AF\u03B5\u03C2, ${itms?.length ?? 0} \u03C0\u03C1\u03BF\u03CA\u03CC\u03BD\u03C4\u03B1, ${waiters?.length ?? 0} \u03C3\u03B5\u03C1\u03B2\u03B9\u03C4\u03CC\u03C1\u03BF\u03B9.`);
    } catch (err) {
      setSyncMsg(`\u274C \u03A3\u03C6\u03AC\u03BB\u03BC\u03B1: ${err instanceof Error ? err.message : "\u0395\u03BB\u03AD\u03B3\u03BE\u03C4\u03B5 \u03C3\u03CD\u03BD\u03B4\u03B5\u03C3\u03B7"}`);
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
          aria-label="Πίσω"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <p className="font-bold text-lg" style={{ color: "var(--c-text)" }}>Ρυθμίσεις</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5 pb-safe">

        {/* Demo mode toggle */}
        <div
          className="flex items-center justify-between rounded-2xl px-4 py-4"
          style={{
            background: demoMode ? "rgba(245,158,11,0.1)" : "var(--c-surface)",
            border: demoMode ? "2px solid rgba(245,158,11,0.4)" : "1px solid var(--c-border)",
          }}
        >
          <div>
            <p className="font-semibold text-sm" style={{ color: "var(--c-text)" }}>
              {demoMode ? "\uD83C\uDFAD Demo Mode" : "\uD83D\uDD34 Live Mode"}
            </p>
            <p className="text-xs mt-0.5" style={{ color: demoMode ? "#f59e0b" : "#22c55e" }}>
              {demoMode ? "Viva/ΑΑΔΕ απενεργοποιημένα — ασφαλές για δοκιμές" : "Ζωντανές πληρωμές + φορολογικά ενεργά"}
            </p>
          </div>
          <button
            onClick={() => setDemoMode(!demoMode)}
            className={`relative h-7 w-12 rounded-full transition-colors touch-btn ${!demoMode ? "bg-red-500" : ""}`}
            style={demoMode ? { background: "#f59e0b" } : {}}
            aria-label="Εναλλαγή demo mode"
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform shadow ${!demoMode ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "var(--c-border)" }} />

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
            aria-label="Εναλλαγή Bluetooth"
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

        {/* Debug Log */}
        <div className="rounded-2xl px-4 py-4 space-y-2" style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)" }}>
          <button onClick={() => setShowLog(!showLog)} className="flex items-center justify-between w-full">
            <p className="font-medium text-sm" style={{ color: "var(--c-text)" }}>Debug Log ({logEntries.length})</p>
            <span className="text-xs" style={{ color: "var(--c-text3)" }}>{showLog ? "Hide" : "Show"}</span>
          </button>
          {showLog && (
            <>
              <div className="flex gap-2">
                <button onClick={() => { void navigator.clipboard.writeText(getLogText()); setSyncMsg("Log copied!"); setTimeout(() => setSyncMsg(""), 2000); }}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold" style={{ background: "var(--c-surface2)", color: "var(--c-text2)" }}>
                  Copy
                </button>
                <button onClick={() => { clearLog(); setLogEntries([]); }}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold text-red-400" style={{ background: "rgba(239,68,68,0.1)" }}>
                  Clear
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg p-2 text-[10px] font-mono leading-relaxed" style={{ background: "#000", color: "#0f0" }}>
                {logEntries.length === 0 ? <p style={{ color: "#666" }}>No log entries</p> :
                  logEntries.map((e, i) => (
                    <p key={i} style={{ color: e.level === "error" ? "#f87171" : e.level === "warn" ? "#fbbf24" : "#4ade80" }}>
                      [{e.ts}] {e.msg}
                    </p>
                  ))
                }
              </div>
            </>
          )}
        </div>

        {/* App Info */}
        <div className="rounded-2xl px-4 py-3 text-center space-y-0.5" style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)" }}>
          <p className="text-sm font-bold" style={{ color: "var(--c-text)" }}>Joey v2.8.1</p>
          <p className="text-[10px]" style={{ color: "var(--c-text3)" }}>EL-Waiter by EL Value</p>
          <p className="text-[10px] font-mono" style={{ color: "var(--c-text3)" }}>Venue: {deviceVenueId?.slice(0, 8).toUpperCase() || "—"}</p>
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
