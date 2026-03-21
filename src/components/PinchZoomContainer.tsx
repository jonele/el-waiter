"use client";
import { useRef, useState, useCallback, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  minScale?: number;
  maxScale?: number;
  className?: string;
}

/**
 * Lightweight pinch-to-zoom + pan container for mobile.
 * Wraps any content (table grid, list, etc.) and makes it zoomable.
 * Inspired by RSRV TransformableCanvas but simplified for grid layouts.
 */
export default function PinchZoomContainer({
  children,
  minScale = 0.5,
  maxScale = 3,
  className = "",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const lastTouchRef = useRef<{ dist: number; cx: number; cy: number; tx: number; ty: number } | null>(null);
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);

  const getTouchDistance = (t1: React.Touch, t2: React.Touch) =>
    Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = getTouchDistance(e.touches[0], e.touches[1]);
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      lastTouchRef.current = { dist, cx, cy, tx: translate.x, ty: translate.y };
      lastPanRef.current = null;
    } else if (e.touches.length === 1 && scale > 1) {
      lastPanRef.current = { x: e.touches[0].clientX - translate.x, y: e.touches[0].clientY - translate.y };
      lastTouchRef.current = null;
    }
  }, [scale, translate]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastTouchRef.current) {
      e.preventDefault();
      const dist = getTouchDistance(e.touches[0], e.touches[1]);
      const ratio = dist / lastTouchRef.current.dist;
      const newScale = Math.min(maxScale, Math.max(minScale, scale * ratio));
      setScale(newScale);
      lastTouchRef.current.dist = dist;
    } else if (e.touches.length === 1 && lastPanRef.current && scale > 1) {
      const x = e.touches[0].clientX - lastPanRef.current.x;
      const y = e.touches[0].clientY - lastPanRef.current.y;
      setTranslate({ x, y });
    }
  }, [scale, minScale, maxScale]);

  const handleTouchEnd = useCallback(() => {
    lastTouchRef.current = null;
    lastPanRef.current = null;
    // Snap back to 1x if close
    if (scale < 0.8) { setScale(1); setTranslate({ x: 0, y: 0 }); }
  }, [scale]);

  // Double-tap to toggle zoom
  const lastTapRef = useRef(0);
  const handleDoubleTap = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      // Double tap: toggle between 1x and 2x
      if (scale > 1.2) {
        setScale(1);
        setTranslate({ x: 0, y: 0 });
      } else {
        setScale(2);
      }
    }
    lastTapRef.current = now;
  }, [scale]);

  const resetZoom = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  return (
    <div className={`relative ${className}`} ref={containerRef} style={{ overflow: "hidden", touchAction: scale > 1 ? "none" : "pan-y" }}>
      <div
        onTouchStart={(e) => { handleTouchStart(e); handleDoubleTap(e); }}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transformOrigin: "top left",
          transition: lastTouchRef.current ? "none" : "transform 0.2s ease-out",
        }}
      >
        {children}
      </div>

      {/* Zoom controls — only show when zoomed */}
      {scale !== 1 && (
        <div
          className="absolute top-2 right-2 flex flex-col gap-1 z-10"
          style={{ pointerEvents: "auto" }}
        >
          <button
            onClick={() => setScale((s) => Math.min(maxScale, s * 1.3))}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold transition-transform active:scale-90"
            style={{ background: "var(--c-surface)", color: "var(--c-text)", border: "1px solid var(--c-border)", boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}
          >
            +
          </button>
          <button
            onClick={() => setScale((s) => Math.max(minScale, s / 1.3))}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold transition-transform active:scale-90"
            style={{ background: "var(--c-surface)", color: "var(--c-text)", border: "1px solid var(--c-border)", boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}
          >
            −
          </button>
          <button
            onClick={resetZoom}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold transition-transform active:scale-90"
            style={{ background: "var(--c-surface)", color: "var(--c-text2)", border: "1px solid var(--c-border)", boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}
          >
            1:1
          </button>
        </div>
      )}

      {/* Scale indicator */}
      {scale !== 1 && (
        <div
          className="absolute bottom-2 left-2 px-2 py-1 rounded-lg text-xs font-semibold"
          style={{ background: "var(--c-surface)", color: "var(--c-text2)", border: "1px solid var(--c-border)", opacity: 0.8 }}
        >
          {Math.round(scale * 100)}%
        </div>
      )}
    </div>
  );
}
