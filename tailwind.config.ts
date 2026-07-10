import type { Config } from "tailwindcss";

// Identidade Contatia — distinta de Quotaria (navy/gold) e ContadorX (navy/laranja).
// Tema "sinal/radar": grafite-índigo profundo + acento índigo-elétrico + verde "vivo".
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#16172A",       // base texto / fundo escuro
        surface: "#FFFFFF",
        muted: "#F5F6FA",
        line: "#E4E6EF",
        subtle: "#667085",
        brand: {
          DEFAULT: "#4A3AFF", // índigo-elétrico (acento)
          dark: "#3627D6",
          soft: "#EEEBFF",
        },
        signal: "#12B76A",    // vivo / positivo
        warn: "#F79009",
        danger: "#F04438",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      borderRadius: { xl: "14px" },
    },
  },
  plugins: [],
};
export default config;
