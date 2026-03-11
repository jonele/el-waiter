"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { useWaiterStore } from "@/store/waiterStore";

function SetupInner() {
  const router = useRouter();
  const params = useParams();
  const search = useSearchParams();
  const { setDeviceVenueId } = useWaiterStore();

  useEffect(() => {
    const venueId = params.venueId as string;
    const t = search.get("t");

    if (t) {
      const window = Math.floor(Date.now() / 300000);
      if (Math.abs(window - parseInt(t)) > 1) {
        router.replace("/?expired=1");
        return;
      }
    }

    if (venueId && /^[0-9a-f-]{36}$/i.test(venueId)) {
      setDeviceVenueId(venueId);
      router.replace("/");
    } else {
      router.replace("/");
    }
  }, []);

  return null;
}

export default function SetupPage() {
  return (
    <div style={{
      minHeight: "100dvh", background: "#0F0F0F",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <p style={{ color: "#6B7280", fontSize: 14 }}>Ρύθμιση συσκευής...</p>
      <Suspense>
        <SetupInner />
      </Suspense>
    </div>
  );
}
