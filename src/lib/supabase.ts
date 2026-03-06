import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL  || "";
const key  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key) : null;

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
