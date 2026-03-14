"use client";
import { useEffect } from "react";
import { initDb } from "@/lib/waiterDb";

/**
 * Initializes the database at app startup.
 * On Capacitor native: creates SQLite tables + migrates Dexie data.
 * On web: no-op (Dexie auto-initializes).
 * Renders nothing.
 */
export default function DbInitializer() {
  useEffect(() => {
    void initDb();
  }, []);

  return null;
}
