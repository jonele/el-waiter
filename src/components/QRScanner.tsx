"use client";
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

interface Props {
  onScan: (raw: string) => void;
  active: boolean;
}

export default function QRScanner({ onScan, active }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onScanRef = useRef(onScan);
  const [cameraError, setCameraError] = useState(false);

  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let rafId = 0;
    let stream: MediaStream | null = null;

    async function startCamera() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        // Force play — Capacitor WebView may block autoplay
        try { await video.play(); } catch {
          // Retry after brief delay (Android WebView needs a tick)
          await new Promise(r => setTimeout(r, 300));
          try { await video.play(); } catch { /* still failed */ }
        }

        function tick() {
          if (stopped) return;
          const canvas = canvasRef.current;
          const v = videoRef.current;
          if (canvas && v && v.readyState === 4) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v, 0, 0);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(imageData.data, imageData.width, imageData.height);
              if (code?.data) {
                stopped = true;
                s.getTracks().forEach((t) => t.stop());
                onScanRef.current(code.data);
                return;
              }
            }
          }
          rafId = requestAnimationFrame(tick);
        }
        rafId = requestAnimationFrame(tick);
      } catch { setCameraError(true); }
    }
    void startCamera();

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active]);

  if (cameraError) return (
    <div style={{
      width: "100%", maxWidth: 320, aspectRatio: "1", margin: "0 auto",
      borderRadius: 16, background: "#1a1a1a",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 8, border: "2px dashed #374151",
    }}>
      <span style={{ fontSize: 32 }}>📵</span>
      <p style={{ color: "#9CA3AF", fontSize: 14, fontWeight: 600, textAlign: "center", padding: "0 16px" }}>
        Δεν επιτρέπεται η κάμερα
      </p>
      <p style={{ color: "#6B7280", fontSize: 12, textAlign: "center", padding: "0 16px" }}>
        Χρησιμοποίησε το PIN
      </p>
    </div>
  );

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 320, aspectRatio: "1", margin: "0 auto" }}>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 16, display: "block" }}
      />
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Blue scanning overlay */}
      <div style={{
        position: "absolute", inset: 0, borderRadius: 16,
        boxShadow: "inset 0 0 0 3px rgba(59,130,246,0.7)",
        pointerEvents: "none",
      }} />

      {/* Corner markers */}
      {[
        { top: 10, left: 10, borderTop: "3px solid #3B82F6", borderLeft: "3px solid #3B82F6", borderRadius: "8px 0 0 0" },
        { top: 10, right: 10, borderTop: "3px solid #3B82F6", borderRight: "3px solid #3B82F6", borderRadius: "0 8px 0 0" },
        { bottom: 10, left: 10, borderBottom: "3px solid #3B82F6", borderLeft: "3px solid #3B82F6", borderRadius: "0 0 0 8px" },
        { bottom: 10, right: 10, borderBottom: "3px solid #3B82F6", borderRight: "3px solid #3B82F6", borderRadius: "0 0 8px 0" },
      ].map((style, i) => (
        <div key={i} style={{ position: "absolute", width: 24, height: 24, ...style, pointerEvents: "none" }} />
      ))}
    </div>
  );
}
