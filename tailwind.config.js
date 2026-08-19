import tailwindcssAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    './src/**/*.{ts,tsx}',
    './popup.tsx',
    './standalone.tsx',
    './popup.html',
    './standalone.html'
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / 0.90)",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card) / 0.75)",
          foreground: "hsl(var(--card-foreground))",
        },
        /* Landing page accent colors */
        cyan: {
          DEFAULT: "#24c7ef",
          strong: "#1594df",
        },
        warm: {
          DEFAULT: "#f7b15d",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "1.125rem",    /* 18px — message bubbles */
        "2xl": "1.375rem", /* 22px — mini-panels */
        "3xl": "1.875rem", /* 30px — main shells */
        pill: "9999px",
      },
      boxShadow: {
        glass: "0 24px 90px rgba(34, 27, 46, 0.12)",
        "glass-strong": "0 38px 120px rgba(19, 15, 28, 0.42)",
        "glow-cyan": "0 0 0 1px rgba(36,199,239,0.28), 0 4px 20px rgba(36,199,239,0.12)",
        "glow-warm": "0 0 0 1px rgba(247,177,93,0.28), 0 4px 20px rgba(247,177,93,0.12)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "collapsible-down": {
          from: { height: "0", opacity: "0" },
          to: { height: "var(--radix-collapsible-content-height)", opacity: "1" },
        },
        "collapsible-up": {
          from: { height: "var(--radix-collapsible-content-height)", opacity: "1" },
          to: { height: "0", opacity: "0" },
        },
        /* A row arriving in a live list: it grows its own height (grid 0fr -> 1fr
           works for rows of unknown height) so whatever sits below slides down
           instead of jumping a row at a time. */
        "list-item-in": {
          from: { gridTemplateRows: "0fr", opacity: "0", transform: "translateY(-2px)" },
          to: { gridTemplateRows: "1fr", opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "collapsible-down": "collapsible-down 0.2s ease-out",
        "collapsible-up": "collapsible-up 0.2s ease-out",
        "list-item-in": "list-item-in 0.24s cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [tailwindcssAnimate],
}

