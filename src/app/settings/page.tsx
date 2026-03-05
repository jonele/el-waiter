"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWaiterStore } from "@/store/waiterStore";
import { supabase } from "@/lib/supabase";
import { waiterDb } from "@/lib/waiterDb";

export default function SettingsPage() {
  const router = useRouter();
  const { settings, updateSettings, isOnline, pendingSyncs } = useWaiterStore();
  const [form, setForm] = useState(settings);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  useEffect(() => { setForm(settings); }, [settings]);

  function save() {
    updateSettings(form);
    router.back();
  }

  async function syncAll() {
    if (!supabase || !form.venueId) { setSyncMsg("Ορίστε Venue ID πρώτα."); return; }
    setSyncing(true);
    setSyncMsg("");
    try {
      const [{ data: secs }, { data: tbls }, { data: cats }, { data: itms }, { data: waiters }] = await Promise.all([
        supabase.from("pos_floor_sections").select("*").eq("venue_id", form.venueId),
        supabase.from("pos_tables").select("*").eq("venue_id", form.venueId),
        supabase.from("menu_categories").select("*").eq("venue_id", form.venueId).eq("is_active", true),
        supabase.from("menu_items").select("*").eq("venue_id", form.venueId).eq("is_active", true),
        supabase.from("waiter_profiles").select("*").eq("venue_id", form.venueId).eq("active", true),
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
    } catch (e) {
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

  return (
    <div className="flex h-screen flex-col">
      <div className="pt-safe bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <button onClick={() => router.back()} className="text-gray-400 text-xl touch-btn">←</button>
        <p className="font-bold text-white text-lg">Ρυθμίσεις</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
        {/* Venue ID */}
        <div className="space-y-1">
          <label className="text-gray-400 text-sm font-medium">Venue ID</label>
          <input
            value={form.venueId}
            onChange={(e) => setForm({ ...form, venueId: e.target.value.trim() })}
            placeholder="uuid του venue"
            className="w-full rounded-xl bg-gray-800 px-4 py-3 text-white placeholder-gray-600 text-sm outline-none"
          />
          <p className="text-gray-600 text-xs">Βρείτε το στο EL-Loyal dashboard.</p>
        </div>

        {/* Bridge URL */}
        <div className="space-y-1">
          <label className="text-gray-400 text-sm font-medium">Bridge URL (LAN)</label>
          <input
            value={form.bridgeUrl}
            onChange={(e) => setForm({ ...form, bridgeUrl: e.target.value.trim() })}
            placeholder="http://192.168.1.X:8088"
            className="w-full rounded-xl bg-gray-800 px-4 py-3 text-white placeholder-gray-600 text-sm outline-none"
          />
          <p className="text-gray-600 text-xs">Η διεύθυνση του EL Bridge στο τοπικό δίκτυο.</p>
        </div>

        {/* Min consumption */}
        <div className="space-y-1">
          <label className="text-gray-400 text-sm font-medium">Ελάχιστη κατανάλωση (€)</label>
          <input
            type="number"
            inputMode="decimal"
            value={form.minConsumptionEur || ""}
            onChange={(e) => setForm({ ...form, minConsumptionEur: parseFloat(e.target.value) || 0 })}
            placeholder="0 = απενεργοποιημένο"
            className="w-full rounded-xl bg-gray-800 px-4 py-3 text-white placeholder-gray-600 text-sm outline-none"
          />
        </div>

        {/* Bluetooth toggle */}
        <div className="flex items-center justify-between rounded-2xl bg-gray-800 px-4 py-4">
          <div>
            <p className="text-white font-medium">Bluetooth πληρωμές</p>
            <p className="text-gray-500 text-xs">Fallback αν δεν υπάρχει LAN</p>
          </div>
          <button
            onClick={() => setForm({ ...form, btEnabled: !form.btEnabled })}
            className={`relative h-7 w-12 rounded-full transition-colors touch-btn ${form.btEnabled ? "bg-brand" : "bg-gray-700"}`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${form.btEnabled ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>

        {/* Sync status */}
        <div className="rounded-2xl bg-gray-800 px-4 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-white font-medium">Κατάσταση</p>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${isOnline ? "bg-green-500" : "bg-red-500"}`} />
              <span className="text-sm text-gray-400">{isOnline ? "Online" : "Offline"}</span>
            </div>
          </div>
          {pendingSyncs > 0 && (
            <p className="text-yellow-400 text-sm">{pendingSyncs} εκκρεμείς παραγγελίες για sync</p>
          )}
          {syncMsg && <p className="text-sm text-green-400">{syncMsg}</p>}
          <button
            onClick={syncAll}
            disabled={syncing || !isOnline}
            className="w-full rounded-xl bg-brand/20 border border-brand/40 py-3 text-brand font-semibold text-sm touch-btn disabled:opacity-40"
          >
            {syncing ? "Συγχρονισμός..." : "Συγχρονισμός δεδομένων"}
          </button>
          <button
            onClick={clearData}
            className="w-full rounded-xl bg-red-500/10 border border-red-500/20 py-3 text-red-400 font-semibold text-sm touch-btn"
          >
            Διαγραφή τοπικών δεδομένων
          </button>
        </div>
      </div>

      <div className="border-t border-gray-800 bg-gray-900 px-4 py-3 pb-safe">
        <button
          onClick={save}
          className="w-full rounded-2xl bg-brand py-4 font-bold text-white text-lg touch-btn"
        >
          Αποθήκευση
        </button>
      </div>
    </div>
  );
}
