"use client";
import { Suspense, useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { waiterDb, getOpenOrder, calcTotal } from "@/lib/waiterDb";
import { useWaiterStore } from "@/store/waiterStore";
import { supabase, decodeUnicodeEscapes, fetchVenuePriceLists, fetchPriceListMenu } from "@/lib/supabase";
import type { VenuePriceList } from "@/lib/supabase";
import { v4 as uuidv4 } from "uuid";
import type { DbMenuCategory, DbMenuItem, DbOrderItem, DbOrder, DbTable, OrderItemModifier } from "@/lib/waiterDb";
import { printKitchenTicket } from "@/lib/nativePrinter";

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
  const [activeSeat, setActiveSeat] = useState<number | null>(null);

  // Cart side panel state
  const [cartOpen, setCartOpen] = useState(false);

  // Editing cart item modifiers
  const [editingCartItemId, setEditingCartItemId] = useState<string | null>(null);

  // Long-press qty popover
  const [qtyPopoverItem, setQtyPopoverItem] = useState<DbMenuItem | null>(null);
  const [qtyPopoverPos, setQtyPopoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modifier state
  interface ModifierGroup {
    id: string;
    name: string;
    display_name: string;
    selection_type: "single" | "multi";
    is_required: boolean;
    sort_order: number;
    options: { id: string; name: string; code: string; price_modifier: number; sort_order: number }[];
  }
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [modifierItem, setModifierItem] = useState<DbMenuItem | null>(null);
  const [modifierSelections, setModifierSelections] = useState<Record<string, string[]>>({});
  const [categoryModGroupIds, setCategoryModGroupIds] = useState<Record<string, string[]>>({});

  // Price list state — waiter can switch menu via dropdown
  const [venuePriceLists, setVenuePriceLists] = useState<VenuePriceList[]>([]);
  const [activePriceListId, setActivePriceListId] = useState<string | null>(null);

  // Toast notification
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" | "warn" } | null>(null);
  const showToast = (msg: string, type: "ok" | "err" | "warn" = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

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
    const vid = useWaiterStore.getState().deviceVenueId || waiter?.venue_id || "";
    if (!vid || !activeTable) return;

    // Load existing order from local DB (non-blocking for menu)
    void getOpenOrder(activeTable.id).then((existingOrder) => {
      if (existingOrder) {
        setOrder(existingOrder);
        setOrderItems(existingOrder.items);
      }
    }).catch(() => {});

    // ── Load available price lists for dropdown ──
    const profile = useWaiterStore.getState().cashierProfile;
    if (isOnline && vid) {
      void fetchVenuePriceLists(vid).then(lists => {
        setVenuePriceLists(lists);
        // Set initial price list from profile default (if not already set)
        if (!activePriceListId && profile?.pricelist_id) {
          setActivePriceListId(profile.pricelist_id);
        }
      }).catch(() => {});
    }

    // ── Go straight to Supabase when online (skip slow SQLite) ──
    let activeCats: typeof categories = [];
    const usePriceList = activePriceListId || profile?.pricelist_id;
    if (isOnline && supabase && vid && usePriceList) {
      // ── Price list mode: load from pos_menu_price_list_items ──
      void (async () => {
        try {
          const plMenu = await fetchPriceListMenu(vid, usePriceList);
          if (plMenu && plMenu.categories.length > 0) {
            activeCats = plMenu.categories as typeof categories;
            setCategories(activeCats);
            if (activeCats.length > 0) setActiveCategory(activeCats[0].id);
            const sortedItems = plMenu.items as DbMenuItem[];
            allItemsRef.current = sortedItems;
            if (activeCats.length > 0) {
              setItems(sortedItems.filter((i) => i.category_id === activeCats[0].id));
            }
            // Still load modifiers from venue (shared across price lists)
            const [{ data: dbGroups }, { data: dbMods }, { data: dbGroupCats }] = await Promise.all([
              supabase.from("pos_modifier_groups").select("*").eq("venue_id", vid).eq("is_active", true).order("sort_order"),
              supabase.from("pos_modifiers").select("*").eq("venue_id", vid).eq("is_active", true).order("sort_order"),
              supabase.from("pos_modifier_group_categories").select("*").eq("venue_id", vid),
            ]);
            if (dbGroups && dbMods) {
              const groups: ModifierGroup[] = dbGroups.map((g) => ({
                id: g.id, name: g.name, display_name: g.display_name,
                selection_type: g.selection_type as "single" | "multi",
                is_required: g.is_required, sort_order: g.sort_order,
                options: (dbMods || []).filter((m) => m.group_id === g.id)
                  .map((m) => ({ id: m.id, name: m.name, code: m.code, price_modifier: Number(m.price_modifier) || 0, sort_order: m.sort_order }))
                  .sort((a, b) => a.sort_order - b.sort_order),
              }));
              setModifierGroups(groups);
            }
            if (dbGroupCats) {
              // dbGroupCats maps menu_categories.id → group_id
              // But price list uses pos_menu_categories.id — need to remap by name
              const catMap: Record<string, string[]> = {};

              // First, build the standard map (menu_categories IDs)
              for (const gc of dbGroupCats) {
                if (!catMap[gc.category_id]) catMap[gc.category_id] = [];
                catMap[gc.category_id].push(gc.group_id);
              }

              // Now remap: find menu_categories names → match to pos_menu_categories IDs
              const { data: menuCats } = await supabase
                .from("menu_categories").select("id, name").eq("venue_id", vid);
              if (menuCats && activeCats.length > 0) {
                const menuCatNameToId: Record<string, string> = {};
                for (const mc of menuCats) menuCatNameToId[mc.name] = mc.id;

                for (const posCat of activeCats) {
                  // Find the menu_categories.id that has the same name
                  const menuCatId = menuCatNameToId[posCat.name];
                  if (menuCatId && catMap[menuCatId]) {
                    // Copy the modifier group IDs to the pos_menu_categories ID
                    catMap[posCat.id] = catMap[menuCatId];
                  }
                }
              }
              setCategoryModGroupIds(catMap);
            }
            return; // Done — skip regular menu fetch
          }
        } catch { /* Fall through to regular menu fetch */ }
      })();
      return; // Price list mode handled above
    }
    if (isOnline && supabase && vid) {
      void (async () => {
        try {
          const [{ data: dbCats }, { data: dbItems }, { data: dbGroups }, { data: dbMods }, { data: dbGroupCats }] = await Promise.all([
            supabase.from("menu_categories").select("*").eq("venue_id", vid).eq("is_active", true),
            supabase.from("menu_items").select("*").eq("venue_id", vid).eq("is_active", true).eq("is_available", true),
            supabase.from("pos_modifier_groups").select("*").eq("venue_id", vid).eq("is_active", true).order("sort_order"),
            supabase.from("pos_modifiers").select("*").eq("venue_id", vid).eq("is_active", true).order("sort_order"),
            supabase.from("pos_modifier_group_categories").select("*").eq("venue_id", vid),
          ]);
          // Set state IMMEDIATELY from Supabase (bypass SQLite)
          // Filter by cashier profile's visible categories (extras_config)
          const visibleCatIds = useWaiterStore.getState().cashierProfile?.extras_config;
          if (dbCats) {
            activeCats = dbCats
              .filter((c: { is_active?: boolean; id: string }) => {
                if (c.is_active === false) return false;
                // If profile has visible categories, filter by them
                if (visibleCatIds && visibleCatIds.length > 0) return visibleCatIds.includes(c.id);
                return true; // No filter = show all
              })
              .sort((a: { sort_order?: number }, b: { sort_order?: number }) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
            setCategories(activeCats as typeof categories);
            if (activeCats.length > 0) setActiveCategory(activeCats[0].id);
          }
          if (dbItems) {
            // Store ALL items in ref for instant category switching
            const sortedItems = dbItems
              .sort((a: { sort_order?: number }, b: { sort_order?: number }) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) as DbMenuItem[];
            allItemsRef.current = sortedItems;
            // Show first category items immediately
            if (activeCats.length > 0) {
              setItems(sortedItems.filter((i) => i.category_id === activeCats[0].id));
            }
          }

          // Background: persist to SQLite for offline use
          if (dbCats) void waiterDb.menuCategories.bulkPut(dbCats).catch(() => {});
          if (dbItems) void waiterDb.menuItems.bulkPut(dbItems).catch(() => {});

          // Build modifier groups with their options
          if (dbGroups && dbMods) {
            const groups: ModifierGroup[] = dbGroups.map((g) => ({
              id: g.id,
              name: g.name,
              display_name: g.display_name,
              selection_type: g.selection_type as "single" | "multi",
              is_required: g.is_required,
              sort_order: g.sort_order,
              options: (dbMods || [])
                .filter((m) => m.group_id === g.id)
                .map((m) => ({ id: m.id, name: m.name, code: m.code, price_modifier: Number(m.price_modifier) || 0, sort_order: m.sort_order }))
                .sort((a, b) => a.sort_order - b.sort_order),
            }));
            setModifierGroups(groups);
          }

          // Build category → modifier group mapping
          if (dbGroupCats) {
            const catMap: Record<string, string[]> = {};
            for (const gc of dbGroupCats) {
              if (!catMap[gc.category_id]) catMap[gc.category_id] = [];
              catMap[gc.category_id].push(gc.group_id);
            }
            setCategoryModGroupIds(catMap);
          }
        } catch {
          // Supabase sync failed — local data is still available
        }
      })();
    }
  }

  // All items fetched during loadData — just filter in memory
  const allItemsRef = useRef<DbMenuItem[]>([]);

  function loadItems(catId: string) {
    if (!catId) return;
    const catItems = allItemsRef.current.filter((i) => i.category_id === catId);
    setItems(catItems);
  }

  useEffect(() => { if (activeCategory) loadItems(activeCategory); }, [activeCategory]);

  const filtered = useMemo(() =>
    search ? items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase())) : items,
    [items, search]);

  // Total quantity of an item across all seats (for menu grid badge)
  function itemCartQty(menuItemId: string): number {
    return orderItems.filter((o) => o.menu_item_id === menuItemId).reduce((s, o) => s + o.quantity, 0);
  }

  // Check if item's category has modifier groups
  function getItemModGroups(item: DbMenuItem): ModifierGroup[] {
    const groupIds = categoryModGroupIds[item.category_id] || [];
    if (groupIds.length === 0) return [];
    return modifierGroups.filter((g) => groupIds.includes(g.id));
  }

  function handleItemTap(item: DbMenuItem) {
    // Always add directly — variations are opened via separate button
    addItemDirect(item);
  }

  function handleExtrasTap(e: React.MouseEvent, item: DbMenuItem) {
    e.stopPropagation();
    setEditingCartItemId(null);
    setModifierItem(item);
    setModifierSelections({});
  }

  function addItemDirect(item: DbMenuItem, mods?: OrderItemModifier[], qty?: number) {
    const addQty = qty ?? 1;
    setOrderItems((prev) => {
      // If no modifiers, try to increment existing
      if (!mods || mods.length === 0) {
        const existing = prev.find(
          (o) => o.menu_item_id === item.id && (o.seat ?? null) === activeSeat && (!o.modifiers || o.modifiers.length === 0)
        );
        if (existing) {
          return prev.map((o) =>
            o.id === existing.id ? { ...o, quantity: o.quantity + addQty } : o
          );
        }
      }
      const modExtra = (mods || []).reduce((s, m) => s + m.price_modifier, 0);
      const modNotes = (mods || []).map((m) => m.name + (m.price_modifier > 0 ? ` +${m.price_modifier.toFixed(2)}\u20AC` : "")).join(", ");
      const newItem: DbOrderItem = {
        id: uuidv4(),
        menu_item_id: item.id,
        name: item.name,
        price: item.price,
        quantity: addQty,
        modifiers: mods,
        notes: modNotes || undefined,
      };
      if (activeSeat !== null) newItem.seat = activeSeat;
      return [...prev, newItem];
    });
  }

  function confirmModifiers() {
    if (!modifierItem) return;
    const groups = getItemModGroups(modifierItem);
    // Check required groups
    for (const g of groups) {
      if (g.is_required && (!modifierSelections[g.id] || modifierSelections[g.id].length === 0)) {
        return; // Don't close — required group not selected
      }
    }
    // Build modifier list
    const mods: OrderItemModifier[] = [];
    for (const g of groups) {
      const selected = modifierSelections[g.id] || [];
      for (const optId of selected) {
        const opt = g.options.find((o) => o.id === optId);
        if (opt) {
          mods.push({ group_name: g.display_name, name: opt.name, code: opt.code, price_modifier: opt.price_modifier });
        }
      }
    }

    if (editingCartItemId) {
      // Update existing cart item modifiers
      const modNotes = mods.map((m) => m.name + (m.price_modifier > 0 ? ` +${m.price_modifier.toFixed(2)}\u20AC` : "")).join(", ");
      setOrderItems((prev) =>
        prev.map((o) =>
          o.id === editingCartItemId
            ? { ...o, modifiers: mods, notes: modNotes || undefined }
            : o
        )
      );
      setEditingCartItemId(null);
    } else {
      addItemDirect(modifierItem, mods);
    }
    setModifierItem(null);
    setModifierSelections({});
  }

  function toggleModifier(groupId: string, optionId: string, selectionType: "single" | "multi") {
    setModifierSelections((prev) => {
      const current = prev[groupId] || [];
      if (selectionType === "single") {
        return { ...prev, [groupId]: current.includes(optionId) ? [] : [optionId] };
      }
      // Multi
      return { ...prev, [groupId]: current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId] };
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

  // Per-item seat cycling: null → 1 → 2 → ... → capacity → null
  function cycleSeat(itemId: string) {
    setOrderItems((prev) =>
      prev.map((o) => {
        if (o.id !== itemId) return o;
        const cur = o.seat ?? null;
        if (cur === null) return { ...o, seat: 1 };
        if (cur >= capacity) {
          const { seat: _removed, ...rest } = o;
          return rest as DbOrderItem;
        }
        return { ...o, seat: cur + 1 };
      })
    );
  }

  // Open modifier sheet to edit an existing cart item's extras
  function editCartItemExtras(cartItem: DbOrderItem) {
    // Look up the DbMenuItem from loaded items or categories
    const menuItem = items.find((i) => i.id === cartItem.menu_item_id);
    if (!menuItem) return;
    setEditingCartItemId(cartItem.id);
    setModifierItem(menuItem);
    // Pre-fill current modifier selections
    const groups = getItemModGroups(menuItem);
    const selections: Record<string, string[]> = {};
    if (cartItem.modifiers) {
      for (const g of groups) {
        const selected: string[] = [];
        for (const mod of cartItem.modifiers) {
          const match = g.options.find((o) => o.code === mod.code && o.name === mod.name);
          if (match) selected.push(match.id);
        }
        if (selected.length > 0) selections[g.id] = selected;
      }
    }
    setModifierSelections(selections);
  }

  // Long-press handlers for menu grid
  const handlePointerDown = useCallback((e: React.PointerEvent, item: DbMenuItem) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    longPressTimer.current = setTimeout(() => {
      setQtyPopoverItem(item);
      setQtyPopoverPos({ x: rect.left + rect.width / 2, y: rect.top });
      longPressTimer.current = null;
    }, 500);
  }, []);

  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handlePointerCancel = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const total = calcTotal(orderItems);
  const minOk = !settings.minConsumptionEur || total >= settings.minConsumptionEur;
  const cartCount = orderItems.reduce((s, i) => s + i.quantity, 0);
  const seatGroups = useMemo(() => groupBySeat(orderItems), [orderItems]);

  async function sendToKitchen() {
    if (!waiter || !activeTable || orderItems.length === 0) return;
    setSending(true);

    try {
      const vid = useWaiterStore.getState().deviceVenueId || waiter.venue_id;
      const now = new Date().toISOString();
      const newOrder: DbOrder = order
        ? { ...order, items: orderItems, total, updated_at: now, synced: false }
        : {
            id: uuidv4(), table_id: activeTable.id, table_name: activeTable.name,
            waiter_id: waiter.id, waiter_name: waiter.name, venue_id: vid,
            items: orderItems, total, tip: 0, status: "sent",
            created_at: now, updated_at: now, sent_at: now, synced: false,
          };

      // 1. Save to local DB (fire-and-forget — don't block on SQLite)
      void waiterDb.orders.put(newOrder).catch(() => {});
      void waiterDb.posTables.update(activeTable.id, { status: "occupied" }).catch(() => {});
      useWaiterStore.getState().setActiveTable({ ...activeTable, status: "occupied" });

      // Push table status to Supabase (fire-and-forget)
      if (supabase && activeTable.id && !activeTable.id.startsWith("temp-")) {
        void supabase.from("pos_tables").update({ status: "occupied" }).eq("id", activeTable.id);
      }

      // 2. Sync to Supabase kitchen_orders (fire-and-forget — don't block UI)
      if (isOnline && supabase) {
        void (async () => {
          try {
            await supabase.from("kitchen_orders").upsert({
              id: newOrder.id, venue_id: vid,
              tab_name: activeTable.name, cashier_name: waiter.name,
              items: orderItems, status: "pending", created_at: newOrder.created_at,
            });
            void waiterDb.orders.update(newOrder.id, { synced: true }).catch(() => {});
          } catch {
            void waiterDb.syncQueue.add({ type: "order_send", payload: JSON.stringify(newOrder), created_at: now, retries: 0 }).catch(() => {});
          }
        })();
      }

      // 3. Print to kitchen (fire-and-forget — don't block navigation)
      const cp = useWaiterStore.getState().cashierProfile;
      const kitchenPrinterIp = cp?.receipt_printer_ip
        || cp?.printer_mappings?.[0]?.ip
        || useWaiterStore.getState().venueConfig?.kitchen_printers?.[0]?.ip;

      if (kitchenPrinterIp) {
        void printKitchenTicket(kitchenPrinterIp, activeTable.name, waiter.name, orderItems, settings.bridgeUrl || undefined);
      }

      // 4. Bridge HTTP (fire-and-forget — 3s timeout, don't block)
      const bridgeUrl = settings.bridgeUrl || "http://192.168.0.10:8088";
      void (async () => {
        try {
          const bridgeItems = orderItems.map((item) => ({
            product_id: item.menu_item_id, product_name: item.name,
            quantity: item.quantity,
            unit_price_cents: Math.round((item.price + (item.modifiers || []).reduce((s, m) => s + m.price_modifier, 0)) * 100),
            modifiers: item.modifiers?.length ? item.modifiers.map((m) => m.name).join(", ") : null,
            notes: null, course: 1, vat_rate: 0.24,
          }));
          const createRes = await fetch(`${bridgeUrl}/api/v1/orders`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ table_id: activeTable.name, waiter_id: waiter.name, order_type: isTakeaway ? "takeaway" : "dine_in", covers: activeTable.capacity, items: bridgeItems }),
            signal: AbortSignal.timeout(3000),
          });
          if (createRes.ok) {
            const bridgeOrder = await createRes.json();
            const bridgeOrderId = bridgeOrder.id || bridgeOrder.data?.id;
            if (bridgeOrderId) {
              void fetch(`${bridgeUrl}/api/v1/orders/${bridgeOrderId}/send-to-kitchen`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(3000) }).catch(() => {});
              // 8.6 fiscal slip (demo mode skips)
              if (!useWaiterStore.getState().demoMode) {
                void fetch(`${bridgeUrl}/api/v1/fiscal/order-ticket`, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ order_id: newOrder.id, bridge_order_id: bridgeOrderId, table_id: activeTable.name, waiter_name: waiter.name, receipt_reference: `ELW-${newOrder.id.slice(-12)}-slip`, items: bridgeItems.map((item, idx) => ({ description: item.product_name, amount_cents: item.unit_price_cents * item.quantity, quantity: item.quantity * 100, vat_rate: 24, item_type: "goods", position: idx + 1 })) }),
                  signal: AbortSignal.timeout(5000),
                }).catch(() => {});
              }
              if (supabase) void supabase.from("kitchen_orders").update({ bridge_order_id: bridgeOrderId }).eq("id", newOrder.id);
            }
          }
        } catch { /* Bridge unreachable — order saved to cloud */ }
      })();

      // 5. IMMEDIATE feedback + navigation (don't wait for anything above)
      setOrder(newOrder);
      showToast("Παραγγελία εστάλη!", "ok");

      const ups = detectUpsell(orderItems);
      if (ups.length > 0) { setUpsells(ups); setShowUpsell(true); }
      else router.push("/tables");
    } catch (err) {
      showToast("Σφάλμα: " + (err instanceof Error ? err.message : "Δοκιμάστε ξανά"), "err");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-screen flex-col" style={{ background: "var(--c-bg)", position: "relative" }}>
      {/* Toast notification */}
      {toast && (
        <div style={{
          position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 24px", borderRadius: 14, fontWeight: 700, fontSize: 14,
          background: toast.type === "ok" ? "#10B981" : toast.type === "err" ? "#EF4444" : "#F59E0B",
          color: "white", boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          animation: "fadeIn 0.2s ease-out",
        }}>
          {toast.type === "ok" ? "✓" : toast.type === "err" ? "✗" : "⚠"} {toast.msg}
        </div>
      )}

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

      {/* ── COMPACT HEADER (single row ~48px) ── */}
      <div
        className="pt-safe sticky top-0 z-30 backdrop-blur-md border-b"
        style={{ background: "var(--c-header)", borderColor: "var(--c-border)" }}
      >
        <div className="px-2 h-12 flex items-center gap-1.5">
          {/* Back */}
          <button
            onClick={() => router.push("/tables")}
            className="flex items-center justify-center w-10 h-10 text-gray-400 active:text-white transition-colors shrink-0"
            aria-label="Πίσω"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Table + waiter inline */}
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <span className="font-black text-sm truncate" style={{ color: "var(--c-text)" }}>{activeTable?.name}</span>
            <span className="text-xs truncate" style={{ color: "var(--c-text3)" }}>{"\u00B7"} {waiter?.name}</span>
          </div>

          {/* Cart badge — tap to toggle side panel */}
          <button
            onClick={() => setCartOpen((p) => !p)}
            className="flex items-center gap-1 shrink-0 px-2 h-9 rounded-lg active:scale-95 transition-all"
            style={{ background: cartCount > 0 ? "rgba(59,130,246,0.15)" : "transparent" }}
          >
            <svg className="w-4 h-4" style={{ color: cartCount > 0 ? "#3B82F6" : "var(--c-text3)" }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
            </svg>
            {cartCount > 0 && (
              <span className="text-xs font-black" style={{ color: "#3B82F6" }}>{cartCount}</span>
            )}
          </button>

          {/* Total */}
          <span
            className={`font-black text-sm shrink-0 ${!minOk ? "text-amber-400" : ""}`}
            style={minOk ? { color: "var(--c-text)" } : {}}
          >
            {total.toFixed(2)}{"\u20AC"}
          </span>

          {/* Pay button */}
          <button
            onClick={() => router.push("/pay")}
            className="shrink-0 rounded-full bg-accent px-3 py-1.5 font-semibold text-white text-xs active:bg-emerald-700 active:scale-95 transition-all"
          >
            Πληρωμή
          </button>
        </div>
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
                {"\u26A0\uFE0F ΑΛΛΕΡΓΙΕΣ: "}
              </span>
              <span style={{ color: "#fcd34d" }}>
                {activeTable.seated_allergies.join(", ")}
              </span>
            </p>
          )}
          {activeTable?.seated_dietary && activeTable.seated_dietary.length > 0 && (
            <p style={{ margin: "4px 0 0", fontSize: "13px", lineHeight: "1.4" }}>
              <span style={{ color: "#10B981" }}>
                {"\uD83C\uDF31 "}
              </span>
              <span style={{ color: "#6ee7b7" }}>
                {activeTable.seated_dietary.join(", ")}
              </span>
            </p>
          )}
        </div>
      )}

      {/* ── Price List Selector (only if venue has multiple) ── */}
      {venuePriceLists.length > 1 && (
        <div style={{ padding: "6px 12px", display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid var(--c-border)" }}>
          <span style={{ fontSize: "11px", color: "var(--c-text2)", fontWeight: 600 }}>MENU:</span>
          <select
            value={activePriceListId || ""}
            onChange={(e) => {
              const newId = e.target.value || null;
              setActivePriceListId(newId);
              // Reload menu with new price list
              setTimeout(() => loadData(), 50);
            }}
            style={{
              flex: 1, padding: "8px 12px", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
              background: "var(--c-bg2)", color: "var(--c-text)", border: "1px solid var(--c-border)",
              appearance: "auto",
            }}
          >
            <option value="">All Items</option>
            {venuePriceLists.map(pl => (
              <option key={pl.id} value={pl.id}>{pl.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* ── MAIN AREA: always menu ── */}
      <div className="flex flex-1 overflow-hidden relative">

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
        <div className="flex-1 overflow-y-auto" style={{ marginRight: cartCount > 0 && !cartOpen ? 44 : 0 }}>
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
          <div className="grid grid-cols-2 gap-2 px-3 pb-6 sm:grid-cols-3">
            {filtered.map((item) => {
              const qty = itemCartQty(item.id);
              const hasModifiers = getItemModGroups(item).length > 0;
              return (
                <div
                  key={item.id}
                  className={`relative flex flex-col rounded-2xl text-left min-h-[80px] transition-all
                    ${qty > 0 ? "border border-brand/50 bg-brand/10" : ""}`}
                  style={qty === 0 ? { background: "var(--c-surface2)" } : {}}
                >
                  <button
                    onClick={() => handleItemTap(item)}
                    onPointerDown={(e) => handlePointerDown(e, item)}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerCancel}
                    onPointerLeave={handlePointerCancel}
                    onContextMenu={(e) => e.preventDefault()}
                    className="flex-1 flex flex-col p-3 text-left active:scale-95 transition-all duration-75"
                  >
                    <span className="text-sm font-semibold leading-snug line-clamp-2 flex-1" style={{ color: "var(--c-text)" }}>
                      {decodeUnicodeEscapes(item.name)}
                    </span>
                    <span className="text-accent font-bold text-sm mt-1.5">
                      {item.price.toFixed(2)}{"\u20AC"}
                    </span>
                  </button>
                  {hasModifiers && (
                    <button
                      onClick={(e) => handleExtrasTap(e, item)}
                      className="mx-2 mb-2 px-2 py-1 rounded-lg text-[11px] font-bold tracking-wide text-center transition-colors"
                      style={{ background: "var(--c-brand-dim, rgba(99,102,241,0.15))", color: "var(--c-brand, #818cf8)" }}
                    >
                      EXTRAS
                    </button>
                  )}
                  {qty > 0 && (
                    <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-brand text-white text-xs font-black flex items-center justify-center">
                      {qty}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Collapsed cart strip (right edge) ── */}
        {cartCount > 0 && !cartOpen && (
          <button
            onClick={() => setCartOpen(true)}
            className="absolute right-0 top-0 bottom-0 w-11 flex flex-col items-center justify-center gap-2 border-l active:opacity-80 z-10"
            style={{ background: "var(--c-surface)", borderColor: "var(--c-border)" }}
          >
            <svg className="w-5 h-5" style={{ color: "#3B82F6" }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
            </svg>
            <span className="text-xs font-black" style={{ color: "#3B82F6" }}>{cartCount}</span>
            <span className="text-[10px] font-bold" style={{ color: "var(--c-text2)" }}>{total.toFixed(2)}{"\u20AC"}</span>
          </button>
        )}

        {/* ── Expanded cart side panel (70% width, slides from right) ── */}
        {cartOpen && (
          <>
            {/* Dim overlay */}
            <div
              className="absolute inset-0 z-20"
              style={{ background: "rgba(0,0,0,0.5)" }}
              onClick={() => setCartOpen(false)}
            />
            {/* Panel */}
            <div
              className="absolute right-0 top-0 bottom-0 z-30 flex flex-col overflow-hidden"
              style={{
                width: "70%",
                maxWidth: 400,
                background: "var(--c-surface)",
                borderLeft: "1px solid var(--c-border)",
                animation: "slideInRight 0.2s ease-out",
              }}
            >
              {/* Panel header */}
              <div className="flex items-center justify-between px-3 h-11 border-b shrink-0" style={{ borderColor: "var(--c-border)" }}>
                <span className="font-black text-sm" style={{ color: "var(--c-text)" }}>
                  Καλάθι ({cartCount}) {total.toFixed(2)}{"\u20AC"}
                </span>
                <button
                  onClick={() => setCartOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full active:scale-90"
                  style={{ color: "var(--c-text3)" }}
                >
                  {"\u2715"}
                </button>
              </div>

              {/* Send to kitchen — pinned at top so it's always visible */}
              {orderItems.length > 0 && (
                <div className="px-3 py-2 border-b shrink-0" style={{ borderColor: "var(--c-border)" }}>
                  {!minOk && (
                    <p className="text-center text-amber-400 text-[10px] mb-1">
                      Κάτω από ελάχιστη κατανάλωση ({settings.minConsumptionEur}{"\u20AC"})
                    </p>
                  )}
                  <button
                    onClick={sendToKitchen}
                    disabled={sending}
                    className="w-full rounded-xl bg-brand h-11 font-black text-white text-sm active:scale-[0.97] transition-transform duration-75 disabled:opacity-40"
                  >
                    {sending ? "Αποστολή..." : `Αποστολή στην κουζίνα \u2192 ${total.toFixed(2)}\u20AC`}
                  </button>
                </div>
              )}

              {/* Scrollable cart items */}
              <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
                {orderItems.length === 0 ? (
                  <p className="text-center text-sm mt-8" style={{ color: "var(--c-text3)" }}>Κενή παραγγελία</p>
                ) : (
                  orderItems.map((item) => {
                    const modExtra = (item.modifiers || []).reduce((s, m) => s + m.price_modifier, 0);
                    const lineTotal = (item.price + modExtra) * item.quantity;
                    const menuItem = items.find((i) => i.id === item.menu_item_id);
                    const hasModGroups = menuItem ? getItemModGroups(menuItem).length > 0 : false;
                    return (
                      <div
                        key={item.id}
                        className="rounded-xl p-2"
                        style={{ background: "var(--c-surface2)" }}
                      >
                        {/* Name + price row */}
                        <div className="flex items-start justify-between gap-1">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-xs truncate" style={{ color: "var(--c-text)" }}>
                              {decodeUnicodeEscapes(item.name)}
                            </p>
                            {item.modifiers && item.modifiers.length > 0 && (
                              <p className="text-[10px] mt-0.5 leading-snug truncate" style={{ color: "var(--brand, #3B82F6)" }}>
                                {item.modifiers.map((m) => m.name).join(" \u00B7 ")}
                              </p>
                            )}
                          </div>
                          <span className="text-xs font-bold shrink-0" style={{ color: "var(--c-text)" }}>
                            {lineTotal.toFixed(2)}{"\u20AC"}
                          </span>
                        </div>

                        {/* Controls row */}
                        <div className="flex items-center gap-1 mt-1.5">
                          {/* Qty: [−] qty [+] */}
                          <button
                            onClick={() => updateItemQty(item.id, item.quantity - 1)}
                            className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold active:scale-90"
                            style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}
                          >
                            {"\u2212"}
                          </button>
                          <span className="font-black text-xs text-center" style={{ minWidth: 18, color: "var(--c-text)" }}>
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateItemQty(item.id, item.quantity + 1)}
                            className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold active:scale-90"
                            style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}
                          >
                            +
                          </button>

                          <div className="flex-1" />

                          {/* Seat button (if capacity >= 2) */}
                          {showSeatPicker && (
                            <button
                              onClick={() => cycleSeat(item.id)}
                              className="h-7 px-1.5 rounded-lg text-[10px] font-black active:scale-90 transition-all"
                              style={{ background: "var(--c-surface)", color: item.seat ? "#3B82F6" : "var(--c-text3)" }}
                            >
                              {item.seat ? `\u0398${item.seat}` : "\u0398-"}
                            </button>
                          )}

                          {/* Edit modifiers button */}
                          {hasModGroups && (
                            <button
                              onClick={() => editCartItemExtras(item)}
                              className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90"
                              style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}
                              aria-label="Επεξεργασία extras"
                            >
                              {"\u270E"}
                            </button>
                          )}

                          {/* Delete */}
                          <button
                            onClick={() => removeItem(item.id)}
                            className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90"
                            style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}
                            aria-label="Διαγραφή"
                          >
                            {"\u2715"}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Bottom spacer removed — send button is now at top */}
            </div>
          </>
        )}
      </div>

      {/* ── Long-press qty popover ── */}
      {qtyPopoverItem && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setQtyPopoverItem(null)}
          />
          <div
            className="fixed z-50 flex gap-1 rounded-xl p-1.5 shadow-xl"
            style={{
              left: Math.max(8, Math.min(qtyPopoverPos.x - 90, window.innerWidth - 188)),
              top: Math.max(8, qtyPopoverPos.y - 44),
              background: "var(--c-surface)",
              border: "1px solid var(--c-border)",
            }}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => {
                  addItemDirect(qtyPopoverItem, undefined, n);
                  setQtyPopoverItem(null);
                }}
                className="w-9 h-9 rounded-lg font-black text-sm flex items-center justify-center active:scale-90 transition-all"
                style={{ background: "var(--c-surface2)", color: "var(--c-text)" }}
              >
                {n}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Modifier bottom sheet */}
      {modifierItem && (() => {
        const groups = getItemModGroups(modifierItem);
        const modExtra = Object.entries(modifierSelections).reduce((t, [gid, optIds]) => {
          const group = groups.find((g) => g.id === gid);
          if (!group) return t;
          return t + optIds.reduce((s, oid) => {
            const opt = group.options.find((o) => o.id === oid);
            return s + (opt?.price_modifier || 0);
          }, 0);
        }, 0);
        const allRequiredMet = groups.filter((g) => g.is_required).every((g) => (modifierSelections[g.id]?.length || 0) > 0);
        const itemTotal = modifierItem.price + modExtra;

        return (
          <div
            className="fixed inset-0 z-50 flex flex-col justify-end"
            onClick={(e) => { if (e.target === e.currentTarget) { setModifierItem(null); setModifierSelections({}); setEditingCartItemId(null); } }}
            style={{ background: "rgba(0,0,0,0.5)" }}
          >
            <div
              className="rounded-t-3xl px-4 pt-5 pb-safe max-h-[85vh] overflow-y-auto"
              style={{
                background: "var(--c-surface)",
                borderTop: "1px solid var(--c-border)",
                animation: "slideUp 0.2s ease-out",
              }}
            >
              {/* Item header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-lg font-black" style={{ color: "var(--c-text)" }}>{decodeUnicodeEscapes(modifierItem.name)}</p>
                  <p className="text-sm font-semibold" style={{ color: "var(--brand, #3B82F6)" }}>{modifierItem.price.toFixed(2)}{"\u20AC"}</p>
                </div>
                <button
                  onClick={() => { setModifierItem(null); setModifierSelections({}); setEditingCartItemId(null); }}
                  className="w-10 h-10 rounded-full flex items-center justify-center transition-transform active:scale-90"
                  style={{ background: "var(--c-surface2)", color: "var(--c-text3)" }}
                  aria-label="Κλείσιμο"
                >
                  {"\u2715"}
                </button>
              </div>

              {/* Modifier groups */}
              {groups.map((g) => (
                <div key={g.id} className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--c-text3)" }}>
                      {g.display_name}
                    </p>
                    {g.is_required && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{
                        background: (modifierSelections[g.id]?.length || 0) > 0 ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)",
                        color: (modifierSelections[g.id]?.length || 0) > 0 ? "#22c55e" : "#ef4444",
                      }}>
                        {(modifierSelections[g.id]?.length || 0) > 0 ? "\u2713" : "Απαιτείται"}
                      </span>
                    )}
                    <span className="text-[10px]" style={{ color: "var(--c-text3)" }}>
                      {g.selection_type === "single" ? "(ένα)" : "(πολλαπλά)"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {g.options.map((opt) => {
                      const isSelected = (modifierSelections[g.id] || []).includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          onClick={() => toggleModifier(g.id, opt.id, g.selection_type)}
                          className="rounded-xl px-4 py-3 text-sm font-semibold transition-all active:scale-95 border-2"
                          style={{
                            background: isSelected ? "rgba(59,130,246,0.15)" : "var(--c-surface2)",
                            borderColor: isSelected ? "var(--brand, #3B82F6)" : "var(--c-border)",
                            color: isSelected ? "var(--brand, #3B82F6)" : "var(--c-text)",
                          }}
                        >
                          {opt.name}
                          {opt.price_modifier > 0 && (
                            <span className="ml-1 text-xs" style={{ color: "var(--c-text2)" }}>
                              +{opt.price_modifier.toFixed(2)}{"\u20AC"}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Add/Update button */}
              <button
                onClick={confirmModifiers}
                disabled={!allRequiredMet}
                className="w-full rounded-2xl h-16 font-black text-white text-lg transition-transform active:scale-[0.97] disabled:opacity-30 mb-2"
                style={{ background: allRequiredMet ? "var(--brand, #3B82F6)" : "var(--c-surface2)" }}
              >
                {editingCartItemId ? "ΕΝΗΜΕΡΩΣΗ" : "ΠΡΟΣΘΗΚΗ"} {itemTotal.toFixed(2)}{"\u20AC"}
              </button>
            </div>
          </div>
        );
      })()}

      {/* Inline keyframe for side panel slide-in */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
