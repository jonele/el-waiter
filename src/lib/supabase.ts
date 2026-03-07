import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL  || "";
const key  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key) : null;

export interface BillRequest {
  id: string;
  venue_id: string;
  table_id: string | null;
  table_name: string;
  waiter_id: string;
  waiter_name: string;
  status: 'pending' | 'processed' | 'cancelled';
  created_at: string;
  processed_at: string | null;
}

export interface TableMoveRequest {
  id: string;
  venue_id: string;
  from_table_id: string;
  from_table_name: string;
  to_table_id: string;
  to_table_name: string;
  waiter_id: string;
  waiter_name: string;
  status: "pending" | "approved" | "denied";
  created_at: string;
}

export interface WaiterProfile {
  id: string;
  venue_id: string;
  name: string;
  icon: string;
  color: string;
  pin?: string;
  role?: string;
  qr_token?: string;
  active: boolean;
  sort_order: number;
}

export async function lookupWaiterByPin(venueId: string, pin: string): Promise<WaiterProfile | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("waiter_profiles")
    .select("id, venue_id, name, icon, color, pin, role, qr_token, active, sort_order")
    .eq("venue_id", venueId)
    .eq("pin", pin)
    .eq("active", true)
    .single();
  return data ?? null;
}

export async function lookupWaiterByQrToken(venueId: string, qrToken: string): Promise<WaiterProfile | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("waiter_profiles")
    .select("id, venue_id, name, icon, color, pin, role, qr_token, active, sort_order")
    .eq("venue_id", venueId)
    .eq("qr_token", qrToken)
    .eq("active", true)
    .single();
  return data ?? null;
}
