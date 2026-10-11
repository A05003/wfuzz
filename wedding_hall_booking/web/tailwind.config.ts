import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#18203B', 600: '#232d4d', 500: '#2f3b63', 400: '#4a5a8c', 300: '#aab3cf', 200: '#d5dbea' },   // Deep Slate Navy
        gold: { DEFAULT: '#E5AD83', soft: '#f8e9dc', deep: '#a8683a' },                                                // Soft Accent Gold
        mint: { DEFAULT: '#10B981', deep: '#0b8a60', soft: '#dcf7ec' },                                                // Mint Green
        canvas: '#FAFAFA',                                                                                              // Light Gray
        ink: { DEFAULT: '#18203B', muted: '#657088', line: '#e7e2db' },
        danger: { DEFAULT: '#b42318', soft: '#fde8e6' },
      },
      fontFamily: { sans: ['"Segoe UI"', 'Tahoma', '"Noto Naskh Arabic"', '"Noto Sans Arabic"', 'Arial', 'sans-serif'] },
      boxShadow: { card: '0 1px 2px rgba(24,32,59,.06), 0 6px 20px rgba(24,32,59,.06)' },
    },
  },
  plugins: [],
};
export default config;
