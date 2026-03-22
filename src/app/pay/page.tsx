"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { waiterDb, getOpenOrder, calcTotal } from "@/lib/waiterDb";
import { useWaiterStore } from "@/store/waiterStore";
import { supabase } from "@/lib/supabase";
import type { DbOrder, DbOrderItem, PaymentMethod } from "@/lib/waiterDb";
import SplitModeSelector, { type SplitMode } from "@/components/SplitModeSelector";
import ItemSplitPicker from "@/components/ItemSplitPicker";
import EqualSplitPicker from "@/components/EqualSplitPicker";

// Tauri mobile builds call Vercel API routes over HTTPS via NEXT_PUBLIC_API_BASE
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

const QUICK_TIPS = [0.5, 1, 2, 5];
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 90000;

interface VivaTerminal {
  terminal_id: string;
  name: string;
}

interface SplitPayment {
  index: number;
  amount: number;
  tip: number;
  method: PaymentMethod;
  itemIds: string[] | null; // null = equal or custom split
  paidAt: string;
}

export default function PayPage() {
  const router = useRouter();
  const { waiter, activeTable, settings, deviceVenueId } = useWaiterStore();
  const [order, setOrder] = useState<DbOrder | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("card_lan");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<"success" | "fail" | null>(null);
  const [cashInput, setCashInput] = useState("");
  const [tip, setTip] = useState(0);
  const [tipInput, setTipInput] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  // Split state
  const [splitMode, setSplitMode] = useState<SplitMode>("full");
  const [splitPayments, setSplitPayments] = useState<SplitPayment[]>([]);
  const [paidItemIds, setPaidItemIds] = useState<Set<string>>(new Set());
  const [equalSplitCount, setEqualSplitCount] = useState(0);
  const [customAmount, setCustomAmount] = useState("");
  const [splitAmount, setSplitAmount] = useState<number | null>(null); // the amount for THIS split

  // Viva ISV
  const [terminals, setTerminals] = useState<VivaTerminal[]>([]);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [selectedTerminal, setSelectedTerminal] = useState<VivaTerminal | null>(null);
  const [showTerminalPicker, setShowTerminalPicker] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const venueId = deviceVenueId ?? waiter?.venue_id ?? "";

  useEffect(() => {
    if (!waiter || !activeTable) { router.replace("/tables"); return; }
    getOpenOrder(activeTable.id).then((o) => setOrder(o ?? null));
  }, [waiter, activeTable]);

  // Load Viva terminals for this venue
  useEffect(() => {
    if (!venueId) return;
    fetch(`${API_BASE}/api/viva/terminals?venue_id=${venueId}`)
      .then((r) => r.json())
      .then((data: { terminals: VivaTerminal[]; merchant_id: string | null }) => {
        setTerminals(data.terminals ?? []);
        setMerchantId(data.merchant_id ?? null);
        if (data.terminals?.length === 1) setSelectedTerminal(data.terminals[0]);
      })
      .catch(() => {/* terminals unavailable */});
  }, [venueId]);

  useEffect(() => () => { if (pollTimer.current) clearInterval(pollTimer.current); }, []);

  // ── Computed values ──────────────────────────────────────────────────────
  const subtotal = order ? calcTotal(order.items) : 0;
  const totalPaid = splitPayments.reduce((s, p) => s + p.amount + p.tip, 0);
  const remaining = Math.round((subtotal - splitPayments.reduce((s, p) => s + p.amount, 0)) * 100) / 100;

  // The amount to charge for this specific split
  const chargeAmount = (() => {
    if (splitMode === "full") return remaining + tip;
    if (splitMode === "items" && splitAmount !== null) return splitAmount + tip;
    if (splitMode === "equal" && splitAmount !== null) return splitAmount + tip;
    if (splitMode === "custom") {
      const parsed = parseFloat(customAmount);
      if (!isNaN(parsed) && parsed > 0) return Math.min(parsed, remaining) + tip;
    }
    return 0;
  })();

  const chargeBase = chargeAmount - tip; // amount without tip
  const change = cashInput ? Math.max(0, parseFloat(cashInput) - chargeAmount) : 0;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function setQuickTip(amount: number) { setTip(amount); setTipInput(amount.toString()); }
  function handleTipInput(val: string) {
    setTipInput(val);
    const n = parseFloat(val);
    setTip(isNaN(n) || n < 0 ? 0 : n);
  }

  function resetSplitRound() {
    setTip(0);
    setTipInput("");
    setCashInput("");
    setSplitAmount(null);
    setCustomAmount("");
    setResult(null);
    setStatusMsg("");
    setMethod("card_lan");
  }

  const handleSplitModeChange = useCallback((mode: SplitMode) => {
    setSplitMode(mode);
    setSplitAmount(null);
    setCustomAmount("");
    // Reset equal split count if leaving equal mode
    if (mode !== "equal") setEqualSplitCount(0);
  }, []);

  // ── Mark one split as paid ────────────────────────────────────────────────
  function recordSplitPayment(itemIds: string[] | null) {
    const payment: SplitPayment = {
      index: splitPayments.length + 1,
      amount: chargeBase,
      tip,
      method,
      itemIds,
      paidAt: new Date().toISOString(),
    };
    const newPayments = [...splitPayments, payment];
    setSplitPayments(newPayments);

    // Track paid items
    if (itemIds) {
      setPaidItemIds((prev) => {
        const next = new Set(prev);
        itemIds.forEach((id) => next.add(id));
        return next;
      });
    }

    return newPayments;
  }

  // ── Mark entire order as paid (all splits done) ───────────────────────────
  async function markFullyPaid() {
    if (!order || !activeTable) return;
    const now = new Date().toISOString();
    await waiterDb.orders.update(order.id, {
      status: "paid",
      payment_method: method,
      tip: splitPayments.reduce((s, p) => s + p.tip, 0) + tip,
      total: subtotal,
      updated_at: now,
      paid_at: now,
    });
    await waiterDb.posTables.update(activeTable.id, { status: "free" });
    useWaiterStore.getState().setActiveTable({ ...activeTable, status: "free" });
    void supabase?.from("pos_tables").update({ status: "free" }).eq("id", activeTable.id);
  }

  // ── Viva ISV charge ─────────────────────────────────────────────────────
  async function payViaIsv(amount: number) {
    if (!selectedTerminal || !merchantId) throw new Error("no_terminal");
    const sessionId = `ELW-${Date.now()}-${selectedTerminal.terminal_id.slice(-4)}`;
    const amountCents = Math.round(amount * 100);

    setStatusMsg("Αποστολή στο τερματικό...");
    const chargeRes = await fetch(`${API_BASE}/api/viva/charge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venue_id: venueId,
        terminal_id: selectedTerminal.terminal_id,
        merchant_id: merchantId,
        amount_cents: amountCents,
        session_id: sessionId,
        table_name: activeTable?.name,
      }),
    });
    if (!chargeRes.ok) {
      const err = await chargeRes.json() as { error?: string };
      throw new Error(err.error ?? "charge_failed");
    }

    setStatusMsg("Αναμονή πληρωμής στο τερματικό...");
    return new Promise<void>((resolve, reject) => {
      const start = Date.now();
      pollTimer.current = setInterval(async () => {
        if (Date.now() - start > POLL_TIMEOUT_MS) {
          clearInterval(pollTimer.current!);
          reject(new Error("timeout"));
          return;
        }
        try {
          const r = await fetch(`${API_BASE}/api/viva/status?session_id=${sessionId}&merchant_id=${merchantId}`);
          const s = await r.json() as { success?: boolean; transaction_id?: string; eventId?: number };
          if (s.success && s.transaction_id) {
            clearInterval(pollTimer.current!);
            resolve();
          } else if (s.eventId === 1082) {
            clearInterval(pollTimer.current!);
            reject(new Error("aade_blocked"));
          } else if (s.eventId && ![1100, 1204, 1102].includes(s.eventId)) {
            clearInterval(pollTimer.current!);
            reject(new Error(`event_${s.eventId}`));
          }
        } catch { /* ignore network blip */ }
      }, POLL_INTERVAL_MS);
    });
  }

  // ── Main pay handler ──────────────────────────────────────────────────────
  async function pay() {
    if (!order || !activeTable || chargeAmount <= 0) return;
    setProcessing(true);
    setStatusMsg("");

    try {
      if (method === "card_lan" || method === "card_bt") {
        if (selectedTerminal && merchantId) {
          await payViaIsv(chargeAmount);
        } else {
          const endpoint = method === "card_lan" ? `${settings.bridgeUrl}/pay` : `${settings.bridgeUrl}/pay/bt`;
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ amount: chargeAmount, order_id: order.id, table: activeTable.name }),
            signal: AbortSignal.timeout(60000),
          });
          if (!res.ok) throw new Error("bridge_fail");
        }
      }

      // Determine which item IDs were covered by this split
      let itemIds: string[] | null = null;
      if (splitMode === "items") {
        // Item IDs set by the picker confirmation callback
        itemIds = splitItemIds;
      }

      const newPayments = recordSplitPayment(itemIds);
      const newRemaining = Math.round((subtotal - newPayments.reduce((s, p) => s + p.amount, 0)) * 100) / 100;

      if (newRemaining <= 0.005) {
        // Fully paid
        await markFullyPaid();
        setResult("success");
      } else {
        // More splits needed
        setResult("success");
      }
    } catch (err) {
      setResult("fail");
      const code = err instanceof Error ? err.message : "";
      const ERROR_LABELS: Record<string, string> = {
        bridge_fail: "Αποτυχία σύνδεσης με τερματικό",
        aade_blocked: "Απόρριψη από ΑΑΔΕ — δοκιμάστε ξανά",
        charge_failed: "Αποτυχία χρέωσης",
        timeout: "Λήξη χρόνου αναμονής",
        no_terminal: "Δεν βρέθηκε τερματικό",
      };
      const label = ERROR_LABELS[code] ?? (code.startsWith("event_") ? `Σφάλμα τερματικού (${code})` : code || "Ελέγξτε σύνδεση");
      setStatusMsg(`Αποτυχία: ${label}`);
    }
    setProcessing(false);
  }

  // Track item IDs for the current item-split round
  const [splitItemIds, setSplitItemIds] = useState<string[]>([]);

  // ── Terminal picker handler ──────────────────────────────────────────────
  function handleCardTap() {
    if (terminals.length > 1 && !selectedTerminal) {
      setShowTerminalPicker(true);
    } else {
      void pay();
    }
  }

  // ── Item split confirmation ──────────────────────────────────────────────
  function handleItemSplitConfirm(selectedIds: string[], itemSubtotal: number) {
    setSplitItemIds(selectedIds);
    setSplitAmount(itemSubtotal);
  }

  // ── Equal split confirmation ─────────────────────────────────────────────
  function handleEqualSplitConfirm(count: number, perPerson: number) {
    setEqualSplitCount(count);
    setSplitAmount(perPerson);
  }

  // ── Derived state ────────────────────────────────────────────────────────
  const allPaid = remaining <= 0.005 && splitPayments.length > 0;
  const isReadyToPay = (() => {
    if (splitMode === "full") return remaining > 0;
    if (splitMode === "items") return splitAmount !== null && splitAmount > 0;
    if (splitMode === "equal") return splitAmount !== null && splitAmount > 0;
    if (splitMode === "custom") {
      const parsed = parseFloat(customAmount);
      return !isNaN(parsed) && parsed > 0 && parsed <= remaining;
    }
    return false;
  })();

  // ── SUCCESS SCREEN ────────────────────────────────────────────────────────
  if (result === "success") {
    const newRemaining = Math.round(
      (subtotal - splitPayments.reduce((s, p) => s + p.amount, 0)) * 100
    ) / 100;
    const fullyPaid = newRemaining <= 0.005;

    return (
      <div className="flex h-screen flex-col items-center justify-center gap-5 px-6 text-center">
        <div className="text-6xl">{fullyPaid ? "✅" : "✓"}</div>
        <p className="text-2xl font-bold text-white">
          {fullyPaid ? "Πληρώθηκε!" : `Μερική πληρωμή ${splitPayments.length}`}
        </p>

        <div className="w-full max-w-sm rounded-2xl bg-gray-800 p-4 space-y-2 text-left">
          <Row label="Τραπέζι" value={activeTable?.name ?? ""} />
          <Row label="Σύνολο" value={`${subtotal.toFixed(2)}€`} />
          {splitPayments.length > 0 && (
            <>
              <div className="border-t border-gray-700 pt-2 mt-2">
                <span className="text-2xs text-gray-500 uppercase font-bold">Πληρωμές</span>
              </div>
              {splitPayments.map((sp) => (
                <Row
                  key={sp.index}
                  label={`#${sp.index} ${METHOD_LABEL[sp.method]}`}
                  value={`${(sp.amount + sp.tip).toFixed(2)}€`}
                  accent
                />
              ))}
            </>
          )}
          {!fullyPaid && (
            <Row label="Υπόλοιπο" value={`${newRemaining.toFixed(2)}€`} bold />
          )}
        </div>

        {fullyPaid ? (
          <button
            onClick={() => {
              useWaiterStore.getState().setActiveTable(null);
              router.replace("/tables");
            }}
            className="w-full max-w-sm rounded-2xl bg-brand py-4 font-bold text-white text-lg touch-btn"
          >
            Επόμενο τραπέζι
          </button>
        ) : (
          <button
            onClick={resetSplitRound}
            className="w-full max-w-sm rounded-2xl bg-brand py-4 font-bold text-white text-lg touch-btn"
          >
            Επόμενη πληρωμή ({newRemaining.toFixed(2)}€)
          </button>
        )}
      </div>
    );
  }

  // ── FAIL SCREEN ──────────────────────────────────────────────────────────
  if (result === "fail") return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="text-6xl">❌</div>
      <p className="text-2xl font-bold text-white">Αποτυχία πληρωμής</p>
      <p className="text-gray-400 text-sm">Δεν ήταν δυνατή η σύνδεση με το τερματικό.</p>
      <div className="flex gap-3 w-full max-w-sm">
        <button onClick={() => setResult(null)} className="flex-1 rounded-2xl bg-gray-800 py-4 font-semibold text-white touch-btn">
          Ξαναπροσπάθεια
        </button>
        <button onClick={() => { setMethod("cash"); setResult(null); }} className="flex-1 rounded-2xl bg-brand py-4 font-semibold text-white touch-btn">
          Μετρητά
        </button>
      </div>
    </div>
  );

  // ── PROCESSING SCREEN ────────────────────────────────────────────────────
  if (processing) return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="text-5xl animate-pulse">💳</div>
      <p className="text-xl font-bold text-white">{chargeAmount.toFixed(2)}€</p>
      <p className="text-gray-400 text-sm">{statusMsg || "Επεξεργασία πληρωμής..."}</p>
      {splitPayments.length > 0 && (
        <p className="text-gray-600 text-xs">Μερική πληρωμή #{splitPayments.length + 1}</p>
      )}
      {selectedTerminal && (
        <p className="text-gray-600 text-xs">Τερματικό: {selectedTerminal.name}</p>
      )}
    </div>
  );

  // ── MAIN PAY SCREEN ──────────────────────────────────────────────────────
  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="pt-safe bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-400 text-xl touch-btn" aria-label="Πίσω">←</button>
          <div className="flex-1">
            <p className="font-bold text-white">{activeTable?.name}</p>
            <p className="text-xs text-gray-400">Πληρωμή</p>
          </div>
          {splitPayments.length > 0 && (
            <div className="text-right">
              <p className="text-xs text-gray-500">Υπόλοιπο</p>
              <p className="text-sm font-bold text-amber-400">{remaining.toFixed(2)}€</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Split mode selector */}
        <SplitModeSelector selected={splitMode} onChange={handleSplitModeChange} />

        {/* Paid splits summary */}
        {splitPayments.length > 0 && (
          <div className="rounded-2xl bg-slate-900 p-3 space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-2xs text-gray-500 uppercase font-bold">Πληρωμές</span>
              <span className="text-xs text-gray-400 font-semibold">
                {totalPaid.toFixed(2)}€ / {subtotal.toFixed(2)}€
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all"
                style={{ width: `${Math.min(100, (splitPayments.reduce((s, p) => s + p.amount, 0) / subtotal) * 100)}%` }}
              />
            </div>
            {splitPayments.map((sp) => (
              <div key={sp.index} className="flex justify-between text-xs">
                <span className="text-gray-400">#{sp.index} {METHOD_LABEL[sp.method]}</span>
                <span className="text-accent font-semibold">{(sp.amount + sp.tip).toFixed(2)}€</span>
              </div>
            ))}
          </div>
        )}

        {/* FULL MODE: Order summary */}
        {splitMode === "full" && order && (
          <div className="rounded-2xl bg-gray-800 p-4 space-y-2">
            <p className="text-gray-400 text-sm font-medium">Παραγγελία</p>
            {order.items.map((it) => (
              <div key={it.id} className="flex justify-between text-white text-sm">
                <span>{it.name} x{it.quantity}</span>
                <span>{(it.price * it.quantity).toFixed(2)}€</span>
              </div>
            ))}
            <div className="border-t border-gray-700 pt-2 flex justify-between text-white font-bold">
              <span>Υποσύνολο</span>
              <span>{remaining.toFixed(2)}€</span>
            </div>
          </div>
        )}

        {/* ITEM SPLIT MODE */}
        {splitMode === "items" && order && splitAmount === null && (
          <ItemSplitPicker
            items={order.items}
            paidItemIds={paidItemIds}
            onConfirm={handleItemSplitConfirm}
            onCancel={() => setSplitMode("full")}
          />
        )}

        {/* ITEM SPLIT: confirmed, now show tip/method */}
        {splitMode === "items" && splitAmount !== null && (
          <div className="rounded-2xl bg-slate-900 p-4 space-y-1">
            <p className="text-gray-400 text-sm font-medium">Επιλεγμένα είδη</p>
            <p className="text-white text-2xl font-extrabold">{splitAmount.toFixed(2)}€</p>
            <button
              className="text-brand text-xs font-semibold underline"
              onClick={() => { setSplitAmount(null); setSplitItemIds([]); }}
            >
              Αλλαγή επιλογής
            </button>
          </div>
        )}

        {/* EQUAL SPLIT MODE */}
        {splitMode === "equal" && splitAmount === null && (
          <EqualSplitPicker
            totalAmount={remaining}
            completedSplits={splitPayments.filter((sp) => sp.itemIds === null && equalSplitCount > 0).length}
            onConfirm={handleEqualSplitConfirm}
            onCancel={() => setSplitMode("full")}
          />
        )}

        {/* EQUAL SPLIT: confirmed, now show tip/method */}
        {splitMode === "equal" && splitAmount !== null && (
          <div className="rounded-2xl bg-slate-900 p-4 space-y-1">
            <p className="text-gray-400 text-sm font-medium">
              Ισόποσος {equalSplitCount}-μερής
            </p>
            <p className="text-white text-2xl font-extrabold">{splitAmount.toFixed(2)}€</p>
            <button
              className="text-brand text-xs font-semibold underline"
              onClick={() => { setSplitAmount(null); setEqualSplitCount(0); }}
            >
              Αλλαγή
            </button>
          </div>
        )}

        {/* CUSTOM AMOUNT MODE */}
        {splitMode === "custom" && (
          <div className="rounded-2xl bg-gray-800 p-4 space-y-3">
            <p className="text-gray-400 text-sm font-medium">Ποσό πληρωμής</p>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-2xl font-bold">€</span>
              <input
                type="number"
                inputMode="decimal"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                placeholder="0.00"
                className="flex-1 bg-transparent text-white text-3xl font-extrabold outline-none"
              />
            </div>
            <p className="text-xs text-gray-500">
              Μέγιστο: {remaining.toFixed(2)}€
            </p>
            {parseFloat(customAmount) > remaining && (
              <p className="text-xs text-red-400 font-semibold">
                Το ποσό ξεπερνά το υπόλοιπο
              </p>
            )}
          </div>
        )}

        {/* Tip section (show after split amount is determined) */}
        {(splitMode === "full" || splitAmount !== null || (splitMode === "custom" && parseFloat(customAmount) > 0)) && (
          <div className="rounded-2xl bg-gray-800 p-4 space-y-3">
            <p className="text-gray-400 text-sm font-medium">Φιλοδώρημα (προαιρετικό)</p>
            <div className="flex gap-2">
              <button onClick={() => setQuickTip(0)} className={`flex-1 rounded-xl py-2 text-sm font-semibold touch-btn ${tip === 0 ? "bg-gray-600 text-white" : "bg-gray-700 text-gray-400"}`}>Χωρίς</button>
              {QUICK_TIPS.map((t) => (
                <button key={t} onClick={() => setQuickTip(t)} className={`flex-1 rounded-xl py-2 text-sm font-semibold touch-btn ${tip === t ? "bg-brand text-white" : "bg-gray-700 text-gray-400"}`}>+{t}€</button>
              ))}
            </div>
            <input type="number" inputMode="decimal" value={tipInput} onChange={(e) => handleTipInput(e.target.value)} placeholder="Άλλο ποσό..." className="w-full rounded-xl bg-gray-700 px-3 py-2 text-white placeholder-gray-500 text-sm outline-none" />
          </div>
        )}

        {/* Payment method (show after split amount is determined) */}
        {(splitMode === "full" || splitAmount !== null || (splitMode === "custom" && parseFloat(customAmount) > 0)) && (
          <div className="space-y-2">
            <p className="text-gray-400 text-sm font-medium">Τρόπος πληρωμής</p>
            {([
              { id: "card_lan" as PaymentMethod, label: "💳 Κάρτα", desc: terminals.length > 0 ? `Viva ISV — ${terminals.length} τερματικό${terminals.length > 1 ? "ά" : ""}` : "Viva ISV" },
              { id: "cash"     as PaymentMethod, label: "💵 Μετρητά",       desc: "" },
              { id: "preorder" as PaymentMethod, label: "📱 Προπαραγγελία", desc: "EL-Loyal / RSRV" },
            ] as { id: PaymentMethod; label: string; desc: string }[]).map((m) => (
              <button
                key={m.id}
                onClick={() => setMethod(m.id)}
                className={`w-full flex items-center justify-between rounded-2xl px-4 py-4 touch-btn transition-colors
                  ${method === m.id ? "bg-brand/20 border-2 border-brand" : "bg-gray-800 border-2 border-transparent"}`}
              >
                <div className="text-left">
                  <p className="text-white font-medium">{m.label}</p>
                  {m.desc && <p className="text-gray-400 text-xs">{m.desc}</p>}
                </div>
                {method === m.id && <span className="text-brand text-xl">✓</span>}
              </button>
            ))}
          </div>
        )}

        {/* Terminal selector (card, multiple terminals) */}
        {(splitMode === "full" || splitAmount !== null || (splitMode === "custom" && parseFloat(customAmount) > 0)) &&
          method === "card_lan" && terminals.length > 1 && (
          <div className="space-y-2">
            <p className="text-gray-400 text-sm font-medium">Τερματικό</p>
            {terminals.map((t) => (
              <button
                key={t.terminal_id}
                onClick={() => setSelectedTerminal(t)}
                className={`w-full flex items-center justify-between rounded-2xl px-4 py-4 touch-btn transition-colors
                  ${selectedTerminal?.terminal_id === t.terminal_id ? "bg-green-900/40 border-2 border-green-500" : "bg-gray-800 border-2 border-transparent"}`}
              >
                <span className="text-white font-medium">{t.name}</span>
                {selectedTerminal?.terminal_id === t.terminal_id && <span className="text-green-400 text-xl">✓</span>}
              </button>
            ))}
          </div>
        )}

        {/* Cash input */}
        {(splitMode === "full" || splitAmount !== null || (splitMode === "custom" && parseFloat(customAmount) > 0)) &&
          method === "cash" && (
          <div className="rounded-2xl bg-gray-800 p-4 space-y-2">
            <label className="text-gray-400 text-sm">Δόθηκε ποσό (€)</label>
            <input type="number" inputMode="decimal" value={cashInput} onChange={(e) => setCashInput(e.target.value)} placeholder="0.00" className="w-full bg-transparent text-white text-2xl font-bold outline-none" />
            {change > 0 && <p className="text-green-400 font-semibold">Ρέστα: {change.toFixed(2)}€</p>}
          </div>
        )}
      </div>

      {/* Total + Pay button (only when ready) */}
      {(splitMode === "full" || splitAmount !== null || (splitMode === "custom" && parseFloat(customAmount) > 0)) && (
        <div className="border-t border-gray-800 bg-gray-900 px-4 py-3 pb-safe space-y-2">
          {tip > 0 && (
            <div className="flex justify-between text-sm px-1">
              <span className="text-gray-400">
                {splitMode === "full" ? "Παραγγελία" : "Μερική πληρωμή"} + φιλοδώρημα
              </span>
              <span className="text-white font-semibold">{chargeBase.toFixed(2)}€ + {tip.toFixed(2)}€</span>
            </div>
          )}
          <button
            onClick={method === "card_lan" ? handleCardTap : pay}
            disabled={!order || !isReadyToPay || (method === "card_lan" && terminals.length > 1 && !selectedTerminal)}
            className="w-full rounded-2xl bg-green-600 py-4 font-bold text-white text-xl touch-btn disabled:opacity-40 transition-opacity"
          >
            {splitMode === "full"
              ? `Πληρωμή ${chargeAmount.toFixed(2)}€`
              : `Μερική πληρωμή ${chargeAmount.toFixed(2)}€`}
          </button>
          {method === "card_lan" && terminals.length > 1 && !selectedTerminal && (
            <p className="text-center text-amber-400 text-xs">Επιλέξτε τερματικό παραπάνω</p>
          )}
        </div>
      )}

      {/* Terminal picker bottom sheet */}
      {showTerminalPicker && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setShowTerminalPicker(false)}>
          <div className="w-full bg-gray-900 rounded-t-3xl p-6 space-y-4 animate-[slideUp_0.25s_ease-out]" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-1 bg-gray-600 rounded-full mx-auto" />
            <p className="text-white font-bold text-lg text-center">Επιλέξτε τερματικό</p>
            {terminals.map((t) => (
              <button
                key={t.terminal_id}
                onClick={() => { setSelectedTerminal(t); setShowTerminalPicker(false); void pay(); }}
                className="w-full rounded-2xl bg-gray-800 px-4 py-5 text-left touch-btn hover:bg-gray-700"
              >
                <p className="text-white font-semibold text-lg">{t.name}</p>
                <p className="text-gray-500 text-xs">{t.terminal_id}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Μετρητά",
  card_lan: "Κάρτα",
  card_bt: "Κάρτα (Bluetooth)",
  preorder: "Προπαραγγελία",
};

function Row({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-400">{label}</span>
      <span className={bold ? "text-white font-bold text-base" : accent ? "text-green-400 font-semibold" : "text-white"}>{value}</span>
    </div>
  );
}
