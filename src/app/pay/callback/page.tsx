"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWaiterStore } from "@/store/waiterStore";
import { supabase } from "@/lib/supabase";
import { waiterDb, calcTotal } from "@/lib/waiterDb";

/**
 * Viva App-to-App SoftPOS callback page.
 * After customer taps card on waiter's phone, Viva redirects here with:
 *   ?status=success&transactionId=xxx&amount=2750&referenceNumber=STAN&...
 *
 * We parse the params, update the order as paid, and show result.
 */

function CallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeTable } = useWaiterStore();
  const [status, setStatus] = useState<"processing" | "success" | "failed">("processing");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void handleCallback();
  }, []);

  async function handleCallback() {
    const rawStatus = searchParams.get("status") || "fail";
    const responseCode = searchParams.get("responseCode");
    const transactionId = searchParams.get("transactionId");
    const orderCode = searchParams.get("orderCode");
    const amountCents = parseInt(searchParams.get("amount") || "0");
    const stanRef = searchParams.get("referenceNumber");
    const clientTxnId = searchParams.get("clientTransactionId");
    const cardType = searchParams.get("cardType");

    // Determine success (including offline codes 1=no internet, 2=AADE down)
    const isSuccess = rawStatus.toLowerCase() === "success" || responseCode === "1" || responseCode === "2";
    const isOffline = responseCode === "1" || responseCode === "2";

    if (!isSuccess) {
      setStatus("failed");
      setMessage(searchParams.get("message") || "\u0391\u03C0\u03BF\u03C4\u03C5\u03C7\u03AF\u03B1 \u03C0\u03BB\u03B7\u03C1\u03C9\u03BC\u03AE\u03C2");
      return;
    }

    // Payment succeeded — update order
    try {
      const orderId = clientTxnId || "";
      if (orderId && supabase) {
        // Update kitchen_orders status to paid
        await supabase.from("kitchen_orders").update({
          status: "paid",
        }).eq("id", orderId);

        // Update table status to free
        if (activeTable && activeTable.id && !activeTable.id.startsWith("temp-")) {
          void supabase.from("pos_tables").update({ status: "free" }).eq("id", activeTable.id);
          await waiterDb.posTables.update(activeTable.id, { status: "free" });
        }
      }

      // Update local order
      if (orderId) {
        await waiterDb.orders.update(orderId, {
          status: "paid",
          payment_method: "softpos",
          paid_at: new Date().toISOString(),
          synced: true,
        });
      }

      // Issue fiscal final receipt (11.1) via Bridge
      const { settings } = useWaiterStore.getState();
      const bridgeUrl = settings?.bridgeUrl || "http://localhost:8088";
      void fetch(`${bridgeUrl}/api/v1/payments/viva/complete-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant_reference: `ELW-${orderId.slice(-12)}`,
          amount_cents: amountCents,
          payment_method: "card",
          items: [], // Items already on the 8.6 order slip
          doc_type: "receipt",
          previous_reference: `ELW-${orderId.slice(-12)}-slip`,
          transaction_id: transactionId,
        }),
        signal: AbortSignal.timeout(15000),
      }).catch(() => { /* fiscal not configured */ });

      setStatus("success");
      setMessage(
        isOffline
          ? `\u0395\u03C0\u03B9\u03C4\u03C5\u03C7\u03AF\u03B1 (offline) — ${(amountCents / 100).toFixed(2)}\u20AC${cardType ? ` (${cardType})` : ""}`
          : `\u0395\u03C0\u03B9\u03C4\u03C5\u03C7\u03AF\u03B1 — ${(amountCents / 100).toFixed(2)}\u20AC${cardType ? ` (${cardType})` : ""}`
      );
    } catch {
      setStatus("success"); // payment went through even if our DB update fails
      setMessage(`\u03A0\u03BB\u03B7\u03C1\u03C9\u03BC\u03AE ${(amountCents / 100).toFixed(2)}\u20AC OK`);
    }
  }

  return (
    <div style={{
      minHeight: "100dvh",
      background: status === "success" ? "#052e16" : status === "failed" ? "#450a0a" : "var(--c-bg, #090910)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 32, gap: 20, textAlign: "center",
    }}>
      <span style={{ fontSize: 64 }}>
        {status === "success" ? "\u2705" : status === "failed" ? "\u274C" : "\u23F3"}
      </span>
      <p style={{ color: "#fff", fontSize: 24, fontWeight: 800 }}>
        {status === "success" ? "\u0395\u03C0\u03B9\u03C4\u03C5\u03C7\u03AF\u03B1!" : status === "failed" ? "\u0391\u03C0\u03BF\u03C4\u03C5\u03C7\u03AF\u03B1" : "\u0395\u03C0\u03B5\u03BE\u03B5\u03C1\u03B3\u03B1\u03C3\u03AF\u03B1..."}
      </p>
      {message && (
        <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 14 }}>{message}</p>
      )}
      {status !== "processing" && (
        <button
          onClick={() => router.replace("/tables")}
          style={{
            background: "#3B82F6", color: "#fff", border: "none",
            borderRadius: 16, padding: "16px 40px", fontSize: 16,
            fontWeight: 700, cursor: "pointer", marginTop: 16,
          }}
        >
          {"\u2190"} {"\u0395\u03C0\u03B9\u03C3\u03C4\u03C1\u03BF\u03C6\u03AE \u03C3\u03C4\u03B1 \u03C4\u03C1\u03B1\u03C0\u03AD\u03B6\u03B9\u03B1"}
        </button>
      )}
    </div>
  );
}

export default function PayCallbackPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100dvh", background: "#090910", display: "flex", alignItems: "center", justifyContent: "center" }}><p style={{ color: "#fff" }}>{"\u0395\u03C0\u03B5\u03BE\u03B5\u03C1\u03B3\u03B1\u03C3\u03AF\u03B1..."}</p></div>}>
      <CallbackInner />
    </Suspense>
  );
}
