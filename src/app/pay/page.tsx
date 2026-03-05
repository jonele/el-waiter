"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { waiterDb, getOpenOrder, calcTotal } from "@/lib/waiterDb";
import { useWaiterStore } from "@/store/waiterStore";
import type { DbOrder, PaymentMethod } from "@/lib/waiterDb";

const QUICK_TIPS = [0.5, 1, 2, 5];

export default function PayPage() {
  const router = useRouter();
  const { waiter, activeTable, settings } = useWaiterStore();
  const [order, setOrder] = useState<DbOrder | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("card_lan");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<"success" | "fail" | null>(null);
  const [cashInput, setCashInput] = useState("");
  const [tip, setTip] = useState(0);
  const [tipInput, setTipInput] = useState("");

  useEffect(() => {
    if (!waiter || !activeTable) { router.replace("/tables"); return; }
    getOpenOrder(activeTable.id).then((o) => setOrder(o ?? null));
  }, [waiter, activeTable]);

  const subtotal = order ? calcTotal(order.items) : 0;
  const total = subtotal + tip;
  const change = cashInput ? Math.max(0, parseFloat(cashInput) - total) : 0;

  function setQuickTip(amount: number) {
    setTip(amount);
    setTipInput(amount.toString());
  }

  function handleTipInput(val: string) {
    setTipInput(val);
    const n = parseFloat(val);
    setTip(isNaN(n) || n < 0 ? 0 : n);
  }

  async function pay() {
    if (!order || !activeTable) return;
    setProcessing(true);

    if (method === "card_lan" || method === "card_bt") {
      const endpoint = method === "card_lan"
        ? `${settings.bridgeUrl}/pay`
        : `${settings.bridgeUrl}/pay/bt`;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: total, order_id: order.id, table: activeTable.name }),
          signal: AbortSignal.timeout(60000),
        });
        if (!res.ok) throw new Error("bridge_fail");
        await markPaid();
        setResult("success");
      } catch {
        setResult("fail");
        setProcessing(false);
        return;
      }
    } else {
      await markPaid();
      setResult("success");
    }
    setProcessing(false);
  }

  async function markPaid() {
    if (!order || !activeTable) return;
    const now = new Date().toISOString();
    await waiterDb.orders.update(order.id, {
      status: "paid",
      payment_method: method,
      tip,
      total: subtotal, // keep items total separate; tip is additional
      updated_at: now,
      paid_at: now,
    });
    await waiterDb.posTables.update(activeTable.id, { status: "free" });
    useWaiterStore.getState().setActiveTable({ ...activeTable, status: "free" });
  }

  if (result === "success") return (
    <div className="flex h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="text-6xl">✅</div>
      <p className="text-2xl font-bold text-white">Πληρώθηκε!</p>
      <div className="w-full max-w-sm rounded-2xl bg-gray-800 p-4 space-y-2 text-left">
        <Row label="Τραπέζι" value={activeTable?.name ?? ""} />
        <Row label="Σύνολο" value={`${subtotal.toFixed(2)}€`} />
        {tip > 0 && <Row label="Φιλοδώρημα" value={`+${tip.toFixed(2)}€`} accent />}
        <Row label="Πληρώθηκε" value={`${total.toFixed(2)}€`} bold />
        {method === "cash" && change > 0 && <Row label="Ρέστα" value={`${change.toFixed(2)}€`} accent />}
        <Row label="Τρόπος" value={METHOD_LABEL[method]} />
      </div>
      <button
        onClick={() => { useWaiterStore.getState().setActiveTable(null); router.replace("/tables"); }}
        className="w-full max-w-sm rounded-2xl bg-brand py-4 font-bold text-white text-lg touch-btn"
      >
        Επόμενο τραπέζι
      </button>
    </div>
  );

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

  return (
    <div className="flex h-screen flex-col">
      <div className="pt-safe bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-400 text-xl touch-btn">←</button>
          <div>
            <p className="font-bold text-white">{activeTable?.name}</p>
            <p className="text-xs text-gray-400">Πληρωμή</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Order summary */}
        {order && (
          <div className="rounded-2xl bg-gray-800 p-4 space-y-2">
            <p className="text-gray-400 text-sm font-medium">Παραγγελία</p>
            {order.items.map((it) => (
              <div key={it.id} className="flex justify-between text-white text-sm">
                <span>{it.name} ×{it.quantity}</span>
                <span>{(it.price * it.quantity).toFixed(2)}€</span>
              </div>
            ))}
            <div className="border-t border-gray-700 pt-2 flex justify-between text-white font-bold">
              <span>Υποσύνολο</span>
              <span>{subtotal.toFixed(2)}€</span>
            </div>
          </div>
        )}

        {/* Tip */}
        <div className="rounded-2xl bg-gray-800 p-4 space-y-3">
          <p className="text-gray-400 text-sm font-medium">Φιλοδώρημα (προαιρετικό)</p>
          <div className="flex gap-2">
            <button
              onClick={() => setQuickTip(0)}
              className={`flex-1 rounded-xl py-2 text-sm font-semibold touch-btn
                ${tip === 0 ? "bg-gray-600 text-white" : "bg-gray-700 text-gray-400"}`}
            >
              Χωρίς
            </button>
            {QUICK_TIPS.map((t) => (
              <button
                key={t}
                onClick={() => setQuickTip(t)}
                className={`flex-1 rounded-xl py-2 text-sm font-semibold touch-btn
                  ${tip === t ? "bg-brand text-white" : "bg-gray-700 text-gray-400"}`}
              >
                +{t}€
              </button>
            ))}
          </div>
          <input
            type="number"
            inputMode="decimal"
            value={tipInput}
            onChange={(e) => handleTipInput(e.target.value)}
            placeholder="Άλλο ποσό..."
            className="w-full rounded-xl bg-gray-700 px-3 py-2 text-white placeholder-gray-500 text-sm outline-none"
          />
        </div>

        {/* Method */}
        <div className="space-y-2">
          <p className="text-gray-400 text-sm font-medium">Τρόπος πληρωμής</p>
          {([
            { id: "card_lan"  as PaymentMethod, label: "💳 Κάρτα (LAN)",        desc: "Viva ISV — τοπικό δίκτυο" },
            ...(settings.btEnabled ? [{ id: "card_bt" as PaymentMethod, label: "🔵 Κάρτα (Bluetooth)", desc: "Viva ISV — Bluetooth" }] : []),
            { id: "cash"      as PaymentMethod, label: "💵 Μετρητά",             desc: "" },
            { id: "preorder"  as PaymentMethod, label: "📱 Προπαραγγελία",       desc: "EL-Loyal / RSRV" },
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

        {/* Cash given */}
        {method === "cash" && (
          <div className="rounded-2xl bg-gray-800 p-4 space-y-2">
            <label className="text-gray-400 text-sm">Δόθηκε ποσό (€)</label>
            <input
              type="number"
              inputMode="decimal"
              value={cashInput}
              onChange={(e) => setCashInput(e.target.value)}
              placeholder="0.00"
              className="w-full bg-transparent text-white text-2xl font-bold outline-none"
            />
            {change > 0 && <p className="text-green-400 font-semibold">Ρέστα: {change.toFixed(2)}€</p>}
          </div>
        )}

        {method === "card_lan" && (
          <p className="text-center text-gray-600 text-xs">Bridge: {settings.bridgeUrl}</p>
        )}
      </div>

      {/* Total + Pay */}
      <div className="border-t border-gray-800 bg-gray-900 px-4 py-3 pb-safe space-y-2">
        {tip > 0 && (
          <div className="flex justify-between text-sm px-1">
            <span className="text-gray-400">Παραγγελία + φιλοδώρημα</span>
            <span className="text-white font-semibold">{subtotal.toFixed(2)}€ + {tip.toFixed(2)}€</span>
          </div>
        )}
        <button
          onClick={pay}
          disabled={processing || !order || order.items.length === 0}
          className="w-full rounded-2xl bg-green-600 py-4 font-bold text-white text-xl touch-btn disabled:opacity-40 transition-opacity"
        >
          {processing ? "Επεξεργασία..." : `Πληρωμή ${total.toFixed(2)}€`}
        </button>
      </div>
    </div>
  );
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Μετρητά",
  card_lan: "Κάρτα (LAN)",
  card_bt: "Κάρτα (Bluetooth)",
  preorder: "Προπαραγγελία",
};

function Row({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-400">{label}</span>
      <span className={bold ? "text-white font-bold text-base" : accent ? "text-green-400 font-semibold" : "text-white"}>
        {value}
      </span>
    </div>
  );
}
