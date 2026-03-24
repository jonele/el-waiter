#!/bin/bash
# Build static export for Capacitor — API routes + web-only routes stay on Vercel
cd "$(dirname "$0")/.."

# Always restore excluded dirs on exit (even on failure)
cleanup() {
  [ -d src/app/_api_excluded ] && mv src/app/_api_excluded src/app/api
  [ -d src/app/_setup_excluded ] && mv src/app/_setup_excluded src/app/setup
}
trap cleanup EXIT

# Ensure env vars are available (Supabase URL/key get baked into static JS)
if ! grep -q "NEXT_PUBLIC_SUPABASE_URL" .env.local 2>/dev/null; then
  echo ">>> Pulling production env vars from Vercel..."
  vercel env pull .env.local --environment production --yes
fi

echo ">>> Cleaning previous build cache..."
rm -rf .next out

echo ">>> Excluding server-only routes from static build..."
mv src/app/api src/app/_api_excluded
mv src/app/setup src/app/_setup_excluded

echo ">>> Building static export..."
NEXT_PUBLIC_CAP=1 NEXT_PUBLIC_API_BASE=https://el-waiter.vercel.app npx next build

echo ">>> Static export ready in out/"
ls -la out/ | head -20
