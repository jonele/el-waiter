import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.elvalue.elwaiter",
  appName: "EL Waiter",
  webDir: "capacitor-shell",   // minimal fallback — app loads from server.url
  server: {
    url: "https://el-waiter.vercel.app",
    cleartext: false,
  },
  plugins: {
    CapacitorSQLite: {
      iosDatabaseLocation: "Library/CapacitorDatabase",
      iosIsEncryption: false,
      androidIsEncryption: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#0d1117",
      showSpinner: false,
    },
    StatusBar: {
      style: "Dark",
      backgroundColor: "#0d1117",
    },
  },
};

export default config;
