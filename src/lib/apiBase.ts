// Bundled Capacitor builds load static HTML locally — API routes stay on Vercel.
// Web (Vercel) builds use relative paths (API_BASE = "").
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
