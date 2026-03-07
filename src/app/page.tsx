"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useWaiterStore } from "@/store/waiterStore";
import { lookupWaiterByPin, lookupWaiterByQrToken } from "@/lib/supabase";
import QRScanner from "@/components/QRScanner";
import type { DbWaiterProfile } from "@/lib/waiterDb";

const NUM_PAD = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

function parseQrToken(raw: string): string {
  try {
    const url = new URL(raw);
    return url.searchParams.get("token") || url.searchParams.get("qr_token") || raw.trim();
  } catch {
    return raw.trim();
  }
}

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());
}

export default function LoginPage() {
  const router = useRouter();
  const { waiter, login, deviceVenueId, setDeviceVenueId } = useWaiterStore();

  const [mode, setMode] = useState<"qr" | "pin">("qr");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Device setup state
  const [setupInput, setSetupInput] = useState("");
  const [setupError, setSetupError] = useState("");
  const [setupScanning, setSetupScanning] = useState(true);

  useEffect(() => {
    if (waiter) router.replace("/tables");
  }, [waiter, router]);

  // ── Device Setup QR scan ──────────────────────────────────────────
  const handleDeviceSetupScan = useCallback((raw: string) => {
    const val = raw.trim();
    if (isUUID(val)) {
      setDeviceVenueId(val);
      setSetupScanning(false);
    } else {
      setSetupError("Μη έγκυρο QR. Σκανάρε το QR ρύθμισης από το EL-Loyal.");
      // Re-enable scanner after brief pause
      setTimeout(() => { setSetupError(""); setSetupScanning(false); setSetupScanning(true); }, 2000);
    }
  }, [setDeviceVenueId]);

  function handleSetupManual() {
    const val = setupInput.trim();
    if (!isUUID(val)) { setSetupError("Μη έγκυρο Venue ID (χρειάζεται UUID μορφή)."); return; }
    setDeviceVenueId(val);
  }

  // ── Login QR scan ─────────────────────────────────────────────────
  const handleLoginScan = useCallback(async (raw: string) => {
    if (!deviceVenueId) return;
    setLoading(true);
    setError("");
    const token = parseQrToken(raw);
    const profile = await lookupWaiterByQrToken(deviceVenueId, token);
    setLoading(false);
    if (profile) {
      login(profile as unknown as DbWaiterProfile);
      router.push("/tables");
    } else {
      setError("Δεν βρέθηκε προφίλ για αυτό το QR.");
      setTimeout(() => setError(""), 2000);
    }
  }, [deviceVenueId, login, router]);

  // ── PIN entry ─────────────────────────────────────────────────────
  async function handleNum(v: string) {
    if (loading) return;
    if (v === "⌫") { setPin((p) => p.slice(0, -1)); setError(""); return; }
    if (!v) return;
    const next = pin + v;
    if (next.length > 4) return;
    setPin(next);
    if (next.length === 4) {
      if (!deviceVenueId) return;
      setLoading(true);
      setError("");
      const profile = await lookupWaiterByPin(deviceVenueId, next);
      setLoading(false);
      if (profile) {
        login(profile as unknown as DbWaiterProfile);
        router.push("/tables");
      } else {
        setError("Λάθος PIN. Δοκίμασε ξανά.");
        setTimeout(() => { setPin(""); setError(""); }, 1500);
      }
    }
  }

  // ── Render: Device Setup ──────────────────────────────────────────
  if (!deviceVenueId) return (
    <div style={{
      minHeight: "100dvh", background: "#0F0F0F",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "24px", gap: 24,
    }}>
      <div style={{ fontSize: 56 }}>🍽️</div>
      <div style={{ textAlign: "center" }}>
        <p style={{ color: "#fff", fontSize: 22, fontWeight: 700, margin: 0 }}>EL Waiter</p>
        <p style={{ color: "#6B7280", fontSize: 14, marginTop: 6 }}>Ρύθμιση Συσκευής</p>
      </div>

      <p style={{ color: "#9CA3AF", fontSize: 13, textAlign: "center", maxWidth: 280 }}>
        Σκανάρε το QR ρύθμισης από τη σελίδα <strong style={{ color: "#fff" }}>Συσκευές</strong> του EL-Loyal για να συνδέσεις αυτή τη συσκευή με το venue.
      </p>

      <QRScanner onScan={handleDeviceSetupScan} active={setupScanning} />

      {setupError && (
        <p style={{ color: "#F87171", fontSize: 13, textAlign: "center" }}>{setupError}</p>
      )}

      {/* Manual fallback */}
      <div style={{ width: "100%", maxWidth: 320, marginTop: 8 }}>
        <p style={{ color: "#6B7280", fontSize: 12, textAlign: "center", marginBottom: 8 }}>ή εισάγετε χειροκίνητα το Venue ID</p>
        <input
          value={setupInput}
          onChange={(e) => { setSetupInput(e.target.value); setSetupError(""); }}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          autoComplete="off"
          style={{
            width: "100%", background: "#1F2937", color: "#fff", borderRadius: 12,
            border: `1px solid ${setupError ? "#EF4444" : setupInput.length > 0 ? "#3B82F6" : "#374151"}`,
            padding: "12px 14px", fontSize: 13,
            outline: "none", boxSizing: "border-box", transition: "border-color 0.2s",
          }}
        />
        {setupError && (
          <p style={{
            color: "#F87171", fontSize: 13, marginTop: 8, fontWeight: 600,
            background: "#450a0a", borderRadius: 8, padding: "8px 12px",
          }}>
            ⚠️ {setupError}
          </p>
        )}
        <button
          onClick={handleSetupManual}
          disabled={setupInput.trim().length === 0}
          style={{
            width: "100%", marginTop: 10,
            background: setupInput.trim().length === 0 ? "#1F2937" : "#3B82F6",
            color: setupInput.trim().length === 0 ? "#4B5563" : "#fff",
            borderRadius: 14, padding: "14px 0", fontWeight: 700, fontSize: 15,
            border: "none", cursor: setupInput.trim().length === 0 ? "not-allowed" : "pointer",
            transition: "all 0.2s",
          }}
        >
          {setupInput.trim().length === 0 ? "Εισάγετε Venue ID" : "Αποθήκευση →"}
        </button>
      </div>
    </div>
  );

  // ── Render: Login ─────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100dvh", background: "#0F0F0F",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "24px", gap: 20,
    }}>
      {/* Logo */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 52 }}>🍽️</div>
        <p style={{ color: "#fff", fontSize: 22, fontWeight: 700, margin: "6px 0 0" }}>EL Waiter</p>
        <p style={{ color: "#6B7280", fontSize: 13, marginTop: 4 }}>Είσοδος Προσωπικού</p>
      </div>

      {/* Mode toggle */}
      <div style={{
        display: "flex", background: "#1F2937", borderRadius: 14, padding: 4,
        gap: 4, width: "100%", maxWidth: 320,
      }}>
        {(["qr", "pin"] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setPin(""); setError(""); }}
            style={{
              flex: 1, padding: "12px 0", borderRadius: 10, fontWeight: 700,
              fontSize: 14, border: "none", cursor: "pointer", transition: "all 0.15s",
              background: mode === m ? "#3B82F6" : "transparent",
              color: mode === m ? "#fff" : "#6B7280",
            }}
          >
            {m === "qr" ? "📷  QR" : "🔢  PIN"}
          </button>
        ))}
      </div>

      {/* QR tab */}
      {mode === "qr" && (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <QRScanner
            onScan={handleLoginScan}
            active={mode === "qr" && !loading}
          />
          {loading && <p style={{ color: "#9CA3AF", fontSize: 13 }}>Αναζήτηση...</p>}
          {error && <p style={{ color: "#F87171", fontSize: 13, fontWeight: 600 }}>{error}</p>}
          <p style={{ color: "#4B5563", fontSize: 12, textAlign: "center" }}>
            Σκανάρε το QR του πορτοφολιού σου από το EL-Loyal
          </p>
        </div>
      )}

      {/* PIN tab */}
      {mode === "pin" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, width: "100%", maxWidth: 320 }}>
          {/* 4-dot indicator */}
          <div style={{ display: "flex", gap: 14 }}>
            {[0,1,2,3].map((i) => (
              <div
                key={i}
                style={{
                  width: 16, height: 16, borderRadius: "50%", transition: "background 0.1s",
                  background: i < pin.length ? "#3B82F6" : "#374151",
                }}
              />
            ))}
          </div>

          {error && (
            <p style={{ color: "#F87171", fontSize: 13, fontWeight: 600, margin: "-8px 0" }}>{error}</p>
          )}

          {/* Numpad */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, width: "100%" }}>
            {NUM_PAD.map((v, i) => (
              <button
                key={i}
                onClick={() => handleNum(v)}
                disabled={loading || (!v && v !== "0")}
                style={{
                  minHeight: 60, borderRadius: 16, fontSize: 22, fontWeight: 600,
                  border: "none", cursor: v || v === "0" ? "pointer" : "default",
                  background: !v && v !== "0" ? "transparent" : "#1F2937",
                  color: "#fff", transition: "background 0.1s",
                  opacity: loading ? 0.5 : 1,
                  visibility: !v && v !== "0" ? "hidden" : "visible",
                }}
              >
                {v}
              </button>
            ))}
          </div>

          {loading && <p style={{ color: "#9CA3AF", fontSize: 13 }}>Αναζήτηση...</p>}
        </div>
      )}

      {/* Device reset link */}
      <button
        onClick={() => setDeviceVenueId(null)}
        style={{
          marginTop: 8, background: "none", border: "none", cursor: "pointer",
          color: "#374151", fontSize: 12, textDecoration: "underline",
        }}
      >
        ⚙️ Αλλαγή ρύθμισης συσκευής
      </button>
    </div>
  );
}
