import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#18203b", 50: "#eef0f6", 100: "#d5d9e8", 700: "#232d52", 900: "#18203b" },
        gold: { DEFAULT: "#e5ad83", 100: "#fbf0e7", 600: "#c98a5c" },
      },
      fontFamily: {
        sans: ["Cairo", "Tajawal", "Noto Naskh Arabic", "Tahoma", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
