"use client";
import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { waiterDb, getOpenOrder, calcTotal } from "@/lib/waiterDb";
import { useWaiterStore } from "@/store/waiterStore";
import { supabase } from "@/lib/supabase";
import { v4 as uuidv4 } from "uuid";
import type { DbMenuCategory, DbMenuItem, DbOrderItem, DbOrder } from "@/lib/waiterDb";

// Upsell keyword detection
const DRINK_KW  = ["ποτό","μπύρα","κρασί","drink","beer","wine","cocktail","ουίσκι","ούζο","τσίπουρο","νερό","χυμό","σόδα","καφέ","espresso"];
const DESSERT_KW = ["γλυκό","παγωτό","τάρτα","dessert","cake","tiramisu","σοκολάτα"];
const FOOD_KW   = ["σαλάτα","σουβλάκι","μακαρόν","πίτα","κοτόπουλο","μπριζόλα","pasta","pizza","σπαγγέτι","μπιφτέκι"];

function detectUpsell(items: DbOrderItem[]): string[] {
  const names = items.map((i) => i.name.toLowerCase()).join(" ");
  const msgs: string[] = [];
  if (!DRINK_KW.some((k) => names.includes(k)))
    msgs.push("Προτείνετε στον πελάτη κάποιο ποτό ή αναψυκτικό;");
  if (FOOD_KW.some((k) => names.includes(k)) && !DESSERT_KW.some((k) => names.includes(k)))
    msgs.push("Θα ήθελε γλυκό ή επιδόρπιο;");
  return msgs;
}

export default function OrderPage() {
  const router = useRouter();
  const { waiter, activeTable, settings, isOnline } = useWaiterStore();
  const [categories, setCategories] = useState<DbMenuCategory[]>([]);
  const [items, setItems] = useState<DbMenuItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [order, setOrder] = useState<DbOrder | null>(null);
  const [orderItems, setOrderItems] = useState<DbOrderItem[]>([]);
  const [sending, setSending] = useState(false);
  const [upsells, setUpsells] = useState<string[]>([]);
  const [showUpsell, setShowUpsell] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"menu"|"cart">("menu");

  useEffect(() => {
    if (!waiter || !activeTable) { router.replace("/tables"); return; }
    loadData();
  }, [waiter, activeTable]);

  async function loadData() {
    const [cats, existingOrder] = await Promise.all([
      waiterDb.menuCategories.where("venue_id").equals(settings.venueId).sortBy("sort_order"),
      getOpenOrder(activeTable!.id),
    ]);
    const activeCategories = cats.filter((c) => c.is_active);
    setCategories(activeCategories);
    if (activeCategories.length > 0) setActiveCategory(activeCategories[0].id);

    if (existingOrder) {
      setOrder(existingOrder);
      setOrderItems(existingOrder.items);
    }

    // sync menu from supabase if online
    if (isOnline && supabase && settings.venueId) {
      const [{ data: dbCats }, { data: dbItems }] = await Promise.all([
        supabase.from("menu_categories").select("*").eq("venue_id", settings.venueId).eq("is_active", true),
        supabase.from("menu_items").select("*").eq("venue_id", settings.venueId).eq("is_active", true).eq("is_available", true),
      ]);
      if (dbCats) await waiterDb.menuCategories.bulkPut(dbCats);
      if (dbItems) await waiterDb.menuItems.bulkPut(dbItems);
      const freshCats = await waiterDb.menuCategories.where("venue_id").equals(settings.venueId).sortBy("sort_order");
      const ac = freshCats.filter((c) => c.is_active);
      setCategories(ac);
      if (ac.length > 0 && !activeCategory) setActiveCategory(ac[0].id);
    }

    loadItems(activeCategory || (categories[0]?.id ?? ""));
  }

  async function loadItems(catId: string) {
    if (!catId) return;
    const its = await waiterDb.menuItems
      .where("category_id").equals(catId)
      .and((i) => i.is_active && i.is_available)
      .sortBy("sort_order");
    setItems(its);
  }

  useEffect(() => { if (activeCategory) loadItems(activeCategory); }, [activeCategory]);

  const filtered = useMemo(() =>
    search ? items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase())) : items,
    [items, search]);

  function addItem(item: DbMenuItem) {
    setOrderItems((prev) => {
      const existing = prev.find((o) => o.menu_item_id === item.id);
      if (existing) return prev.map((o) => o.menu_item_id === item.id ? { ...o, quantity: o.quantity + 1 } : o);
      return [...prev, { id: uuidv4(), menu_item_id: item.id, name: item.name, price: item.price, quantity: 1 }];
    });
  }

  function removeItem(id: string) {
    setOrderItems((prev) => {
      const existing = prev.find((o) => o.id === id);
      if (!existing) return prev;
      if (existing.quantity <= 1) return prev.filter((o) => o.id !== id);
      return prev.map((o) => o.id === id ? { ...o, quantity: o.quantity - 1 } : o);
    });
  }

  const total = calcTotal(orderItems);
  const minOk = !settings.minConsumptionEur || total >= settings.minConsumptionEur;
  const cartCount = orderItems.reduce((s, i) => s + i.quantity, 0);

  async function sendToKitchen() {
    if (!waiter || !activeTable || orderItems.length === 0) return;
    setSending(true);

    const now = new Date().toISOString();
    const newOrder: DbOrder = order
      ? { ...order, items: orderItems, total, updated_at: now, synced: false }
      : {
          id: uuidv4(), table_id: activeTable.id, table_name: activeTable.name,
          waiter_id: waiter.id, waiter_name: waiter.name, venue_id: settings.venueId,
          items: orderItems, total, tip: 0, status: "sent", created_at: now, updated_at: now,
          sent_at: now, synced: false,
        };

    await waiterDb.orders.put(newOrder);
    // update table status
    await waiterDb.posTables.update(activeTable.id, { status: "occupied" });
    useWaiterStore.getState().setActiveTable({ ...activeTable, status: "occupied" });

    let synced = false;
    if (isOnline && supabase) {
      try {
        await supabase.from("kitchen_orders").upsert({
          id: newOrder.id, venue_id: settings.venueId,
          tab_name: activeTable.name, cashier_name: waiter.name,
          items: orderItems, status: "pending",
          created_at: newOrder.created_at,
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
    <div className="flex h-screen flex-col">
      {/* Upsell modal */}
      {showUpsell && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-3xl bg-gray-900 p-6 space-y-4">
            <p className="text-xl font-bold text-white text-center">💡 Πρόταση</p>
            {upsells.map((u, i) => (
              <div key={i} className="rounded-xl bg-brand/20 border border-brand/40 p-4 text-white text-center">
                {u}
              </div>
            ))}
            <button
              onClick={() => { setShowUpsell(false); router.push("/tables"); }}
              className="w-full rounded-2xl bg-brand py-4 font-bold text-white text-lg touch-btn"
            >
              Εντάξει, επόμενο τραπέζι
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="pt-safe bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <button onClick={() => router.push("/tables")} className="text-gray-400 p-1 touch-btn text-xl">←</button>
          <div className="text-center">
            <p className="font-bold text-white">{activeTable?.name}</p>
            <p className="text-xs text-gray-400">{waiter?.name}</p>
          </div>
          <button
            onClick={() => router.push("/pay")}
            className="text-sm font-semibold text-brand touch-btn"
          >
            Πληρωμή
          </button>
        </div>

        {/* Total bar */}
        <div className="mt-2 flex items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={() => setTab("menu")}
              className={`rounded-full px-4 py-1 text-sm font-medium touch-btn ${tab==="menu" ? "bg-brand text-white" : "bg-gray-800 text-gray-400"}`}
            >
              Μενού
            </button>
            <button
              onClick={() => setTab("cart")}
              className={`rounded-full px-4 py-1 text-sm font-medium touch-btn relative ${tab==="cart" ? "bg-brand text-white" : "bg-gray-800 text-gray-400"}`}
            >
              Καλάθι {cartCount > 0 && <span className="ml-1 font-bold">({cartCount})</span>}
            </button>
          </div>
          <span className={`font-bold text-lg ${minOk ? "text-white" : "text-yellow-400"}`}>
            {total.toFixed(2)}€
            {!minOk && <span className="text-xs ml-1">(ελάχ. {settings.minConsumptionEur}€)</span>}
          </span>
        </div>
      </div>

      {tab === "menu" ? (
        <div className="flex flex-1 overflow-hidden">
          {/* Category sidebar */}
          <div className="w-24 shrink-0 overflow-y-auto bg-gray-900/60 border-r border-gray-800 py-2">
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => { setActiveCategory(c.id); setSearch(""); }}
                className={`w-full px-2 py-3 text-center text-xs font-medium touch-btn transition-colors
                  ${activeCategory === c.id ? "text-white bg-brand/20 border-r-2 border-brand" : "text-gray-400"}`}
              >
                {c.name}
              </button>
            ))}
          </div>

          {/* Items */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-3">
              <input
                type="search"
                placeholder="Αναζήτηση..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl bg-gray-800 px-4 py-2 text-white placeholder-gray-500 text-sm outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 px-3 pb-safe sm:grid-cols-3">
              {filtered.map((item) => {
                const inCart = orderItems.find((o) => o.menu_item_id === item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => addItem(item)}
                    className={`relative flex flex-col rounded-2xl p-3 text-left touch-btn transition-colors
                      ${inCart ? "bg-brand/20 border border-brand/50" : "bg-gray-800"}`}
                  >
                    <span className="text-sm font-medium text-white leading-snug">{item.name}</span>
                    <span className="text-brand font-semibold text-sm mt-1">{item.price.toFixed(2)}€</span>
                    {inCart && (
                      <span className="absolute top-2 right-2 bg-brand text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                        {inCart.quantity}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
          {orderItems.length === 0 && (
            <p className="text-center text-gray-500 mt-10">Καλάθι κενό</p>
          )}
          {orderItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between rounded-xl bg-gray-800 px-4 py-3">
              <div className="flex-1">
                <p className="text-white font-medium text-sm">{item.name}</p>
                <p className="text-gray-400 text-xs">{item.price.toFixed(2)}€ × {item.quantity}</p>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => removeItem(item.id)} className="w-8 h-8 rounded-full bg-gray-700 text-white touch-btn flex items-center justify-center text-lg">−</button>
                <span className="text-white font-semibold w-4 text-center">{item.quantity}</span>
                <button onClick={() => addItem({ id: item.menu_item_id, name: item.name, price: item.price } as DbMenuItem)} className="w-8 h-8 rounded-full bg-gray-700 text-white touch-btn flex items-center justify-center text-lg">+</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Send button */}
      {orderItems.length > 0 && (
        <div className="border-t border-gray-800 bg-gray-900 px-4 py-3 pb-safe">
          <button
            onClick={sendToKitchen}
            disabled={sending}
            className="w-full rounded-2xl bg-brand py-4 font-bold text-white text-lg touch-btn disabled:opacity-50 transition-opacity"
          >
            {sending ? "Αποστολή..." : `Αποστολή στην κουζίνα — ${total.toFixed(2)}€`}
          </button>
          {!minOk && (
            <p className="text-center text-yellow-400 text-xs mt-2">
              ⚠️ Κάτω από ελάχιστη κατανάλωση ({settings.minConsumptionEur}€)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
