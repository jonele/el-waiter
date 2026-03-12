"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useWaiterStore } from "@/store/waiterStore";
import { lookupWaiterByPin, lookupWaiterByQrToken } from "@/lib/supabase";
import QRScanner from "@/components/QRScanner";
import type { DbWaiterProfile } from "@/lib/waiterDb";

const NUM_PAD = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

function WaiterLogo({ size = 64 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 200 200" fill="none" style={{ color: "#3B82F6" }}>
      <path d="M30 110 Q100 55 170 110" stroke="currentColor" strokeWidth="10" strokeLinecap="round"/>
      <rect x="22" y="112" width="156" height="14" rx="7" fill="currentColor"/>
      <path d="M60 110 Q100 62 140 110" stroke="currentColor" strokeWidth="7" strokeLinecap="round"/>
      <rect x="92" y="126" width="16" height="28" rx="8" fill="currentColor"/>
      <rect x="68" y="150" width="64" height="14" rx="7" fill="currentColor"/>
    </svg>
  );
}

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
      minHeight: "100dvh", background: "var(--c-bg)",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "24px", gap: 24,
    }}>
      {/* Brand glow */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        background: "var(--c-brand-glow)",
      }} />

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 24, width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <WaiterLogo size={72} />
          <span style={{ color: "var(--c-text)", fontSize: 18, fontWeight: 700, letterSpacing: 0.5 }}>EL Waiter</span>
        </div>
        <p style={{ color: "var(--c-text2)", fontSize: 14, marginTop: -16 }}>Ρύθμιση Συσκευής</p>

        <p style={{ color: "var(--c-text2)", fontSize: 13, textAlign: "center", maxWidth: 280 }}>
          Σκανάρε το QR ρύθμισης από τη σελίδα <strong style={{ color: "var(--c-text)" }}>Συσκευές</strong> του EL-Loyal για να συνδέσεις αυτή τη συσκευή με το venue.
        </p>

        <QRScanner onScan={handleDeviceSetupScan} active={setupScanning} />

        {setupError && (
          <p style={{ color: "#F87171", fontSize: 13, textAlign: "center" }}>{setupError}</p>
        )}

        {/* Manual fallback */}
        <div style={{ width: "100%", maxWidth: 320 }}>
          <p style={{ color: "var(--c-text3)", fontSize: 12, textAlign: "center", marginBottom: 8 }}>ή εισάγετε χειροκίνητα το Venue ID</p>
          <input
            value={setupInput}
            onChange={(e) => { setSetupInput(e.target.value); setSetupError(""); }}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            autoComplete="off"
            style={{
              width: "100%", background: "var(--c-surface)", color: "var(--c-text)", borderRadius: 12,
              border: `1px solid ${setupError ? "#EF4444" : setupInput.length > 0 ? "#3B82F6" : "var(--c-border)"}`,
              padding: "12px 14px", fontSize: 13,
              outline: "none", boxSizing: "border-box", transition: "border-color 0.2s",
            }}
          />
          {setupError && (
            <p style={{
              color: "#F87171", fontSize: 13, marginTop: 8, fontWeight: 600,
              background: "rgba(239,68,68,0.12)", borderRadius: 8, padding: "8px 12px",
            }}>
              ⚠️ {setupError}
            </p>
          )}
          <button
            onClick={handleSetupManual}
            disabled={setupInput.trim().length === 0}
            style={{
              width: "100%", marginTop: 10,
              background: setupInput.trim().length === 0 ? "var(--c-surface)" : "#3B82F6",
              color: setupInput.trim().length === 0 ? "var(--c-text3)" : "#fff",
              borderRadius: 14, padding: "14px 0", fontWeight: 700, fontSize: 15,
              border: "none", cursor: setupInput.trim().length === 0 ? "not-allowed" : "pointer",
              transition: "all 0.2s",
            }}
          >
            {setupInput.trim().length === 0 ? "Εισάγετε Venue ID" : "Αποθήκευση →"}
          </button>
        </div>
      </div>
    </div>
  );

  // ── Render: Login ─────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100dvh", background: "var(--c-bg)",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "24px", gap: 20,
    }}>
      {/* Brand glow backdrop */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        background: "var(--c-brand-glow)",
      }} />

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 20, width: "100%", maxWidth: 360 }}>
        {/* Logo */}
        <div style={{ textAlign: "center" }}>
          <WaiterLogo size={64} />
          <span style={{ color: "var(--c-text)", fontSize: 20, fontWeight: 700, letterSpacing: 0.5 }}>EL Waiter</span>
          <p style={{ color: "var(--c-text2)", fontSize: 13, marginTop: 2 }}>Είσοδος Προσωπικού</p>
        </div>

        {/* Mode toggle */}
        <div style={{
          display: "flex", background: "var(--c-surface)", borderRadius: 14, padding: 4,
          gap: 4, width: "100%",
        }}>
          {(["qr", "pin"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setPin(""); setError(""); }}
              style={{
                flex: 1, padding: "12px 0", borderRadius: 10, fontWeight: 700,
                fontSize: 14, border: "none", cursor: "pointer", transition: "all 0.15s",
                background: mode === m ? "#3B82F6" : "transparent",
                color: mode === m ? "#fff" : "var(--c-text2)",
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
            {loading && <p style={{ color: "var(--c-text2)", fontSize: 13 }}>Αναζήτηση...</p>}
            {error && <p style={{ color: "#F87171", fontSize: 13, fontWeight: 600 }}>{error}</p>}
            <p style={{ color: "var(--c-text3)", fontSize: 12, textAlign: "center" }}>
              Σκανάρε το QR του πορτοφολιού σου από το EL-Loyal
            </p>
          </div>
        )}

        {/* PIN tab */}
        {mode === "pin" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, width: "100%" }}>
            {/* 4-dot indicator */}
            <div style={{ display: "flex", gap: 14 }}>
              {[0,1,2,3].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 16, height: 16, borderRadius: "50%", transition: "background 0.1s",
                    background: i < pin.length ? "#3B82F6" : "var(--c-surface2)",
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
                    minHeight: 64, borderRadius: 18, fontSize: 24, fontWeight: 600,
                    border: "none", cursor: v || v === "0" ? "pointer" : "default",
                    background: !v && v !== "0" ? "transparent" : "var(--c-surface)",
                    color: "var(--c-text)",
                    boxShadow: !v && v !== "0" ? undefined : "var(--c-num-shadow)",
                    transition: "transform 0.08s, opacity 0.1s",
                    opacity: loading ? 0.5 : 1,
                    visibility: !v && v !== "0" ? "hidden" : "visible",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  {v}
                </button>
              ))}
            </div>

            {loading && <p style={{ color: "var(--c-text2)", fontSize: 13 }}>Αναζήτηση...</p>}
          </div>
        )}

        {/* Device reset link */}
        <button
          onClick={() => setDeviceVenueId(null)}
          style={{
            marginTop: 4, background: "none", border: "none", cursor: "pointer",
            color: "var(--c-text3)", fontSize: 12, textDecoration: "underline",
          }}
        >
          ⚙️ Αλλαγή ρύθμισης συσκευής
        </button>
      </div>
    </div>
  );
}
