import type { NextConfig } from "next";

const isTauri = process.env.NEXT_PUBLIC_TAURI === "1";

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  // Static export for Tauri mobile builds — Vercel deployment uses SSR normally
  ...(isTauri ? { output: "export", distDir: "out" } : {}),
};

export default nextConfig;
