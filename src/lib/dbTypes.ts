/**
 * Shared database type definitions for EL-Waiter.
 * Both Dexie (web) and SQLite (native) implementations import from here.
 */

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

export interface DbFailedSyncItem {
  id?: number;
  type: "order_send" | "table_status";
  payload: string;
  created_at: string;
  failed_at: string;
  retries: number;
  last_error: string;
}

export function calcTotal(items: DbOrderItem[]): number {
  return items.reduce((s, i) => s + i.price * i.quantity, 0);
}

// ---------------------------------------------------------------------------
// RSRV reservation & waitlist types
// ---------------------------------------------------------------------------

export interface RsrvReservation {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  party_size: number;
  reservation_date: string;
  reservation_time: string;
  table_id: string | null;
  table_name: string | null;
  status: "pending" | "confirmed" | "seated" | "completed" | "cancelled" | "no_show";
  source: string | null;
  notes: string | null;
  has_children: boolean;
  dietary_notes: string | null;
  staff_notes: string | null;
  prepayment_status: string | null;
  prepayment_amount_cents: number;
}

export interface WaitlistEntry {
  id: string;
  party_name: string;
  party_size: number;
  phone: string | null;
  status: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// UnifiedDb interface — the shape both SQLite and Dexie adapters implement
// ---------------------------------------------------------------------------

export interface UnifiedDb {
  waiterProfiles: {
    bulkPut(items: DbWaiterProfile[]): Promise<void>;
    clear(): Promise<void>;
    where(field: string): {
      equals(value: string): {
        sortBy(field: string): Promise<DbWaiterProfile[]>;
        toArray(): Promise<DbWaiterProfile[]>;
      };
    };
  };
  floorSections: {
    bulkPut(items: DbFloorSection[]): Promise<void>;
    clear(): Promise<void>;
    where(field: string): {
      equals(value: string): {
        sortBy(field: string): Promise<DbFloorSection[]>;
      };
    };
  };
  posTables: {
    bulkPut(items: DbTable[]): Promise<void>;
    update(id: string, changes: Partial<DbTable>): Promise<void>;
    clear(): Promise<void>;
    where(field: string): {
      equals(value: string): {
        sortBy(field: string): Promise<DbTable[]>;
      };
    };
  };
  menuCategories: {
    bulkPut(items: DbMenuCategory[]): Promise<void>;
    clear(): Promise<void>;
    where(field: string): {
      equals(value: string): {
        sortBy(field: string): Promise<DbMenuCategory[]>;
      };
    };
  };
  menuItems: {
    bulkPut(items: DbMenuItem[]): Promise<void>;
    clear(): Promise<void>;
    where(field: string): {
      equals(value: string): {
        and(fn: (i: DbMenuItem) => boolean): {
          sortBy(field: string): Promise<DbMenuItem[]>;
        };
        sortBy(field: string): Promise<DbMenuItem[]>;
      };
    };
  };
  orders: {
    put(order: DbOrder): Promise<void>;
    update(id: string, changes: Partial<DbOrder>): Promise<void>;
    where(field: string): {
      equals(value: string): {
        and(fn: (o: DbOrder) => boolean): {
          last(): Promise<DbOrder | undefined>;
          toArray(): Promise<DbOrder[]>;
        };
        filter(fn: (o: DbOrder) => boolean): {
          toArray(): Promise<DbOrder[]>;
        };
        sortBy(field: string): Promise<DbOrder[]>;
        toArray(): Promise<DbOrder[]>;
      };
      anyOf(values: string[]): {
        toArray(): Promise<DbOrder[]>;
      };
    };
  };
  syncQueue: {
    add(item: Omit<DbSyncItem, "id"> & { id?: number }): Promise<void>;
    count(): Promise<number>;
    limit(n: number): { toArray(): Promise<DbSyncItem[]> };
    delete(id: number): Promise<void>;
    update(id: number, changes: Partial<DbSyncItem>): Promise<void>;
  };
  failedQueue: {
    add(item: Omit<DbFailedSyncItem, "id"> & { id?: number }): Promise<void>;
    count(): Promise<number>;
    toArray(): Promise<DbFailedSyncItem[]>;
    delete(id: number): Promise<void>;
    clear(): Promise<void>;
  };
}
