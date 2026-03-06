import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: "#3B82F6",
        accent: "#10B981",
        status: {
          free:     "#4ADE80",
          occupied: "#60A5FA",
          waiting:  "#FBBF24",
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
