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
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "https://localhost" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization" },
        ],
      },
    ];
  },
};

export default nextConfig;
