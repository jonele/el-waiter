/**
 * Pure Dexie/IndexedDB database for EL-Waiter (web fallback).
 *
 * This file is the source of truth for the Dexie schema. It is imported by
 * sqliteDb.ts for the web adapter and for the one-time Dexie->SQLite migration.
 *
 * Consumer code should NOT import this directly — use waiterDb.ts instead,
 * which routes through the unified db.
 */

import Dexie, { Table } from "dexie";
import type {
  DbWaiterProfile,
  DbFloorSection,
  DbTable,
  DbMenuCategory,
  DbMenuItem,
  DbOrder,
  DbSyncItem,
} from "./dbTypes";

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

export const dexieInstance = new WaiterDatabase();
