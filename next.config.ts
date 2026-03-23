import type { NextConfig } from "next";

const isStatic =
  process.env.NEXT_PUBLIC_TAURI === "1" ||
  process.env.NEXT_PUBLIC_CAP === "1";

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  // Fix workspace root detection warning (multiple lockfiles)
  outputFileTracingRoot: __dirname,
  // Static export for Tauri + Capacitor builds — Vercel uses SSR normally
  ...(isStatic ? { output: "export", distDir: "out" } : {}),
};

export default nextConfig;
