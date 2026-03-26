"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useWaiterStore } from "@/store/waiterStore";
import {
  lookupWaiterByPin,
  lookupWaiterByQrToken,
  fetchProfilesForVenue,
  fetchSiblingVenues,
  startShift,
  WaiterProfile,
  SiblingVenue,
  supabase,
  fetchCashierProfiles,
} from "@/lib/supabase";
import type { CashierProfile } from "@/lib/dbTypes";
import QRScanner from "@/components/QRScanner";
import type { DbWaiterProfile } from "@/lib/waiterDb";

const NUM_PAD = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

function WaiterLogo({ size = 64 }: { size?: number }) {
  return (
    <img
      src="/joey-avatar.jpg"
      alt="Joey"
      width={size}
      height={size}
      style={{ borderRadius: "50%", objectFit: "cover", border: "2px solid var(--brand, #3B82F6)" }}
    />
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
  const { waiter, login, deviceVenueId, setDeviceVenueId, setCurrentShiftId, setCashierProfile } = useWaiterStore();

  const [profiles, setProfiles] = useState<WaiterProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<WaiterProfile | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showQrLogin, setShowQrLogin] = useState(false);

  // Cashier profile picker state
  const [cashierProfiles, setCashierProfiles] = useState<CashierProfile[]>([]);
  const [showProfilePicker, setShowProfilePicker] = useState(false);
  const [pendingWaiter, setPendingWaiter] = useState<WaiterProfile | null>(null);

  // Device setup state
  const [setupInput, setSetupInput] = useState("");
  const [setupError, setSetupError] = useState("");
  const [setupScanning, setSetupScanning] = useState(true);
  // Venue list removed — security risk (exposes all onboarded venues)

  // Session kicked message
  const [kicked, setKicked] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search.includes("kicked=1")) {
      setKicked(true);
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => setKicked(false), 6000);
    }
  }, []);

  // Multi-venue picker state
  const [siblingVenues, setSiblingVenues] = useState<SiblingVenue[]>([]);
  const [showVenuePicker, setShowVenuePicker] = useState(false);
  const [scannedVenueId, setScannedVenueId] = useState<string | null>(null);

  useEffect(() => {
    if (waiter) router.replace("/tables");
  }, [waiter, router]);

  // When venue is set: check for siblings, then fetch profiles
  useEffect(() => {
    if (!deviceVenueId) { setProfiles([]); setSiblingVenues([]); return; }
    setProfilesLoading(true);
    // Check for sibling venues in parallel with profile fetch
    void fetchSiblingVenues(deviceVenueId).then((siblings) => {
      if (siblings.length > 1 && !scannedVenueId) {
        // First time — show the picker
        setSiblingVenues(siblings);
        setShowVenuePicker(true);
      }
    });
    fetchProfilesForVenue(deviceVenueId).then((p) => {
      setProfiles(p);
      setProfilesLoading(false);
    });
  }, [deviceVenueId]);

  // ── Device Setup QR scan ──────────────────────────────────────────
  const handleDeviceSetupScan = useCallback((raw: string) => {
    const val = raw.trim();
    let venueUUID: string | null = null;
    if (isUUID(val)) {
      venueUUID = val;
    } else {
      try {
        const url = new URL(val);
        venueUUID = url.pathname.split("/").find(p => isUUID(p)) || null;
      } catch { /* not a URL */ }
    }
    if (venueUUID) {
      setScannedVenueId(venueUUID);
      setSetupScanning(false);
      // Check siblings before committing
      void fetchSiblingVenues(venueUUID).then((siblings) => {
        if (siblings.length > 1) {
          setSiblingVenues(siblings);
          setShowVenuePicker(true);
        } else {
          setDeviceVenueId(venueUUID!);
        }
      });
      return;
    }
    setSetupError("\u039C\u03B7 \u03AD\u03B3\u03BA\u03C5\u03C1\u03BF QR. \u03A3\u03BA\u03B1\u03BD\u03AC\u03C1\u03B5 \u03C4\u03BF QR \u03C1\u03CD\u03B8\u03BC\u03B9\u03C3\u03B7\u03C2 \u03B1\u03C0\u03CC \u03C4\u03BF EL-Loyal.");
    setTimeout(() => { setSetupError(""); setSetupScanning(false); setSetupScanning(true); }, 2000);
  }, [setDeviceVenueId]);

  function handleSetupManual() {
    const val = setupInput.trim();
    if (!isUUID(val)) { setSetupError("Μη έγκυρο Venue ID (χρειάζεται UUID μορφή)."); return; }
    setDeviceVenueId(val);
  }

  // ── Shared: login + start shift ───────────────────────────────────
  // Finalize login: set waiter, start shift, go to tables
  const finalizeLogin = useCallback((profile: WaiterProfile) => {
    login(profile as unknown as DbWaiterProfile);
    void startShift(profile.id, profile.venue_id, profile.name)
      .then((shiftId) => { if (shiftId) setCurrentShiftId(shiftId); })
      .catch(() => {});
    router.push("/tables");
  }, [login, setCurrentShiftId, router]);

  // doLogin: after PIN, fetch cashier profiles and show picker if >1
  const doLogin = useCallback(async (profile: WaiterProfile) => {
    const vid = deviceVenueId || profile.venue_id;
    const cps = await fetchCashierProfiles(vid);
    if (cps.length === 0) {
      // No cashier profiles — go straight to tables
      setCashierProfile(null);
      finalizeLogin(profile);
    } else if (cps.length === 1) {
      // Single profile — auto-select
      setCashierProfile(cps[0]);
      finalizeLogin(profile);
    } else {
      // Multiple — show picker
      setPendingWaiter(profile);
      setCashierProfiles(cps);
      setShowProfilePicker(true);
    }
  }, [deviceVenueId, setCashierProfile, finalizeLogin]);

  // ── Login QR scan ─────────────────────────────────────────────────
  const handleLoginScan = useCallback(async (raw: string) => {
    if (!deviceVenueId) return;
    setLoading(true);
    setError("");
    const token = parseQrToken(raw);
    const profile = await lookupWaiterByQrToken(deviceVenueId, token);
    setLoading(false);
    if (profile) {
      await doLogin(profile);
    } else {
      setError("Δεν βρέθηκε προφίλ για αυτό το QR.");
      setTimeout(() => setError(""), 2000);
    }
  }, [deviceVenueId, doLogin]);

  // ── PIN entry ─────────────────────────────────────────────────────
  async function handleNum(v: string) {
    if (loading || !selectedProfile) return;
    if (v === "⌫") { setPin((p) => p.slice(0, -1)); setError(""); return; }
    if (!v) return;
    const next = pin + v;
    if (next.length > 4) return;
    setPin(next);
    if (next.length === 4) {
      // Fast local check if pin is available in profile
      if (selectedProfile.pin) {
        if (selectedProfile.pin === next) {
          await doLogin(selectedProfile);
        } else {
          setError("Λάθος PIN. Δοκίμασε ξανά.");
          setTimeout(() => { setPin(""); setError(""); }, 1500);
        }
        return;
      }
      // Fallback server lookup
      if (!deviceVenueId) return;
      setLoading(true);
      setError("");
      const profile = await lookupWaiterByPin(deviceVenueId, next);
      setLoading(false);
      if (profile) {
        await doLogin(profile);
      } else {
        setError("Λάθος PIN. Δοκίμασε ξανά.");
        setTimeout(() => { setPin(""); setError(""); }, 1500);
      }
    }
  }

  // ── Render: Cashier Profile Picker ──────────────────────────────
  if (showProfilePicker && cashierProfiles.length > 0 && pendingWaiter) return (
    <div style={{
      minHeight: "100dvh", background: "var(--c-bg)",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "24px", gap: 24,
    }}>
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, background: "var(--c-brand-glow)" }} />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 20, width: "100%", maxWidth: 400 }}>
        <WaiterLogo size={56} />
        <p style={{ color: "var(--c-text)", fontSize: 18, fontWeight: 700 }}>
          {pendingWaiter.name}
        </p>
        <p style={{ color: "var(--c-text2)", fontSize: 14 }}>Επιλέξτε σταθμό εργασίας</p>

        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
          {cashierProfiles.map((cp) => (
            <button
              key={cp.id}
              onClick={() => {
                setCashierProfile(cp);
                if (pendingWaiter) {
                  login(pendingWaiter as unknown as DbWaiterProfile);
                  void startShift(pendingWaiter.id, pendingWaiter.venue_id, pendingWaiter.name)
                    .then((shiftId) => { if (shiftId) setCurrentShiftId(shiftId); })
                    .catch(() => {});
                }
                router.push("/tables");
              }}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 14,
                padding: "16px 18px", borderRadius: 16,
                background: "var(--c-surface)", border: "2px solid var(--c-border)",
                cursor: "pointer", textAlign: "left",
                transition: "all 0.15s",
              }}
            >
              <span style={{ fontSize: 28 }}>{cp.icon || "🖥️"}</span>
              <div style={{ flex: 1 }}>
                <p style={{ color: "var(--c-text)", fontSize: 15, fontWeight: 700, margin: 0 }}>{cp.name}</p>
                {cp.rvc_name && (
                  <p style={{ color: "var(--c-text2)", fontSize: 12, margin: "2px 0 0" }}>RVC: {cp.rvc_name}</p>
                )}
                {cp.receipt_printer_ip && (
                  <p style={{ color: "var(--c-text3)", fontSize: 10, margin: "2px 0 0", fontFamily: "monospace" }}>
                    {cp.receipt_printer_ip}
                  </p>
                )}
              </div>
              <span style={{ color: "var(--c-text3)", fontSize: 18 }}>›</span>
            </button>
          ))}
        </div>

        <p style={{ color: "var(--c-text3)", fontSize: 10, opacity: 0.5 }}>Joey v2.12.1</p>
      </div>
    </div>
  );

  // ── Render: Multi-venue picker ───────────────────────────────────
  if (showVenuePicker && siblingVenues.length > 1) return (
    <div style={{
      minHeight: "100dvh", background: "var(--c-bg)",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "24px", gap: 20,
    }}>
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, background: "var(--c-brand-glow)" }} />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 20, width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center" }}>
          <WaiterLogo size={56} />
          <p style={{ color: "var(--c-text)", fontSize: 20, fontWeight: 700, marginTop: 8 }}>
            {"\u0395\u03C0\u03B9\u03BB\u03BF\u03B3\u03AE \u039A\u03B1\u03C4\u03B1\u03C3\u03C4\u03AE\u03BC\u03B1\u03C4\u03BF\u03C2"}
          </p>
          <p style={{ color: "var(--c-text2)", fontSize: 14, marginTop: 4 }}>
            {"\u03A0\u03BF\u03B9\u03BF \u03BA\u03B1\u03C4\u03AC\u03C3\u03C4\u03B7\u03BC\u03B1 \u03B4\u03BF\u03C5\u03BB\u03B5\u03CD\u03B5\u03B9\u03C2 \u03C3\u03AE\u03BC\u03B5\u03C1\u03B1;"}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
          {siblingVenues.map((v) => (
            <button
              key={v.id}
              onClick={() => {
                setDeviceVenueId(v.id);
                setShowVenuePicker(false);
                setScannedVenueId(v.id);
              }}
              style={{
                width: "100%",
                minHeight: 72,
                borderRadius: 16,
                background: "var(--c-surface)",
                border: "2px solid var(--c-border)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 20px",
                transition: "transform 0.1s, border-color 0.15s",
                WebkitTapHighlightColor: "transparent",
                boxShadow: "var(--c-num-shadow)",
              }}
              onTouchStart={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.97)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#3B82F6"; }}
              onTouchEnd={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--c-border)"; }}
            >
              <div style={{ textAlign: "left" }}>
                <p style={{ color: "var(--c-text)", fontSize: 16, fontWeight: 700 }}>{v.name}</p>
                <p style={{ color: "var(--c-text2)", fontSize: 12, marginTop: 2 }}>
                  {v.table_count > 0 ? `${v.table_count} \u03C4\u03C1\u03B1\u03C0\u03AD\u03B6\u03B9\u03B1` : "Takeaway only"}
                </p>
              </div>
              <span style={{ fontSize: 20, color: "var(--c-text3)" }}>{"\u203A"}</span>
            </button>
          ))}
        </div>

        <button
          onClick={() => { setShowVenuePicker(false); setScannedVenueId(null); setDeviceVenueId(null); }}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-text3)", fontSize: 13, textDecoration: "underline" }}
        >
          {"\u2190 \u03A3\u03BA\u03B1\u03BD\u03AC\u03C1\u03B9\u03C3\u03BC\u03B1 \u03AC\u03BB\u03BB\u03BF\u03C5 QR"}
        </button>
      </div>
    </div>
  );

  // ── Render: Device Setup ──────────────────────────────────────────
  if (!deviceVenueId) return (
    <div style={{
      minHeight: "100dvh", background: "var(--c-bg)",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "24px", gap: 24,
    }}>
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        background: "var(--c-brand-glow)",
      }} />

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 24, width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <WaiterLogo size={72} />
          <span style={{ color: "var(--c-text)", fontSize: 18, fontWeight: 700, letterSpacing: 0.5 }}>Joey</span>
        </div>
        <p style={{ color: "var(--c-text2)", fontSize: 14, marginTop: -16 }}>Ρύθμιση Συσκευής</p>

        <p style={{ color: "var(--c-text2)", fontSize: 13, textAlign: "center", maxWidth: 280 }}>
          Σκανάρε το QR ρύθμισης από τη σελίδα <strong style={{ color: "var(--c-text)" }}>Συσκευές</strong> του EL-Loyal για να συνδέσεις αυτή τη συσκευή με το venue.
        </p>

        <QRScanner onScan={handleDeviceSetupScan} active={setupScanning} />

        {setupError && (
          <p style={{ color: "#F87171", fontSize: 13, textAlign: "center" }}>{setupError}</p>
        )}

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

        {/* Version */}
        <p style={{ color: "var(--c-text3)", fontSize: 10, opacity: 0.5, marginTop: 8 }}>Joey v2.12.1</p>

      </div>
    </div>
  );

  // ── Render: QR Login (fallback) ───────────────────────────────────
  if (showQrLogin) return (
    <div style={{
      minHeight: "100dvh", background: "var(--c-bg)",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "24px", gap: 20,
    }}>
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, background: "var(--c-brand-glow)" }} />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 20, width: "100%", maxWidth: 360 }}>
        <div style={{ textAlign: "center" }}>
          <WaiterLogo size={56} />
          <p style={{ color: "var(--c-text)", fontSize: 18, fontWeight: 700, marginTop: 4 }}>Σύνδεση με QR</p>
          <p style={{ color: "var(--c-text2)", fontSize: 13, marginTop: 2 }}>Σκανάρε το QR κωδικό σου</p>
        </div>
        <QRScanner onScan={handleLoginScan} active={!loading} />
        {loading && <p style={{ color: "var(--c-text2)", fontSize: 13 }}>Αναζήτηση...</p>}
        {error && <p style={{ color: "#F87171", fontSize: 13, fontWeight: 600 }}>{error}</p>}
        <button
          onClick={() => { setShowQrLogin(false); setError(""); }}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-text3)", fontSize: 13, textDecoration: "underline" }}
        >
          ← Επιλογή προφίλ
        </button>
        <button
          onClick={() => setDeviceVenueId(null)}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-text3)", fontSize: 12, textDecoration: "underline" }}
        >
          ⚙️ Αλλαγή ρύθμισης συσκευής
        </button>
      </div>
    </div>
  );

  // ── Render: PIN numpad for selected profile ───────────────────────
  if (selectedProfile) return (
    <div style={{
      minHeight: "100dvh", background: "var(--c-bg)",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "24px", gap: 20,
    }}>
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, background: "var(--c-brand-glow)" }} />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 20, width: "100%", maxWidth: 360 }}>
        {/* Selected profile card */}
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: 24,
            background: selectedProfile.color || "#3B82F6",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 36,
            boxShadow: `0 0 24px ${selectedProfile.color || "#3B82F6"}55`,
          }}>
            {selectedProfile.icon || "👤"}
          </div>
          <p style={{ color: "var(--c-text)", fontSize: 20, fontWeight: 700 }}>{selectedProfile.name}</p>
          <p style={{ color: "var(--c-text2)", fontSize: 13, marginTop: -6 }}>Εισάγετε PIN</p>
        </div>

        {/* 4-dot indicator */}
        <div style={{ display: "flex", gap: 14 }}>
          {[0,1,2,3].map((i) => (
            <div
              key={i}
              style={{
                width: 16, height: 16, borderRadius: "50%", transition: "background 0.1s",
                background: i < pin.length
                  ? (selectedProfile.color || "#3B82F6")
                  : "var(--c-surface2)",
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
              aria-label={v === "⌫" ? "Διαγραφή" : v || undefined}
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

        {/* Back */}
        <button
          onClick={() => { setSelectedProfile(null); setPin(""); setError(""); }}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-text3)", fontSize: 13, textDecoration: "underline" }}
        >
          ← Επιλογή προφίλ
        </button>
        <button
          onClick={() => setDeviceVenueId(null)}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-text3)", fontSize: 12, textDecoration: "underline" }}
        >
          ⚙️ Αλλαγή ρύθμισης συσκευής
        </button>
      </div>
    </div>
  );

  // ── Render: Profile Grid ──────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100dvh", background: "var(--c-bg)",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "24px", gap: 20,
    }}>
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, background: "var(--c-brand-glow)" }} />

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 20, width: "100%", maxWidth: 360 }}>
        {/* Kicked banner */}
        {kicked && (
          <div style={{
            background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)",
            borderRadius: 12, padding: "12px 16px", textAlign: "center", width: "100%",
          }}>
            <p style={{ color: "#f87171", fontSize: 14, fontWeight: 700 }}>
              {"\u26A0\uFE0F"} {"\u0391\u03C0\u03BF\u03C3\u03C5\u03BD\u03B4\u03B5\u03B8\u03AE\u03BA\u03B1\u03C4\u03B5"}
            </p>
            <p style={{ color: "#fca5a5", fontSize: 12, marginTop: 4 }}>
              {"\u039A\u03AC\u03C0\u03BF\u03B9\u03BF\u03C2 \u03C3\u03C5\u03BD\u03B4\u03AD\u03B8\u03B7\u03BA\u03B5 \u03BC\u03B5 \u03C4\u03BF\u03BD \u03BB\u03BF\u03B3\u03B1\u03C1\u03B9\u03B1\u03C3\u03BC\u03CC \u03C3\u03B1\u03C2 \u03B1\u03C0\u03CC \u03AC\u03BB\u03BB\u03B7 \u03C3\u03C5\u03C3\u03BA\u03B5\u03C5\u03AE."}
            </p>
          </div>
        )}

        {/* Brand */}
        <div style={{ textAlign: "center" }}>
          <WaiterLogo size={64} />
          <p style={{ color: "var(--c-text)", fontSize: 20, fontWeight: 700, marginTop: 4 }}>Joey</p>
          <p style={{ color: "var(--c-text2)", fontSize: 14, marginTop: 2 }}>Ποιος είσαι;</p>
        </div>

        {/* Profile grid */}
        {profilesLoading ? (
          <p style={{ color: "var(--c-text2)", fontSize: 14 }}>Φόρτωση προφίλ...</p>
        ) : profiles.length === 0 ? (
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ color: "var(--c-text2)", fontSize: 14 }}>Δεν βρέθηκαν προφίλ για αυτή τη συσκευή.</p>
            <p style={{ color: "var(--c-text3)", fontSize: 12 }}>
              Δημιούργησε προφίλ από τη σελίδα Συσκευές στο EL-Loyal.
            </p>
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 14,
            width: "100%",
          }}>
            {profiles.map((p) => (
              <button
                key={p.id}
                onClick={() => { setSelectedProfile(p); setPin(""); setError(""); }}
                style={{
                  minHeight: 100,
                  borderRadius: 20,
                  background: "var(--c-surface)",
                  border: `2px solid transparent`,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  padding: "18px 12px",
                  transition: "transform 0.1s, border-color 0.15s",
                  WebkitTapHighlightColor: "transparent",
                  boxShadow: "var(--c-num-shadow)",
                }}
                onMouseDown={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.95)"; }}
                onMouseUp={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
                onTouchStart={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.95)"; }}
                onTouchEnd={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
              >
                <div style={{
                  width: 56, height: 56, borderRadius: 16,
                  background: p.color || "#3B82F6",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 28,
                }}>
                  {p.icon || "👤"}
                </div>
                <span style={{ color: "var(--c-text)", fontSize: 14, fontWeight: 600, textAlign: "center", lineHeight: 1.2 }}>
                  {p.name}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* QR fallback */}
        <button
          onClick={() => setShowQrLogin(true)}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-text3)", fontSize: 13, textDecoration: "underline" }}
        >
          📷 Σύνδεση με QR κωδικό
        </button>

        {/* Postcard Venue ID */}
        {deviceVenueId && (
          <p style={{
            color: "var(--c-text3)", fontSize: 11, fontFamily: "monospace",
            background: "var(--c-surface)", borderRadius: 8, padding: "6px 12px",
            letterSpacing: "0.05em",
          }}>
            {"\uD83D\uDCCD"} Venue: {deviceVenueId.slice(0, 8).toUpperCase()}
          </p>
        )}

        {/* Device reset */}
        <button
          onClick={() => setDeviceVenueId(null)}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-text3)", fontSize: 12, textDecoration: "underline" }}
        >
          ⚙️ Αλλαγή ρύθμισης συσκευής
        </button>

        {/* Version */}
        <p style={{ color: "var(--c-text3)", fontSize: 10, opacity: 0.5, marginTop: 8 }}>v2.12.1</p>
      </div>
    </div>
  );
}
