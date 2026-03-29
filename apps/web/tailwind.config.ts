import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sand: "#f8f6f1",
        ink: "#111827",
        mint: "#dff5ec",
        ember: "#f4dfcf",
        graphite: {
          950: "#050505",
          900: "#0b0b0b",
          800: "#171717",
          700: "#252525",
          600: "#343434",
          500: "#4f4f4f",
          400: "#9b9b9b",
        },
      },
      boxShadow: {
        soft: "0 24px 80px rgba(17, 24, 39, 0.08)",
        glass: "0 32px 90px rgba(0, 0, 0, 0.34)",
      },
      fontFamily: {
        sans: ["Jura", "Space Grotesk", "Avenir Next", "Segoe UI", "sans-serif"],
        display: ["Jura", "Space Grotesk", "Avenir Next", "Segoe UI", "sans-serif"],
        body: ["Space Grotesk", "Avenir Next", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
