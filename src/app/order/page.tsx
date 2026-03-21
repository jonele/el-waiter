"use client";
import { Suspense, useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { waiterDb, getOpenOrder, calcTotal } from "@/lib/waiterDb";
import { useWaiterStore } from "@/store/waiterStore";
import { supabase, decodeUnicodeEscapes } from "@/lib/supabase";
import { v4 as uuidv4 } from "uuid";
import type { DbMenuCategory, DbMenuItem, DbOrderItem, DbOrder, DbTable } from "@/lib/waiterDb";

// Virtual table for takeaway orders
const TAKEAWAY_TABLE: DbTable = {
  id: "takeaway",
  venue_id: "",
  name: "TAKEAWAY",
  floor_section_id: undefined,
  capacity: 1,
  status: "free",
  sort_order: 0,
  is_active: true,
  seated_customer_name: undefined,
  seated_covers: undefined,
  seated_allergies: [],
  seated_dietary: [],
};

// Upsell keyword detection
const DRINK_KW   = ["ποτό","μπύρα","κρασί","drink","beer","wine","cocktail","ουίσκι","ούζο","τσίπουρο","νερό","χυμό","σόδα","καφέ","espresso"];
const DESSERT_KW = ["γλυκό","παγωτό","τάρτα","dessert","cake","tiramisu","σοκολάτα"];
const FOOD_KW    = ["σαλάτα","σουβλάκι","μακαρόν","πίτα","κοτόπουλο","μπριζόλα","pasta","pizza","σπαγγέτι","μπιφτέκι"];

function detectUpsell(items: DbOrderItem[]): string[] {
  const names = items.map((i) => i.name.toLowerCase()).join(" ");
  const msgs: string[] = [];
  if (!DRINK_KW.some((k) => names.includes(k)))
    msgs.push("Προτείνετε ποτό ή αναψυκτικό;");
  if (FOOD_KW.some((k) => names.includes(k)) && !DESSERT_KW.some((k) => names.includes(k)))
    msgs.push("Θα ήθελε γλυκό ή επιδόρπιο;");
  return msgs;
}

function groupBySeat(items: DbOrderItem[]): Map<number | null, DbOrderItem[]> {
  const map = new Map<number | null, DbOrderItem[]>();
  for (const item of items) {
    const seat = item.seat ?? null;
    if (!map.has(seat)) map.set(seat, []);
    map.get(seat)!.push(item);
  }
  return map;
}

export default function OrderPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100dvh", background: "var(--c-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}><p style={{ color: "var(--c-text3)" }}>Φόρτωση...</p></div>}>
      <OrderPageInner />
    </Suspense>
  );
}

function OrderPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { waiter, activeTable: storeTable, settings, isOnline } = useWaiterStore();
  const [categories, setCategories] = useState<DbMenuCategory[]>([]);
  const [items, setItems] = useState<DbMenuItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [order, setOrder] = useState<DbOrder | null>(null);
  const [orderItems, setOrderItems] = useState<DbOrderItem[]>([]);
  const [sending, setSending] = useState(false);
  const [upsells, setUpsells] = useState<string[]>([]);
  const [showUpsell, setShowUpsell] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"menu" | "cart">("menu");
  const [activeSeat, setActiveSeat] = useState<number | null>(null);

  // Check if this is a takeaway order
  const isTakeaway = searchParams.get("takeaway") === "1";
  const activeTable = isTakeaway ? { ...TAKEAWAY_TABLE, venue_id: waiter?.venue_id || "" } : storeTable;

  const capacity = activeTable?.capacity ?? 1;
  const showSeatPicker = !isTakeaway && capacity >= 2;

  useEffect(() => {
    if (!waiter) { router.replace("/tables"); return; }
    if (!activeTable && !isTakeaway) { router.replace("/tables"); return; }
    loadData();
  }, [waiter, activeTable, isTakeaway]);

  async function loadData() {
    const vid = useWaiterStore.getState().deviceVenueId || waiter!.venue_id;
    const [cats, existingOrder] = await Promise.all([
      waiterDb.menuCategories.where("venue_id").equals(vid).sortBy("sort_order"),
      getOpenOrder(activeTable!.id),
    ]);
    let activeCats = cats.filter((c) => c.is_active);
    setCategories(activeCats);

    if (existingOrder) {
      setOrder(existingOrder);
      setOrderItems(existingOrder.items);
    }

    // Always fetch fresh from Supabase when online
    if (isOnline && supabase && vid) {
      const [{ data: dbCats }, { data: dbItems }] = await Promise.all([
        supabase.from("menu_categories").select("*").eq("venue_id", vid).eq("is_active", true),
        supabase.from("menu_items").select("*").eq("venue_id", vid).eq("is_active", true).eq("is_available", true),
      ]);
      if (dbCats) await waiterDb.menuCategories.bulkPut(dbCats);
      if (dbItems) await waiterDb.menuItems.bulkPut(dbItems);
      const freshCats = await waiterDb.menuCategories.where("venue_id").equals(vid).sortBy("sort_order");
      activeCats = freshCats.filter((c) => c.is_active);
      setCategories(activeCats);
    }

    // Set first category and load its items immediately
    const firstCatId = activeCats[0]?.id ?? "";
    if (firstCatId) {
      setActiveCategory(firstCatId);
      void loadItems(firstCatId);
    }
  }

  async function loadItems(catId: string) {
    if (!catId) return;
    let its = await waiterDb.menuItems
      .where("category_id").equals(catId)
      .and((i) => i.is_active && i.is_available)
      .sortBy("sort_order");
    // Fallback: if local DB empty for this category, fetch from Supabase
    if (its.length === 0 && isOnline && supabase) {
      const { data } = await supabase
        .from("menu_items")
        .select("*")
        .eq("category_id", catId)
        .eq("is_active", true)
        .eq("is_available", true)
        .order("sort_order");
      if (data && data.length > 0) {
        await waiterDb.menuItems.bulkPut(data);
        its = data as DbMenuItem[];
      }
    }
    setItems(its);
  }

  useEffect(() => { if (activeCategory) loadItems(activeCategory); }, [activeCategory]);

  const filtered = useMemo(() =>
    search ? items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase())) : items,
    [items, search]);

  // Total quantity of an item across all seats (for menu grid badge)
  function itemCartQty(menuItemId: string): number {
    return orderItems.filter((o) => o.menu_item_id === menuItemId).reduce((s, o) => s + o.quantity, 0);
  }

  function addItem(item: DbMenuItem) {
    setOrderItems((prev) => {
      // Group by item + seat combination so same item for different seats stays separate
      const existing = prev.find(
        (o) => o.menu_item_id === item.id && (o.seat ?? null) === activeSeat
      );
      if (existing) {
        return prev.map((o) =>
          o.menu_item_id === item.id && (o.seat ?? null) === activeSeat
            ? { ...o, quantity: o.quantity + 1 }
            : o
        );
      }
      const newItem: DbOrderItem = {
        id: uuidv4(),
        menu_item_id: item.id,
        name: item.name,
        price: item.price,
        quantity: 1,
      };
      if (activeSeat !== null) newItem.seat = activeSeat;
      return [...prev, newItem];
    });
  }

  async function removeItem(itemId: string) {
    const next = orderItems.filter((o) => o.id !== itemId);
    setOrderItems(next);
    if (order) {
      const newTotal = calcTotal(next);
      await waiterDb.orders.update(order.id, { items: next, total: newTotal, synced: false });
      setOrder((prev) => prev ? { ...prev, items: next, total: newTotal } : prev);
    }
  }

  async function updateItemQty(itemId: string, newQty: number) {
    if (newQty <= 0) { await removeItem(itemId); return; }
    const next = orderItems.map((o) => o.id === itemId ? { ...o, quantity: newQty } : o);
    setOrderItems(next);
    if (order) {
      const newTotal = calcTotal(next);
      await waiterDb.orders.update(order.id, { items: next, total: newTotal, synced: false });
      setOrder((prev) => prev ? { ...prev, items: next, total: newTotal } : prev);
    }
  }

  const total = calcTotal(orderItems);
  const minOk = !settings.minConsumptionEur || total >= settings.minConsumptionEur;
  const cartCount = orderItems.reduce((s, i) => s + i.quantity, 0);
  const seatGroups = useMemo(() => groupBySeat(orderItems), [orderItems]);

  async function sendToKitchen() {
    if (!waiter || !activeTable || orderItems.length === 0) return;
    setSending(true);
    const now = new Date().toISOString();
    const newOrder: DbOrder = order
      ? { ...order, items: orderItems, total, updated_at: now, synced: false }
      : {
          id: uuidv4(), table_id: activeTable.id, table_name: activeTable.name,
          waiter_id: waiter.id, waiter_name: waiter.name, venue_id: waiter!.venue_id,
          items: orderItems, total, tip: 0, status: "sent",
          created_at: now, updated_at: now, sent_at: now, synced: false,
        };

    await waiterDb.orders.put(newOrder);
    await waiterDb.posTables.update(activeTable.id, { status: "occupied" });
    useWaiterStore.getState().setActiveTable({ ...activeTable, status: "occupied" });

    let synced = false;
    if (isOnline && supabase) {
      try {
        await supabase.from("kitchen_orders").upsert({
          id: newOrder.id, venue_id: waiter!.venue_id,
          tab_name: activeTable.name, cashier_name: waiter.name,
          items: orderItems, status: "pending", created_at: newOrder.created_at,
        });
        await waiterDb.orders.update(newOrder.id, { synced: true });
        synced = true;
      } catch {}
    }

    if (!synced) {
      await waiterDb.syncQueue.add({ type: "order_send", payload: JSON.stringify(newOrder), created_at: now, retries: 0 });
      const cnt = await waiterDb.syncQueue.count();
      useWaiterStore.getState().setPendingSyncs(cnt);
    }

    setOrder(newOrder);
    setSending(false);

    const ups = detectUpsell(orderItems);
    if (ups.length > 0) { setUpsells(ups); setShowUpsell(true); }
    else router.push("/tables");
  }

  return (
    <div className="flex h-screen flex-col" style={{ background: "var(--c-bg)" }}>

      {/* Upsell — bottom sheet */}
      {showUpsell && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70">
          <div
            className="w-full max-w-lg rounded-t-3xl px-6 pt-4 pb-safe space-y-4 animate-[slideUp_0.25s_ease-out]"
            style={{ background: "var(--c-surface)" }}
          >
            <div className="mx-auto w-10 h-1 rounded-full" style={{ background: "var(--c-surface2)" }} />
            <p className="text-xl font-black text-center pt-2" style={{ color: "var(--c-text)" }}>Πρόταση</p>
            {upsells.map((u, i) => (
              <div key={i} className="rounded-2xl bg-brand/10 border border-brand/30 p-4 text-center text-sm leading-relaxed" style={{ color: "var(--c-text)" }}>
                {u}
              </div>
            ))}
            <button
              onClick={() => { setShowUpsell(false); router.push("/tables"); }}
              className="w-full rounded-2xl bg-brand h-14 font-black text-white text-base active:scale-95 transition-transform mb-2"
            >
              Εντάξει, επόμενο τραπέζι
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div
        className="pt-safe sticky top-0 z-30 backdrop-blur-md border-b"
        style={{ background: "var(--c-header)", borderColor: "var(--c-border)" }}
      >

        {/* Top row: back / table name / pay */}
        <div className="px-2 py-2 flex items-center justify-between gap-2">
          <button
            onClick={() => router.push("/tables")}
            className="flex items-center justify-center w-[60px] h-[60px] text-gray-400 active:text-white transition-colors shrink-0"
            aria-label="Πίσω"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="text-center flex-1">
            <p className="font-black text-xl leading-none" style={{ color: "var(--c-text)" }}>{activeTable?.name}</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--c-text2)" }}>{waiter?.name}</p>
          </div>

          <button
            onClick={() => router.push("/pay")}
            className="shrink-0 rounded-full bg-accent px-5 py-2.5 font-semibold text-white text-sm active:bg-emerald-700 active:scale-95 transition-all mr-2"
          >
            Πληρωμή
          </button>
        </div>

        {/* Sub-bar: menu/cart toggle + total */}
        <div className="px-4 pb-2 flex items-center justify-between gap-2">
          <div className="flex gap-2">
            <button
              onClick={() => setTab("menu")}
              className={`rounded-full px-4 h-9 text-sm font-semibold transition-colors
                ${tab === "menu" ? "bg-brand text-white" : "bg-gray-800 text-gray-400 active:bg-gray-700"}`}
            >
              Μενού
            </button>
            <button
              onClick={() => setTab("cart")}
              className={`rounded-full px-4 h-9 text-sm font-semibold transition-colors relative
                ${tab === "cart" ? "bg-brand text-white" : "bg-gray-800 text-gray-400 active:bg-gray-700"}`}
            >
              Καλάθι{cartCount > 0 ? ` (${cartCount})` : ""}
            </button>
          </div>
          <span
            className={`font-black text-xl ${!minOk ? "text-amber-400" : ""}`}
            style={minOk ? { color: "var(--c-text)" } : {}}
          >
            {total.toFixed(2)}€
          </span>
        </div>

        {/* Seat picker row — only for tables with 2+ seats */}
        {showSeatPicker && (
          <div className="px-4 pb-3 flex items-center gap-2.5">
            <span className="text-xs text-gray-500 shrink-0 font-medium">Θέση:</span>
            <div className="flex gap-1.5 overflow-x-auto">
              <button
                onClick={() => setActiveSeat(null)}
                className={`shrink-0 rounded-full px-3 h-7 text-xs font-semibold transition-colors
                  ${activeSeat === null ? "bg-gray-200 text-gray-900" : "bg-gray-800 text-gray-400 active:bg-gray-700"}`}
              >
                Όλα
              </button>
              {Array.from({ length: capacity }, (_, i) => i + 1).map((s) => (
                <button
                  key={s}
                  onClick={() => setActiveSeat(s === activeSeat ? null : s)}
                  className={`shrink-0 w-7 h-7 rounded-full text-xs font-black transition-colors
                    ${activeSeat === s ? "bg-brand text-white" : "bg-gray-800 text-gray-400 active:bg-gray-700"}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Allergy / dietary alert panel */}
      {((activeTable?.seated_allergies && activeTable.seated_allergies.length > 0) ||
        (activeTable?.seated_dietary && activeTable.seated_dietary.length > 0)) && (
        <div
          style={{
            margin: "8px 12px 0",
            padding: "10px 14px",
            borderRadius: "12px",
            background: "rgba(245,158,11,0.15)",
            border: "1px solid rgba(245,158,11,0.4)",
          }}
        >
          {activeTable?.seated_allergies && activeTable.seated_allergies.length > 0 && (
            <p style={{ margin: 0, fontSize: "13px", lineHeight: "1.4" }}>
              <span style={{ color: "#F59E0B", fontWeight: 700 }}>
                {"⚠️ ΑΛΛΕΡΓΙΕΣ: "}
              </span>
              <span style={{ color: "#fcd34d" }}>
                {activeTable.seated_allergies.join(", ")}
              </span>
            </p>
          )}
          {activeTable?.seated_dietary && activeTable.seated_dietary.length > 0 && (
            <p style={{ margin: "4px 0 0", fontSize: "13px", lineHeight: "1.4" }}>
              <span style={{ color: "#10B981" }}>
                {"🌱 "}
              </span>
              <span style={{ color: "#6ee7b7" }}>
                {activeTable.seated_dietary.join(", ")}
              </span>
            </p>
          )}
        </div>
      )}

      {/* MENU TAB */}
      {tab === "menu" ? (
        <div className="flex flex-1 overflow-hidden">

          {/* Category sidebar */}
          <div
            className="w-20 shrink-0 overflow-y-auto border-r py-1"
            style={{ background: "var(--c-surface)", borderColor: "var(--c-border)" }}
          >
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => { setActiveCategory(c.id); setSearch(""); }}
                className={`w-full min-h-[60px] px-1 py-3 flex flex-col items-center justify-center gap-1 transition-colors
                  ${activeCategory === c.id ? "border-r-2 border-brand bg-brand/10" : "active:opacity-60"}`}
                style={{ color: activeCategory === c.id ? "#3B82F6" : "var(--c-text2)" }}
              >
                {c.color && (
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: c.color }}
                  />
                )}
                <span className="text-[11px] font-medium leading-tight text-center line-clamp-2 px-1">
                  {decodeUnicodeEscapes(c.name)}
                </span>
              </button>
            ))}
          </div>

          {/* Items grid */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-3 pb-1">
              <input
                type="search"
                placeholder="Αναζήτηση..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                style={{ background: "var(--c-surface2)", color: "var(--c-text)" }}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 px-3 pb-[calc(80px+env(safe-area-inset-bottom))] sm:grid-cols-3">
              {filtered.map((item) => {
                const qty = itemCartQty(item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => addItem(item)}
                    className={`relative flex flex-col rounded-2xl p-3 text-left min-h-[80px] transition-all active:scale-95 duration-75
                      ${qty > 0 ? "border border-brand/50 bg-brand/10" : ""}`}
                    style={qty === 0 ? { background: "var(--c-surface2)" } : {}}
                  >
                    <span className="text-sm font-semibold leading-snug line-clamp-2 flex-1" style={{ color: "var(--c-text)" }}>
                      {decodeUnicodeEscapes(item.name)}
                    </span>
                    <span className="text-accent font-bold text-sm mt-1.5">
                      {item.price.toFixed(2)}€
                    </span>
                    {qty > 0 && (
                      <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-brand text-white text-xs font-black flex items-center justify-center">
                        {qty}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* CART TAB — grouped by seat */
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5" style={{ paddingBottom: "calc(140px + env(safe-area-inset-bottom))" }}>
          {orderItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center mt-20 gap-5">
              <p className="text-lg font-semibold" style={{ color: "var(--c-text3)" }}>Κενή παραγγελία</p>
              <button
                onClick={() => setTab("menu")}
                className="rounded-2xl px-6 h-12 font-semibold text-sm active:scale-95 transition-transform"
                style={{ background: "var(--c-surface2)", color: "var(--c-text)" }}
              >
                ← Μενού
              </button>
            </div>
          ) : (
            Array.from(seatGroups.entries())
              .sort(([a], [b]) => (a ?? 999) - (b ?? 999))
              .map(([seat, group]) => (
                <div key={seat ?? "none"}>
                  {showSeatPicker && (
                    <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                      {seat !== null ? `Θεση ${seat}` : "Χωρις θεση"}
                    </p>
                  )}
                  <div className="space-y-2">
                    {group.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center rounded-2xl px-4 min-h-[56px] gap-2"
                        style={{ background: "var(--c-surface)" }}
                      >
                        {/* Seat badge */}
                        {item.seat != null && (
                          <span
                            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black"
                            style={{ background: "var(--c-surface2)", color: "var(--c-text2)" }}
                          >
                            Θ{item.seat}
                          </span>
                        )}

                        {/* Name + price */}
                        <div className="flex-1 py-3 min-w-0">
                          <p className="font-semibold text-sm truncate" style={{ color: "var(--c-text)" }}>{decodeUnicodeEscapes(item.name)}</p>
                          <p className="text-xs mt-0.5" style={{ color: "var(--c-text2)" }}>
                            {item.price.toFixed(2)}€ × {item.quantity}
                            {" = "}
                            <span className="text-gray-300 font-medium">
                              {(item.price * item.quantity).toFixed(2)}€
                            </span>
                          </p>
                        </div>

                        {/* Qty controls */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => updateItemQty(item.id, item.quantity - 1)}
                            className="w-[52px] h-[52px] rounded-full flex items-center justify-center text-xl font-bold active:scale-90 transition-all"
                            style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}
                            aria-label="Μείωση"
                          >
                            −
                          </button>
                          <span className="font-black text-base text-center" style={{ minWidth: 32, color: "var(--c-text)" }}>
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateItemQty(item.id, item.quantity + 1)}
                            className="w-[52px] h-[52px] rounded-full flex items-center justify-center text-xl font-bold active:scale-90 transition-all"
                            style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}
                            aria-label="Αύξηση"
                          >
                            +
                          </button>
                        </div>

                        {/* Trash / direct delete */}
                        <button
                          onClick={() => removeItem(item.id)}
                          className="w-[52px] h-[52px] rounded-full flex items-center justify-center active:scale-90 transition-all shrink-0"
                          style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}
                          aria-label="Διαγραφή"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4h6v3M3 7h18" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))
          )}
        </div>
      )}

      {/* Send to kitchen CTA */}
      {orderItems.length > 0 && (
        <div className="border-t px-4 py-3 pb-safe" style={{ background: "var(--c-surface)", borderColor: "var(--c-border)" }}>
          {tab === "cart" && (
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="text-sm font-medium" style={{ color: "var(--c-text2)" }}>Σύνολο</span>
              <span
                className="font-black"
                style={{ fontSize: 22, color: !minOk ? "#f59e0b" : "var(--c-text)" }}
              >
                {total.toFixed(2)}€
              </span>
            </div>
          )}
          <button
            onClick={sendToKitchen}
            disabled={sending}
            className="w-full rounded-2xl bg-brand h-16 font-black text-white text-lg active:scale-[0.97] transition-transform duration-75 disabled:opacity-40"
          >
            {sending ? "Αποστολή..." : `Αποστολή στην κουζίνα — ${total.toFixed(2)}€`}
          </button>
          {!minOk && (
            <p className="text-center text-amber-400 text-xs mt-2">
              Κάτω από ελάχιστη κατανάλωση ({settings.minConsumptionEur}€)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
