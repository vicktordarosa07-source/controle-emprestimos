import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        gray: {
          50: "#f5f8fc",
          100: "#edf2f8",
          200: "#e2e9f2",
          300: "#cbd5e1",
          500: "#68778e",
          600: "#53627a",
          700: "#36465f",
          800: "#23334d",
          900: "#15253e",
          950: "#0d1b31",
        },
        blue: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          500: "#2875f0",
          600: "#1b66e5",
          700: "#1559d6",
          800: "#164bb2",
          900: "#173f8d",
          950: "#142e5c",
        },
      },
      boxShadow: {
        soft: "0 8px 28px rgba(20, 42, 76, 0.07)",
        panel: "0 2px 8px rgba(20, 42, 76, 0.05)",
      },
    },
  },
  plugins: [],
};
export default config;
