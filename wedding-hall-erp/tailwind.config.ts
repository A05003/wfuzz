import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fbf7ee",
          100: "#f5ecd3",
          500: "#b8892b",
          600: "#9a7022",
          700: "#7a561b",
          900: "#3b2a0d",
        },
      },
      fontFamily: { sans: ["Tahoma", "Segoe UI", "Arial", "sans-serif"] },
    },
  },
  plugins: [],
};

export default config;
