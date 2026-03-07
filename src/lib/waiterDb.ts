import Dexie, { Table } from "dexie";

export interface DbWaiterProfile {
  id: string;
  venue_id: string;
  name: string;
  icon: string;
  color: string;
  pin?: string;
  role?: string;
  active: boolean;
  sort_order: number;
}

export interface DbFloorSection {
  id: string;
  venue_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface DbTable {
  id: string;
  venue_id: string;
  name: string;
  floor_section_id?: string;
  capacity: number;
  status: "free" | "occupied" | "waiting";
  sort_order: number;
  is_active: boolean;
  seated_customer_name?: string | null;
  seated_covers?: number | null;
  seated_allergies?: string[];
  seated_dietary?: string[];
}

export interface DbMenuCategory {
  id: string;
  venue_id: string;
  name: string;
  color?: string;
  sort_order: number;
  parent_id?: string;
  is_active: boolean;
}

export interface DbMenuItem {
  id: string;
  venue_id: string;
  category_id: string;
  name: string;
  price: number;
  is_active: boolean;
  is_available: boolean;
  sort_order: number;
}

export interface DbOrderItem {
  id: string;
  menu_item_id: string;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
  seat?: number;
}

export type PaymentMethod = "cash" | "card_lan" | "card_bt" | "preorder";

export interface DbOrder {
  id: string;
  table_id: string;
  table_name: string;
  waiter_id: string;
  waiter_name: string;
  venue_id: string;
  items: DbOrderItem[];
  total: number;
  tip: number;
  status: "open" | "sent" | "paid" | "cancelled";
  payment_method?: PaymentMethod;
  created_at: string;
  updated_at: string;
  sent_at?: string;
  paid_at?: string;
  synced: boolean;
}

export interface DbSyncItem {
  id?: number;
  type: "order_send" | "table_status";
  payload: string;
  created_at: string;
  retries: number;
}

class WaiterDatabase extends Dexie {
  waiterProfiles!: Table<DbWaiterProfile>;
  floorSections!: Table<DbFloorSection>;
  posTables!: Table<DbTable>;
  menuCategories!: Table<DbMenuCategory>;
  menuItems!: Table<DbMenuItem>;
  orders!: Table<DbOrder>;
  syncQueue!: Table<DbSyncItem>;

  constructor() {
    super("ElWaiter");
    this.version(1).stores({
      waiterProfiles: "id, venue_id, active",
      floorSections:  "id, venue_id, sort_order",
      posTables:      "id, venue_id, floor_section_id, status",
      menuCategories: "id, venue_id, parent_id, sort_order",
      menuItems:      "id, venue_id, category_id, sort_order",
      orders:         "id, table_id, status, synced, created_at",
      syncQueue:      "++id, type, created_at",
    });
    // v2: adds tip, payment_method, paid_at — non-indexed, no schema change needed
    this.version(2).stores({
      waiterProfiles: "id, venue_id, active",
      floorSections:  "id, venue_id, sort_order",
      posTables:      "id, venue_id, floor_section_id, status",
      menuCategories: "id, venue_id, parent_id, sort_order",
      menuItems:      "id, venue_id, category_id, sort_order",
      orders:         "id, table_id, waiter_id, status, payment_method, synced, created_at",
      syncQueue:      "++id, type, created_at",
    });
  }
}

export const waiterDb = new WaiterDatabase();

export async function getOpenOrder(tableId: string): Promise<DbOrder | undefined> {
  return waiterDb.orders
    .where("table_id").equals(tableId)
    .and((o) => o.status === "open" || o.status === "sent")
    .last();
}

export function calcTotal(items: DbOrderItem[]): number {
  return items.reduce((s, i) => s + i.price * i.quantity, 0);
}

/** Orders for this waiter created on or after a given ISO date string */
export async function getWaiterOrders(waiterId: string, sinceIso: string): Promise<DbOrder[]> {
  return waiterDb.orders
    .where("waiter_id").equals(waiterId)
    .and((o) => o.created_at >= sinceIso)
    .sortBy("created_at");
}
