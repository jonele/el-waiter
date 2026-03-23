import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.elvalue.joey",
  appName: "Joey",
  webDir: "capacitor-shell",
  server: {
    url: "https://el-waiter.vercel.app",
    cleartext: true, // Allow HTTP to LAN printers
    androidScheme: "https",
  },
  plugins: {
    CapacitorSQLite: {
      iosDatabaseLocation: "Library/CapacitorDatabase",
      iosIsEncryption: false,
      androidIsEncryption: false,
    },
    // PushNotifications disabled — no google-services.json yet
    // Re-enable when Firebase project is created for com.elvalue.joey
    // PushNotifications: {
    //   presentationOptions: ["badge", "sound", "alert"],
    // },
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
