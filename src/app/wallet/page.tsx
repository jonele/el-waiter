"use client";
import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { waiterDb, getWaiterOrders } from "@/lib/waiterDb";
import { useWaiterStore } from "@/store/waiterStore";
import type { DbOrder, PaymentMethod } from "@/lib/waiterDb";

type Tab = "open" | "closed";

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash:     "Μετρητά",
  card_lan: "Κάρτα",
  card_bt:  "Κάρτα BT",
  preorder: "Προπαραγγελία",
};

const METHOD_ICON: Record<PaymentMethod, string> = {
  cash:     "💵",
  card_lan: "💳",
  card_bt:  "🔵",
  preorder: "📱",
};

function todayStart(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function WalletPage() {
  const router = useRouter();
  const { waiter } = useWaiterStore();
  const [orders, setOrders] = useState<DbOrder[]>([]);
  const [tab, setTab] = useState<Tab>("open");
  const [loading, setLoading] = useState(true);
  const [since, setSince] = useState<"today" | "session">("today");

  useEffect(() => {
    if (!waiter) { router.replace("/"); return; }
    load();
  }, [waiter, since]);

  async function load() {
    setLoading(true);
    const sinceIso = since === "today" ? todayStart() : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const rows = await getWaiterOrders(waiter!.id, sinceIso);
    setOrders(rows);
    setLoading(false);
  }

  const open   = useMemo(() => orders.filter((o) => o.status === "open" || o.status === "sent"), [orders]);
  const closed = useMemo(() => orders.filter((o) => o.status === "paid"), [orders]);

  // Financial breakdown (closed/paid only)
  const breakdown = useMemo(() => {
    const cash      = closed.filter((o) => o.payment_method === "cash");
    const card      = closed.filter((o) => o.payment_method === "card_lan" || o.payment_method === "card_bt");
    const preorder  = closed.filter((o) => o.payment_method === "preorder");
    const unknown   = closed.filter((o) => !o.payment_method);

    const sum = (arr: DbOrder[]) => arr.reduce((s, o) => s + o.total, 0);
    const tips = closed.reduce((s, o) => s + (o.tip ?? 0), 0);

    return {
      cash:     { total: sum(cash),     count: cash.length },
      card:     { total: sum(card),     count: card.length },
      preorder: { total: sum(preorder), count: preorder.length },
      unknown:  { total: sum(unknown),  count: unknown.length },
      tips,
      grandTotal: sum(closed) + tips,
      cashOwed: sum(cash) + tips, // cash + tips = what waiter owes business
    };
  }, [closed]);

  const openTotal = useMemo(() => open.reduce((s, o) => s + o.total, 0), [open]);

  if (loading) return (
    <div className="flex h-screen items-center justify-center text-gray-400">Φόρτωση...</div>
  );

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="pt-safe bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/tables")} className="text-gray-400 text-xl touch-btn" aria-label="Πίσω">←</button>
            <div>
              <p className="font-bold text-white">Πορτοφόλι</p>
              <p className="text-xs text-gray-400">{waiter?.name}</p>
            </div>
          </div>
          {/* Period toggle */}
          <div className="flex rounded-xl overflow-hidden bg-gray-800">
            <button
              onClick={() => setSince("today")}
              className={`px-3 py-1.5 text-xs font-medium touch-btn ${since === "today" ? "bg-brand text-white" : "text-gray-400"}`}
            >
              Σήμερα
            </button>
            <button
              onClick={() => setSince("session")}
              className={`px-3 py-1.5 text-xs font-medium touch-btn ${since === "session" ? "bg-brand text-white" : "text-gray-400"}`}
            >
              24ω
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Summary cards */}
        <div className="px-4 pt-4 space-y-3">
          {/* Grand total card */}
          <div className="rounded-2xl bg-brand p-4">
            <p className="text-blue-200 text-xs font-medium">Συνολικές αποδείξεις</p>
            <p className="text-white text-3xl font-bold mt-1">{breakdown.grandTotal.toFixed(2)}€</p>
            <p className="text-blue-200 text-xs mt-1">{closed.length} κλειστές • {open.length} ανοιχτές</p>
          </div>

          {/* Owed to business highlight */}
          <div className="rounded-2xl bg-yellow-500/10 border border-yellow-500/30 p-4">
            <p className="text-yellow-400 text-xs font-medium">Οφείλεις στην επιχείρηση (μετρητά)</p>
            <p className="text-yellow-300 text-2xl font-bold mt-0.5">{breakdown.cashOwed.toFixed(2)}€</p>
            <p className="text-yellow-500 text-xs mt-1">
              {breakdown.cash.total.toFixed(2)}€ μετρητά + {breakdown.tips.toFixed(2)}€ φιλοδωρήματα
            </p>
          </div>

          {/* Method breakdown */}
          <div className="rounded-2xl bg-gray-800 p-4 space-y-3">
            <p className="text-gray-400 text-sm font-medium">Ανάλυση πληρωμών</p>
            <BreakdownRow icon="💵" label="Μετρητά"        total={breakdown.cash.total}    count={breakdown.cash.count} />
            <BreakdownRow icon="💳" label="Κάρτα"          total={breakdown.card.total}    count={breakdown.card.count} />
            <BreakdownRow icon="📱" label="Προπαραγγελία"  total={breakdown.preorder.total} count={breakdown.preorder.count} />
            {breakdown.unknown.count > 0 && (
              <BreakdownRow icon="❓" label="Άγνωστο"      total={breakdown.unknown.total} count={breakdown.unknown.count} />
            )}
            <div className="border-t border-gray-700 pt-2 flex justify-between items-center">
              <span className="text-green-400 text-sm font-medium">🎁 Φιλοδωρήματα</span>
              <span className="text-green-400 font-bold">+{breakdown.tips.toFixed(2)}€</span>
            </div>
          </div>

          {/* Open orders */}
          {open.length > 0 && (
            <div className="rounded-2xl bg-orange-500/10 border border-orange-500/30 p-4">
              <p className="text-orange-400 text-xs font-medium">Ανοιχτές παραγγελίες</p>
              <p className="text-orange-300 text-2xl font-bold mt-0.5">{openTotal.toFixed(2)}€</p>
              <p className="text-orange-500 text-xs">{open.length} τραπέζια σε εξέλιξη</p>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 px-4 mt-4">
          <button
            onClick={() => setTab("open")}
            className={`rounded-full px-4 py-1.5 text-sm font-medium touch-btn ${tab === "open" ? "bg-brand text-white" : "bg-gray-800 text-gray-400"}`}
          >
            Ανοιχτά ({open.length})
          </button>
          <button
            onClick={() => setTab("closed")}
            className={`rounded-full px-4 py-1.5 text-sm font-medium touch-btn ${tab === "closed" ? "bg-brand text-white" : "bg-gray-800 text-gray-400"}`}
          >
            Κλειστά ({closed.length})
          </button>
        </div>

        {/* Order list */}
        <div className="px-4 py-3 space-y-2 pb-safe">
          {(tab === "open" ? open : closed).length === 0 && (
            <p className="text-center text-gray-500 py-8">
              {tab === "open" ? "Χωρίς ανοιχτές παραγγελίες" : "Χωρίς κλειστές παραγγελίες"}
            </p>
          )}
          {(tab === "open" ? open : closed)
            .slice()
            .reverse()
            .map((o) => (
              <div key={o.id} className="rounded-2xl bg-gray-800 px-4 py-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-white font-semibold">{o.table_name}</p>
                    <p className="text-gray-500 text-xs">{new Date(o.created_at).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white font-bold">{o.total.toFixed(2)}€</p>
                    {(o.tip ?? 0) > 0 && (
                      <p className="text-green-400 text-xs">+{o.tip!.toFixed(2)}€ tip</p>
                    )}
                    {o.payment_method && (
                      <p className="text-gray-400 text-xs">
                        {METHOD_ICON[o.payment_method]} {METHOD_LABEL[o.payment_method]}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  {o.items.slice(0, 3).map((it) => `${it.name} ×${it.quantity}`).join(" · ")}
                  {o.items.length > 3 && ` +${o.items.length - 3} ακόμα`}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function BreakdownRow({ icon, label, total, count }: { icon: string; label: string; total: number; count: number }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span>{icon}</span>
        <span className="text-white text-sm">{label}</span>
        {count > 0 && <span className="text-gray-500 text-xs">({count})</span>}
      </div>
      <span className={`font-semibold text-sm ${total > 0 ? "text-white" : "text-gray-600"}`}>
        {total.toFixed(2)}€
      </span>
    </div>
  );
}
