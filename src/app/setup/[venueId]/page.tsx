// Server component — needed for static export compatibility
// The actual client logic lives in SetupClient.tsx
// This route handles QR code venue setup on web; native app uses in-app setup
export async function generateStaticParams() {
  return []; // Dynamic UUID routes not statically generated
}

export { default } from "./SetupClient";
