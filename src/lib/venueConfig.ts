import { createClient } from "@supabase/supabase-js";

// niceb2b / el-os.cloud Supabase — venue_device_config lives here
const NICEB2B_URL = "https://oiizzbiwxghmscvpjtbl.supabase.co";
const NICEB2B_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9paXp6Yml3eGdobXNjdnBqdGJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzODA4MzQsImV4cCI6MjA4NDk1NjgzNH0.lHh7OKfuFlj5HjDS4FgIKAQmb0WIyPMWH5UznqrvudI";

const niceb2b = createClient(NICEB2B_URL, NICEB2B_ANON);

export interface VenueDeviceConfig {
  receipt_printer_ip: string | null;
  receipt_printer_name: string | null;
  fiscal_printer_ip: string | null;
  fiscal_printer_name: string | null;
  proforma_printer_ip: string | null;
  proforma_printer_name: string | null;
  kitchen_printers: Array<{ ip: string; name: string }>;
  viva_merchant_id: string | null;
  viva_api_mode: string | null;
  fiscal_company_name: string | null;
  fiscal_trade_name: string | null;
  fiscal_afm: string | null;
  fiscal_doy: string | null;
  fiscal_city: string | null;
  fiscal_address: string | null;
  fiscal_phone: string | null;
  fiscal_series: string | null;
  published_by: string | null;
  published_at: string | null;
}

/**
 * Pulls the POS-master config for a venue from the shared table.
 * Returns null if no config found or on error.
 */
export async function pullVenueConfig(venueId: string): Promise<VenueDeviceConfig | null> {
  const { data, error } = await niceb2b
    .from("venue_device_config")
    .select("*")
    .eq("venue_id", venueId)
    .eq("config_type", "pos_master")
    .maybeSingle();

  if (error || !data) return null;

  return {
    receipt_printer_ip: data.receipt_printer_ip ?? null,
    receipt_printer_name: data.receipt_printer_name ?? null,
    fiscal_printer_ip: data.fiscal_printer_ip ?? null,
    fiscal_printer_name: data.fiscal_printer_name ?? null,
    proforma_printer_ip: data.proforma_printer_ip ?? null,
    proforma_printer_name: data.proforma_printer_name ?? null,
    kitchen_printers: (data.kitchen_printers as Array<{ ip: string; name: string }>) ?? [],
    viva_merchant_id: data.viva_merchant_id ?? null,
    viva_api_mode: data.viva_api_mode ?? null,
    fiscal_company_name: data.fiscal_company_name ?? null,
    fiscal_trade_name: data.fiscal_trade_name ?? null,
    fiscal_afm: data.fiscal_afm ?? null,
    fiscal_doy: data.fiscal_doy ?? null,
    fiscal_city: data.fiscal_city ?? null,
    fiscal_address: data.fiscal_address ?? null,
    fiscal_phone: data.fiscal_phone ?? null,
    fiscal_series: data.fiscal_series ?? null,
    published_by: data.published_by ?? null,
    published_at: data.published_at ?? null,
  };
}
