/**
 * SQLite Database Layer for EL-Waiter (Capacitor native)
 *
 * On native platforms (iOS/Android via Capacitor), uses @capacitor-community/sqlite.
 * On web, falls back to the original Dexie implementation via dexieAdapter.
 *
 * All types come from dbTypes.ts to avoid circular imports.
 */

import type {
  DbWaiterProfile,
  DbFloorSection,
  DbTable,
  DbMenuCategory,
  DbMenuItem,
  DbOrder,
  DbOrderItem,
  DbSyncItem,
  UnifiedDb,
} from "./dbTypes";

// Re-export for convenience
export type { UnifiedDb };

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------
let _isNative: boolean | null = null;

function isNativePlatform(): boolean {
  if (_isNative !== null) return _isNative;
  try {
    const w = globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
    _isNative = !!w.Capacitor?.isNativePlatform?.();
  } catch {
    _isNative = false;
  }
  return _isNative;
}

// ---------------------------------------------------------------------------
// SQLite singleton (lazy-loaded only on native)
// ---------------------------------------------------------------------------
type CapSQLiteConnection = {
  open: () => Promise<void>;
  execute: (sql: string, values?: unknown[]) => Promise<{ changes?: { changes?: number; lastId?: number } }>;
  query: (sql: string, values?: unknown[]) => Promise<{ values?: Record<string, unknown>[] }>;
  close: () => Promise<void>;
  isDBOpen: () => Promise<{ result?: boolean }>;
};

type CapSQLitePlugin = {
  createConnection: (opts: {
    database: string;
    version: number;
    encrypted: boolean;
    mode: string;
    readonly: boolean;
  }) => Promise<CapSQLiteConnection>;
  checkConnectionsConsistency: () => Promise<{ result?: boolean }>;
  isConnection: (opts: { database: string; readonly: boolean }) => Promise<{ result?: boolean }>;
};

let _sqlite: CapSQLitePlugin | null = null;
let _db: CapSQLiteConnection | null = null;
let _initPromise: Promise<void> | null = null;

const DB_NAME = "elwaiter";
const DB_VERSION = 1;

async function loadPlugin(): Promise<CapSQLitePlugin> {
  const mod = await import("@capacitor-community/sqlite");
  return mod.CapacitorSQLite as unknown as CapSQLitePlugin;
}

async function initSQLite(): Promise<void> {
  if (_db) return;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    _sqlite = await loadPlugin();

    const existing = await _sqlite.isConnection({ database: DB_NAME, readonly: false });
    if (existing.result) {
      _db = await _sqlite.createConnection({
        database: DB_NAME, version: DB_VERSION,
        encrypted: false, mode: "no-encryption", readonly: false,
      });
    } else {
      _db = await _sqlite.createConnection({
        database: DB_NAME, version: DB_VERSION,
        encrypted: false, mode: "no-encryption", readonly: false,
      });
    }

    const openStatus = await _db.isDBOpen();
    if (!openStatus.result) await _db.open();

    await createTables();
  })();

  return _initPromise;
}

async function getDb(): Promise<CapSQLiteConnection> {
  if (!_db) await initSQLite();
  return _db!;
}

// ---------------------------------------------------------------------------
// Schema creation
// ---------------------------------------------------------------------------
async function createTables(): Promise<void> {
  const db = _db!;

  await db.execute(`
    CREATE TABLE IF NOT EXISTS waiter_profiles (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#1E3A5F',
      pin TEXT,
      role TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS floor_sections (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS pos_tables (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      name TEXT NOT NULL,
      floor_section_id TEXT,
      capacity INTEGER NOT NULL DEFAULT 4,
      status TEXT NOT NULL DEFAULT 'free',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      seated_customer_name TEXT,
      seated_covers INTEGER,
      seated_allergies TEXT,
      seated_dietary TEXT
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS menu_categories (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      parent_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_available INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      table_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      waiter_id TEXT NOT NULL,
      waiter_name TEXT NOT NULL,
      venue_id TEXT NOT NULL,
      items TEXT NOT NULL DEFAULT '[]',
      total REAL NOT NULL DEFAULT 0,
      tip REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      payment_method TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sent_at TEXT,
      paid_at TEXT,
      synced INTEGER NOT NULL DEFAULT 0
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      retries INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Indexes
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_wp_venue ON waiter_profiles(venue_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_fs_venue ON floor_sections(venue_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_pt_venue ON pos_tables(venue_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_pt_floor ON pos_tables(floor_section_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_mc_venue ON menu_categories(venue_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_mi_venue ON menu_items(venue_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_mi_cat ON menu_items(category_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_ord_table ON orders(table_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_ord_waiter ON orders(waiter_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_ord_status ON orders(status);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_ord_synced ON orders(synced);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_sq_type ON sync_queue(type);`);

  // Migration tracking
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      key TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL
    );
  `);
}

// ---------------------------------------------------------------------------
// Row <-> Object serialization
// ---------------------------------------------------------------------------

function boolToInt(v: boolean): number { return v ? 1 : 0; }
function intToBool(v: unknown): boolean { return v === 1 || v === true; }

function jsonStringifyArrayOrNull(v: unknown): string | null {
  if (!v) return null;
  if (Array.isArray(v) && v.length === 0) return null;
  return JSON.stringify(v);
}

function jsonParseArrayOrEmpty(v: unknown): string[] {
  if (!v || v === "null") return [];
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return []; } }
  return [];
}

function rowToWaiterProfile(r: Record<string, unknown>): DbWaiterProfile {
  return {
    id: r.id as string, venue_id: r.venue_id as string, name: r.name as string,
    icon: r.icon as string, color: r.color as string,
    pin: r.pin as string | undefined, role: r.role as string | undefined,
    active: intToBool(r.active), sort_order: r.sort_order as number,
  };
}

function rowToFloorSection(r: Record<string, unknown>): DbFloorSection {
  return {
    id: r.id as string, venue_id: r.venue_id as string, name: r.name as string,
    sort_order: r.sort_order as number, is_active: intToBool(r.is_active),
  };
}

function rowToTable(r: Record<string, unknown>): DbTable {
  return {
    id: r.id as string, venue_id: r.venue_id as string, name: r.name as string,
    floor_section_id: r.floor_section_id as string | undefined,
    capacity: r.capacity as number, status: r.status as DbTable["status"],
    sort_order: r.sort_order as number, is_active: intToBool(r.is_active),
    seated_customer_name: r.seated_customer_name as string | null,
    seated_covers: r.seated_covers as number | null,
    seated_allergies: jsonParseArrayOrEmpty(r.seated_allergies),
    seated_dietary: jsonParseArrayOrEmpty(r.seated_dietary),
  };
}

function rowToMenuCategory(r: Record<string, unknown>): DbMenuCategory {
  return {
    id: r.id as string, venue_id: r.venue_id as string, name: r.name as string,
    color: r.color as string | undefined, sort_order: r.sort_order as number,
    parent_id: r.parent_id as string | undefined, is_active: intToBool(r.is_active),
  };
}

function rowToMenuItem(r: Record<string, unknown>): DbMenuItem {
  return {
    id: r.id as string, venue_id: r.venue_id as string,
    category_id: r.category_id as string, name: r.name as string,
    price: r.price as number, is_active: intToBool(r.is_active),
    is_available: intToBool(r.is_available), sort_order: r.sort_order as number,
  };
}

function rowToOrder(r: Record<string, unknown>): DbOrder {
  let items: DbOrderItem[] = [];
  if (r.items) {
    if (typeof r.items === "string") { try { items = JSON.parse(r.items); } catch { items = []; } }
    else items = r.items as DbOrderItem[];
  }
  return {
    id: r.id as string, table_id: r.table_id as string,
    table_name: r.table_name as string, waiter_id: r.waiter_id as string,
    waiter_name: r.waiter_name as string, venue_id: r.venue_id as string,
    items, total: r.total as number, tip: r.tip as number,
    status: r.status as DbOrder["status"],
    payment_method: r.payment_method as DbOrder["payment_method"],
    created_at: r.created_at as string, updated_at: r.updated_at as string,
    sent_at: r.sent_at as string | undefined, paid_at: r.paid_at as string | undefined,
    synced: intToBool(r.synced),
  };
}

function rowToSyncItem(r: Record<string, unknown>): DbSyncItem {
  return {
    id: r.id as number, type: r.type as DbSyncItem["type"],
    payload: r.payload as string, created_at: r.created_at as string,
    retries: r.retries as number,
  };
}

// ---------------------------------------------------------------------------
// SQLite adapter — implements UnifiedDb
// ---------------------------------------------------------------------------

function createSQLiteAdapter(): UnifiedDb {
  return {
    waiterProfiles: {
      async bulkPut(items) {
        const db = await getDb();
        for (const p of items) {
          await db.execute(
            `INSERT OR REPLACE INTO waiter_profiles (id,venue_id,name,icon,color,pin,role,active,sort_order) VALUES (?,?,?,?,?,?,?,?,?)`,
            [p.id, p.venue_id, p.name, p.icon, p.color, p.pin ?? null, p.role ?? null, boolToInt(p.active), p.sort_order]
          );
        }
      },
      async clear() { const db = await getDb(); await db.execute(`DELETE FROM waiter_profiles`); },
      where: (field: string) => ({
        equals: (value: string) => ({
          sortBy: async (_sf: string) => {
            const db = await getDb();
            const res = await db.query(`SELECT * FROM waiter_profiles WHERE ${field} = ? ORDER BY sort_order ASC`, [value]);
            return (res.values ?? []).map(rowToWaiterProfile);
          },
          toArray: async () => {
            const db = await getDb();
            const res = await db.query(`SELECT * FROM waiter_profiles WHERE ${field} = ?`, [value]);
            return (res.values ?? []).map(rowToWaiterProfile);
          },
        }),
      }),
    },

    floorSections: {
      async bulkPut(items) {
        const db = await getDb();
        for (const s of items) {
          await db.execute(
            `INSERT OR REPLACE INTO floor_sections (id,venue_id,name,sort_order,is_active) VALUES (?,?,?,?,?)`,
            [s.id, s.venue_id, s.name, s.sort_order, boolToInt(s.is_active)]
          );
        }
      },
      async clear() { const db = await getDb(); await db.execute(`DELETE FROM floor_sections`); },
      where: (_field: string) => ({
        equals: (value: string) => ({
          sortBy: async (_sf: string) => {
            const db = await getDb();
            const res = await db.query(`SELECT * FROM floor_sections WHERE venue_id = ? ORDER BY sort_order ASC`, [value]);
            return (res.values ?? []).map(rowToFloorSection);
          },
        }),
      }),
    },

    posTables: {
      async bulkPut(items) {
        const db = await getDb();
        for (const t of items) {
          await db.execute(
            `INSERT OR REPLACE INTO pos_tables (id,venue_id,name,floor_section_id,capacity,status,sort_order,is_active,seated_customer_name,seated_covers,seated_allergies,seated_dietary) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [t.id, t.venue_id, t.name, t.floor_section_id ?? null, t.capacity, t.status, t.sort_order, boolToInt(t.is_active), t.seated_customer_name ?? null, t.seated_covers ?? null, jsonStringifyArrayOrNull(t.seated_allergies), jsonStringifyArrayOrNull(t.seated_dietary)]
          );
        }
      },
      async update(id, changes) {
        const db = await getDb();
        const sets: string[] = [];
        const vals: unknown[] = [];
        if (changes.status !== undefined) { sets.push("status = ?"); vals.push(changes.status); }
        if (changes.seated_customer_name !== undefined) { sets.push("seated_customer_name = ?"); vals.push(changes.seated_customer_name); }
        if (changes.seated_covers !== undefined) { sets.push("seated_covers = ?"); vals.push(changes.seated_covers); }
        if (changes.seated_allergies !== undefined) { sets.push("seated_allergies = ?"); vals.push(jsonStringifyArrayOrNull(changes.seated_allergies)); }
        if (changes.seated_dietary !== undefined) { sets.push("seated_dietary = ?"); vals.push(jsonStringifyArrayOrNull(changes.seated_dietary)); }
        if (sets.length === 0) return;
        vals.push(id);
        await db.execute(`UPDATE pos_tables SET ${sets.join(", ")} WHERE id = ?`, vals);
      },
      async clear() { const db = await getDb(); await db.execute(`DELETE FROM pos_tables`); },
      where: (_field: string) => ({
        equals: (value: string) => ({
          sortBy: async (_sf: string) => {
            const db = await getDb();
            const res = await db.query(`SELECT * FROM pos_tables WHERE venue_id = ? ORDER BY sort_order ASC`, [value]);
            return (res.values ?? []).map(rowToTable);
          },
        }),
      }),
    },

    menuCategories: {
      async bulkPut(items) {
        const db = await getDb();
        for (const c of items) {
          await db.execute(
            `INSERT OR REPLACE INTO menu_categories (id,venue_id,name,color,sort_order,parent_id,is_active) VALUES (?,?,?,?,?,?,?)`,
            [c.id, c.venue_id, c.name, c.color ?? null, c.sort_order, c.parent_id ?? null, boolToInt(c.is_active)]
          );
        }
      },
      async clear() { const db = await getDb(); await db.execute(`DELETE FROM menu_categories`); },
      where: (_field: string) => ({
        equals: (value: string) => ({
          sortBy: async (_sf: string) => {
            const db = await getDb();
            const res = await db.query(`SELECT * FROM menu_categories WHERE venue_id = ? ORDER BY sort_order ASC`, [value]);
            return (res.values ?? []).map(rowToMenuCategory);
          },
        }),
      }),
    },

    menuItems: {
      async bulkPut(items) {
        const db = await getDb();
        for (const m of items) {
          await db.execute(
            `INSERT OR REPLACE INTO menu_items (id,venue_id,category_id,name,price,is_active,is_available,sort_order) VALUES (?,?,?,?,?,?,?,?)`,
            [m.id, m.venue_id, m.category_id, m.name, m.price, boolToInt(m.is_active), boolToInt(m.is_available), m.sort_order]
          );
        }
      },
      async clear() { const db = await getDb(); await db.execute(`DELETE FROM menu_items`); },
      where: (field: string) => ({
        equals: (value: string) => ({
          and: (fn: (i: DbMenuItem) => boolean) => ({
            sortBy: async (_sf: string) => {
              if (field === "category_id") {
                const db = await getDb();
                const res = await db.query(
                  `SELECT * FROM menu_items WHERE category_id = ? AND is_active = 1 AND is_available = 1 ORDER BY sort_order ASC`,
                  [value]
                );
                return (res.values ?? []).map(rowToMenuItem);
              }
              const db = await getDb();
              const res = await db.query(`SELECT * FROM menu_items WHERE ${field} = ? ORDER BY sort_order ASC`, [value]);
              return (res.values ?? []).map(rowToMenuItem).filter(fn);
            },
          }),
          sortBy: async (_sf: string) => {
            const db = await getDb();
            const res = await db.query(`SELECT * FROM menu_items WHERE ${field} = ? ORDER BY sort_order ASC`, [value]);
            return (res.values ?? []).map(rowToMenuItem);
          },
        }),
      }),
    },

    orders: {
      async put(order) {
        const db = await getDb();
        await db.execute(
          `INSERT OR REPLACE INTO orders (id,table_id,table_name,waiter_id,waiter_name,venue_id,items,total,tip,status,payment_method,created_at,updated_at,sent_at,paid_at,synced) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [order.id, order.table_id, order.table_name, order.waiter_id, order.waiter_name, order.venue_id, JSON.stringify(order.items), order.total, order.tip, order.status, order.payment_method ?? null, order.created_at, order.updated_at, order.sent_at ?? null, order.paid_at ?? null, boolToInt(order.synced)]
        );
      },
      async update(id, changes) {
        const db = await getDb();
        const sets: string[] = [];
        const vals: unknown[] = [];
        if (changes.items !== undefined) { sets.push("items = ?"); vals.push(JSON.stringify(changes.items)); }
        if (changes.total !== undefined) { sets.push("total = ?"); vals.push(changes.total); }
        if (changes.tip !== undefined) { sets.push("tip = ?"); vals.push(changes.tip); }
        if (changes.status !== undefined) { sets.push("status = ?"); vals.push(changes.status); }
        if (changes.payment_method !== undefined) { sets.push("payment_method = ?"); vals.push(changes.payment_method); }
        if (changes.updated_at !== undefined) { sets.push("updated_at = ?"); vals.push(changes.updated_at); }
        if (changes.sent_at !== undefined) { sets.push("sent_at = ?"); vals.push(changes.sent_at); }
        if (changes.paid_at !== undefined) { sets.push("paid_at = ?"); vals.push(changes.paid_at); }
        if (changes.synced !== undefined) { sets.push("synced = ?"); vals.push(boolToInt(changes.synced)); }
        if (changes.table_id !== undefined) { sets.push("table_id = ?"); vals.push(changes.table_id); }
        if (changes.table_name !== undefined) { sets.push("table_name = ?"); vals.push(changes.table_name); }
        if (sets.length === 0) return;
        vals.push(id);
        await db.execute(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?`, vals);
      },
      where: (field: string) => ({
        equals: (value: string) => ({
          and: (fn: (o: DbOrder) => boolean) => ({
            last: async () => {
              if (field === "table_id") {
                // Optimized: use SQL for the common getOpenOrder pattern
                const db = await getDb();
                const res = await db.query(
                  `SELECT * FROM orders WHERE table_id = ? AND status IN ('open','sent') ORDER BY created_at DESC LIMIT 1`,
                  [value]
                );
                if (!res.values || res.values.length === 0) return undefined;
                return rowToOrder(res.values[0]);
              }
              const db = await getDb();
              const res = await db.query(`SELECT * FROM orders WHERE ${field} = ?`, [value]);
              const filtered = (res.values ?? []).map(rowToOrder).filter(fn);
              return filtered.length > 0 ? filtered[filtered.length - 1] : undefined;
            },
            toArray: async () => {
              const db = await getDb();
              const res = await db.query(`SELECT * FROM orders WHERE ${field} = ?`, [value]);
              return (res.values ?? []).map(rowToOrder).filter(fn);
            },
          }),
          filter: (fn: (o: DbOrder) => boolean) => ({
            toArray: async () => {
              const db = await getDb();
              const res = await db.query(`SELECT * FROM orders WHERE ${field} = ?`, [value]);
              return (res.values ?? []).map(rowToOrder).filter(fn);
            },
          }),
          sortBy: async (_sf: string) => {
            const db = await getDb();
            const res = await db.query(`SELECT * FROM orders WHERE ${field} = ? ORDER BY created_at ASC`, [value]);
            return (res.values ?? []).map(rowToOrder);
          },
          toArray: async () => {
            const db = await getDb();
            const res = await db.query(`SELECT * FROM orders WHERE ${field} = ?`, [value]);
            return (res.values ?? []).map(rowToOrder);
          },
        }),
        anyOf: (values: string[]) => ({
          toArray: async () => {
            const db = await getDb();
            const placeholders = values.map(() => "?").join(",");
            const res = await db.query(`SELECT * FROM orders WHERE ${field} IN (${placeholders})`, values);
            return (res.values ?? []).map(rowToOrder);
          },
        }),
      }),
    },

    syncQueue: {
      async add(item) {
        const db = await getDb();
        await db.execute(
          `INSERT INTO sync_queue (type,payload,created_at,retries) VALUES (?,?,?,?)`,
          [item.type, item.payload, item.created_at, item.retries]
        );
      },
      async count() {
        const db = await getDb();
        const res = await db.query(`SELECT COUNT(*) as cnt FROM sync_queue`);
        if (!res.values || res.values.length === 0) return 0;
        return (res.values[0].cnt as number) ?? 0;
      },
      limit: (n: number) => ({
        toArray: async () => {
          const db = await getDb();
          const res = await db.query(`SELECT * FROM sync_queue ORDER BY id ASC LIMIT ?`, [n]);
          return (res.values ?? []).map(rowToSyncItem);
        },
      }),
      async delete(id) {
        const db = await getDb();
        await db.execute(`DELETE FROM sync_queue WHERE id = ?`, [id]);
      },
      async update(id, changes) {
        const db = await getDb();
        const sets: string[] = [];
        const vals: unknown[] = [];
        if (changes.retries !== undefined) { sets.push("retries = ?"); vals.push(changes.retries); }
        if (sets.length === 0) return;
        vals.push(id);
        await db.execute(`UPDATE sync_queue SET ${sets.join(", ")} WHERE id = ?`, vals);
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Dexie adapter — wraps original waiterDb for web
// ---------------------------------------------------------------------------

function createDexieAdapter(): UnifiedDb {
  // Lazy import to avoid pulling Dexie into the native bundle
  let _mod: typeof import("./dexieDb") | null = null;
  async function getDexie() {
    if (!_mod) _mod = await import("./dexieDb");
    return _mod.dexieInstance;
  }

  return {
    waiterProfiles: {
      bulkPut: async (items) => { const d = await getDexie(); await d.waiterProfiles.bulkPut(items); },
      clear: async () => { const d = await getDexie(); await d.waiterProfiles.clear(); },
      where: (field: string) => ({
        equals: (value: string) => ({
          sortBy: async (sf: string) => { const d = await getDexie(); return d.waiterProfiles.where(field).equals(value).sortBy(sf); },
          toArray: async () => { const d = await getDexie(); return d.waiterProfiles.where(field).equals(value).toArray(); },
        }),
      }),
    },
    floorSections: {
      bulkPut: async (items) => { const d = await getDexie(); await d.floorSections.bulkPut(items); },
      clear: async () => { const d = await getDexie(); await d.floorSections.clear(); },
      where: (field: string) => ({
        equals: (value: string) => ({
          sortBy: async (sf: string) => { const d = await getDexie(); return d.floorSections.where(field).equals(value).sortBy(sf); },
        }),
      }),
    },
    posTables: {
      bulkPut: async (items) => { const d = await getDexie(); await d.posTables.bulkPut(items); },
      update: async (id, changes) => { const d = await getDexie(); await d.posTables.update(id, changes); },
      clear: async () => { const d = await getDexie(); await d.posTables.clear(); },
      where: (field: string) => ({
        equals: (value: string) => ({
          sortBy: async (sf: string) => { const d = await getDexie(); return d.posTables.where(field).equals(value).sortBy(sf); },
        }),
      }),
    },
    menuCategories: {
      bulkPut: async (items) => { const d = await getDexie(); await d.menuCategories.bulkPut(items); },
      clear: async () => { const d = await getDexie(); await d.menuCategories.clear(); },
      where: (field: string) => ({
        equals: (value: string) => ({
          sortBy: async (sf: string) => { const d = await getDexie(); return d.menuCategories.where(field).equals(value).sortBy(sf); },
        }),
      }),
    },
    menuItems: {
      bulkPut: async (items) => { const d = await getDexie(); await d.menuItems.bulkPut(items); },
      clear: async () => { const d = await getDexie(); await d.menuItems.clear(); },
      where: (field: string) => ({
        equals: (value: string) => ({
          and: (fn: (i: DbMenuItem) => boolean) => ({
            sortBy: async (sf: string) => { const d = await getDexie(); return d.menuItems.where(field).equals(value).and(fn).sortBy(sf); },
          }),
          sortBy: async (sf: string) => { const d = await getDexie(); return d.menuItems.where(field).equals(value).sortBy(sf); },
        }),
      }),
    },
    orders: {
      put: async (order) => { const d = await getDexie(); await d.orders.put(order); },
      update: async (id, changes) => { const d = await getDexie(); await d.orders.update(id, changes); },
      where: (field: string) => ({
        equals: (value: string) => ({
          and: (fn: (o: DbOrder) => boolean) => ({
            last: async () => { const d = await getDexie(); return d.orders.where(field).equals(value).and(fn).last(); },
            toArray: async () => { const d = await getDexie(); return d.orders.where(field).equals(value).and(fn).toArray(); },
          }),
          filter: (fn: (o: DbOrder) => boolean) => ({
            toArray: async () => { const d = await getDexie(); return d.orders.where(field).equals(value).filter(fn).toArray(); },
          }),
          sortBy: async (sf: string) => { const d = await getDexie(); return d.orders.where(field).equals(value).sortBy(sf); },
          toArray: async () => { const d = await getDexie(); return d.orders.where(field).equals(value).toArray(); },
        }),
        anyOf: (values: string[]) => ({
          toArray: async () => { const d = await getDexie(); return d.orders.where(field).anyOf(values).toArray(); },
        }),
      }),
    },
    syncQueue: {
      add: async (item) => { const d = await getDexie(); await d.syncQueue.add(item as DbSyncItem); },
      count: async () => { const d = await getDexie(); return d.syncQueue.count(); },
      limit: (n: number) => ({
        toArray: async () => { const d = await getDexie(); return d.syncQueue.limit(n).toArray(); },
      }),
      delete: async (id: number) => { const d = await getDexie(); await d.syncQueue.delete(id); },
      update: async (id: number, changes: Partial<DbSyncItem>) => { const d = await getDexie(); await d.syncQueue.update(id, changes); },
    },
  };
}

// ---------------------------------------------------------------------------
// Dexie-to-SQLite migration (one-time, on first native boot)
// ---------------------------------------------------------------------------

export async function migrateDexieToSQLite(): Promise<void> {
  if (!isNativePlatform()) return;

  const db = await getDb();

  const check = await db.query(`SELECT * FROM _migrations WHERE key = 'dexie_to_sqlite_v1'`);
  if (check.values && check.values.length > 0) return;

  const sqliteAdapter = createSQLiteAdapter();

  try {
    const { dexieInstance } = await import("./dexieDb");

    const profiles = await dexieInstance.waiterProfiles.toArray();
    if (profiles.length > 0) await sqliteAdapter.waiterProfiles.bulkPut(profiles);

    const sections = await dexieInstance.floorSections.toArray();
    if (sections.length > 0) await sqliteAdapter.floorSections.bulkPut(sections);

    const tables = await dexieInstance.posTables.toArray();
    if (tables.length > 0) await sqliteAdapter.posTables.bulkPut(tables);

    const cats = await dexieInstance.menuCategories.toArray();
    if (cats.length > 0) await sqliteAdapter.menuCategories.bulkPut(cats);

    const items = await dexieInstance.menuItems.toArray();
    if (items.length > 0) await sqliteAdapter.menuItems.bulkPut(items);

    const orders = await dexieInstance.orders.toArray();
    for (const o of orders) await sqliteAdapter.orders.put(o);

    const syncItems = await dexieInstance.syncQueue.toArray();
    for (const s of syncItems) {
      await sqliteAdapter.syncQueue.add({ type: s.type, payload: s.payload, created_at: s.created_at, retries: s.retries });
    }
  } catch {
    // Dexie/IndexedDB may not be available — nothing to migrate
  }

  await db.execute(
    `INSERT OR REPLACE INTO _migrations (key, completed_at) VALUES (?, ?)`,
    ["dexie_to_sqlite_v1", new Date().toISOString()]
  );
}

// ---------------------------------------------------------------------------
// Exported factory + init
// ---------------------------------------------------------------------------

let _unified: UnifiedDb | null = null;

export function getUnifiedDb(): UnifiedDb {
  if (_unified) return _unified;
  _unified = isNativePlatform() ? createSQLiteAdapter() : createDexieAdapter();
  return _unified;
}

/**
 * Initialize the database. On native, creates SQLite tables and runs
 * the Dexie migration. On web, this is a no-op (Dexie auto-initializes).
 * Call once at app startup.
 */
export async function initDb(): Promise<void> {
  if (isNativePlatform()) {
    await initSQLite();
    await migrateDexieToSQLite();
  }
}
