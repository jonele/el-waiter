import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: "#1E3A5F",
        accent: "#00B4D8",
        status: {
          free:     "#16a34a",
          occupied: "#d97706",
          waiting:  "#dc2626",
        },
      },
      spacing: {
        touch: "3rem",
        "touch-lg": "4rem",
      },
      fontSize: {
        "2xs": ["0.65rem", { lineHeight: "1rem" }],
      },
    },
  },
  plugins: [],
};

export default config;
