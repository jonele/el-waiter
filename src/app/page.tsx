"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { waiterDb } from "@/lib/waiterDb";
import { useWaiterStore } from "@/store/waiterStore";
import type { DbWaiterProfile } from "@/lib/waiterDb";

const NUM_PAD = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

export default function LoginPage() {
  const router = useRouter();
  const { waiter, login, settings } = useWaiterStore();
  const [profiles, setProfiles] = useState<DbWaiterProfile[]>([]);
  const [selected, setSelected] = useState<DbWaiterProfile | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (waiter) { router.replace("/tables"); return; }
    waiterDb.waiterProfiles
      .where("active").equals(1 as unknown as string)
      .sortBy("sort_order")
      .then((rows) => { setProfiles(rows); setLoading(false); })
      .catch(() => setLoading(false));
  }, [waiter, router]);

  function handleNum(v: string) {
    if (v === "⌫") { setPin((p) => p.slice(0,-1)); setError(""); return; }
    if (!v) return;
    const next = pin + v;
    setPin(next);
    if (next.length === 4) confirm(next);
  }

  function confirm(code: string) {
    if (!selected) return;
    const hasPin = !!selected.pin;
    if (hasPin && selected.pin !== code) {
      setError("Λάθος PIN. Δοκίμασε ξανά.");
      setTimeout(() => setPin(""), 600);
      return;
    }
    if (!hasPin) {
      // no pin set — any 4-digit entry or just tap profile
    }
    login(selected);
    router.push("/tables");
  }

  function selectProfile(p: DbWaiterProfile) {
    if (!p.pin) { login(p); router.push("/tables"); return; }
    setSelected(p);
    setPin("");
    setError("");
  }

  if (loading) return (
    <div className="flex h-screen items-center justify-center text-gray-400 text-lg">
      Φόρτωση...
    </div>
  );

  if (profiles.length === 0) return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="text-5xl">🍽️</div>
      <p className="text-xl font-semibold text-white">Δεν βρέθηκαν προφίλ σερβιτόρων</p>
      <p className="text-gray-400 text-sm">Άνοιξε τις Ρυθμίσεις για να ορίσεις το venue ID και να συγχρονίσεις τα δεδομένα.</p>
      <button
        onClick={() => router.push("/settings")}
        className="mt-4 rounded-xl bg-brand px-6 py-3 font-semibold text-white touch-btn"
      >
        Ρυθμίσεις
      </button>
    </div>
  );

  if (!selected) return (
    <div className="flex h-screen flex-col">
      <div className="pt-safe px-4 py-4">
        <h1 className="text-center text-2xl font-bold text-white">Ποιος είσαι;</h1>
      </div>
      <div className="flex-1 overflow-y-auto px-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 pb-safe">
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => selectProfile(p)}
              className="flex flex-col items-center gap-2 rounded-2xl p-5 touch-btn transition-opacity active:opacity-60"
              style={{ backgroundColor: p.color || "#1E3A5F" }}
            >
              <span className="text-4xl">{p.icon || "👤"}</span>
              <span className="text-base font-semibold text-white text-center leading-tight">{p.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="pb-safe px-4 py-2 text-center">
        <button onClick={() => router.push("/settings")} className="text-gray-500 text-sm underline">
          Ρυθμίσεις
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 px-6">
      <button
        onClick={() => { setSelected(null); setPin(""); setError(""); }}
        className="flex flex-col items-center gap-2"
      >
        <span className="text-5xl">{selected.icon || "👤"}</span>
        <span className="text-lg font-semibold text-white">{selected.name}</span>
        <span className="text-xs text-gray-400 underline">Αλλαγή</span>
      </button>

      <p className="text-gray-400 text-sm">Εισάγετε PIN</p>

      <div className="flex gap-4">
        {[0,1,2,3].map((i) => (
          <div
            key={i}
            className={`h-4 w-4 rounded-full transition-colors ${i < pin.length ? "bg-brand" : "bg-gray-700"}`}
          />
        ))}
      </div>

      {error && <p className="text-red-400 text-sm font-medium">{error}</p>}

      <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
        {NUM_PAD.map((v, i) => (
          <button
            key={i}
            onClick={() => handleNum(v)}
            disabled={!v && v !== "0"}
            className={`rounded-2xl py-5 text-xl font-semibold touch-btn transition-colors
              ${!v && v !== "0" ? "opacity-0 pointer-events-none" : "bg-gray-800 active:bg-gray-700 text-white"}`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}
