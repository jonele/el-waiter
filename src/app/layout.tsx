import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import ConnectivityMonitor from "@/components/ConnectivityMonitor";
import KdsListener from "@/components/KdsListener";

const inter = Inter({ subsets: ["greek", "latin"] });

export const metadata: Metadata = {
  title: "EL Σερβιτόρος",
  description: "Εφαρμογή σερβιτόρου — EL Value",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Σερβιτόρος",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#1E3A5F",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="el">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className={inter.className}>
        <ServiceWorkerRegistrar />
        <ConnectivityMonitor />
        <KdsListener />
        {children}
      </body>
    </html>
  );
}
