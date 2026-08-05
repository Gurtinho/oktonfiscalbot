import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

/** Escala semântica da marca, reaproveitada pelo colorPalette `brand` e `green`. */
const BRAND_PALETTE = {
  solid: { value: { _light: "{colors.brand.500}", _dark: "{colors.brand.500}" } },
  contrast: { value: { _light: "white", _dark: "white" } },
  fg: { value: { _light: "{colors.brand.600}", _dark: "{colors.brand.300}" } },
  muted: { value: { _light: "{colors.brand.100}", _dark: "{colors.brand.950}" } },
  subtle: { value: { _light: "{colors.brand.50}", _dark: "{colors.brand.950}" } },
  emphasized: { value: { _light: "{colors.brand.200}", _dark: "{colors.brand.900}" } },
  emphasis: { value: { _light: "{colors.brand.600}", _dark: "{colors.brand.400}" } },
  focusRing: { value: { _light: "{colors.brand.500}", _dark: "{colors.brand.400}" } },
};

/**
 * Design system do Okton Fiscal Bot em Chakra UI v3.
 *
 * Os valores seguem o mesmo palette usado antes (oklch, verde esmeralda +
 * grafite). Tokens semânticos expõem `bg`, `fg`, `border` etc. com variação
 * automática para o modo escuro através do seletor `.dark`.
 */
const config = defineConfig({
  globalCss: {
    "html, body": {
      bg: "bg",
      color: "fg",
      fontFamily: "body",
      fontSmooth: "antialiased",
    },
    ":root": { colorPalette: "green" },
    "*::placeholder": { color: "fg.muted" },
    "*::selection": { bg: "brand.emphasis", color: "white" },
  },
  theme: {
    tokens: {
      fonts: {
        heading: { value: `"Space Grotesk", ui-sans-serif, system-ui, sans-serif` },
        body: { value: `"DM Sans", ui-sans-serif, system-ui, sans-serif` },
        mono: { value: `ui-monospace, SFMono-Regular, "JetBrains Mono", monospace` },
      },
      radii: {
        l1: { value: "0.375rem" },
        l2: { value: "0.5rem" },
        l3: { value: "0.75rem" },
        l4: { value: "1rem" },
      },
      colors: {
        brand: {
          50: { value: "oklch(0.97 0.02 158)" },
          100: { value: "oklch(0.94 0.04 158)" },
          200: { value: "oklch(0.88 0.07 158)" },
          300: { value: "oklch(0.8 0.1 158)" },
          400: { value: "oklch(0.69 0.13 158)" },
          500: { value: "oklch(0.58 0.14 158)" },
          600: { value: "oklch(0.52 0.13 158)" },
          700: { value: "oklch(0.44 0.11 158)" },
          800: { value: "oklch(0.36 0.09 158)" },
          900: { value: "oklch(0.28 0.07 158)" },
          950: { value: "oklch(0.2 0.05 158)" },
        },
        graphite: {
          50: { value: "oklch(0.985 0.004 250)" },
          100: { value: "oklch(0.96 0.005 250)" },
          200: { value: "oklch(0.9 0.008 255)" },
          300: { value: "oklch(0.82 0.01 255)" },
          400: { value: "oklch(0.66 0.014 255)" },
          500: { value: "oklch(0.52 0.018 255)" },
          600: { value: "oklch(0.4 0.02 258)" },
          700: { value: "oklch(0.3 0.024 259)" },
          800: { value: "oklch(0.213 0.023 259)" },
          900: { value: "oklch(0.17 0.021 258)" },
          950: { value: "oklch(0.13 0.02 258)" },
        },
        danger: {
          500: { value: "oklch(0.55 0.2 25)" },
          600: { value: "oklch(0.48 0.18 25)" },
        },
        warn: {
          500: { value: "oklch(0.72 0.14 78)" },
          600: { value: "oklch(0.62 0.13 78)" },
        },
        info: {
          500: { value: "oklch(0.58 0.13 220)" },
          600: { value: "oklch(0.5 0.12 220)" },
        },
      },
      shadows: {
        panel: { value: "0 18px 40px -28px oklch(0.35 0.03 259 / 0.35)" },
      },
    },
    semanticTokens: {
      colors: {
        bg: {
          DEFAULT: {
            value: { base: "{colors.graphite.50}", _dark: "{colors.graphite.900}" },
          },
          subtle: {
            value: { base: "{colors.graphite.100}", _dark: "{colors.graphite.800}" },
          },
          muted: {
            value: { base: "{colors.graphite.200}", _dark: "{colors.graphite.800}" },
          },
          panel: { value: { base: "white", _dark: "{colors.graphite.800}" } },
          sidebar: {
            value: { base: "oklch(0.975 0.005 255)", _dark: "{colors.graphite.950}" },
          },
        },
        fg: {
          DEFAULT: {
            value: { base: "{colors.graphite.700}", _dark: "{colors.graphite.50}" },
          },
          muted: {
            value: { base: "{colors.graphite.500}", _dark: "{colors.graphite.400}" },
          },
          brand: { value: { base: "{colors.brand.600}", _dark: "{colors.brand.400}" } },
          danger: { value: { base: "{colors.danger.500}", _dark: "oklch(0.7 0.16 25)" } },
          warn: { value: { base: "oklch(0.5 0.12 78)", _dark: "{colors.warn.500}" } },
        },
        border: {
          DEFAULT: {
            value: { base: "{colors.graphite.200}", _dark: "oklch(0.3 0.02 258)" },
          },
          subtle: {
            value: { base: "{colors.graphite.100}", _dark: "oklch(0.26 0.02 258)" },
          },
          brand: { value: { base: "{colors.brand.500}", _dark: "{colors.brand.400}" } },
        },
        brand: BRAND_PALETTE,
        // `colorPalette="green"` usado nas telas resolve para a mesma marca.
        green: BRAND_PALETTE,
      },
    },
    recipes: {
      // Botões, badges e afins nascem na cor da marca em vez do cinza padrão.
      button: { defaultVariants: { colorPalette: "green" } },
      badge: { defaultVariants: { colorPalette: "gray" } },
    },
  },
});

export const system = createSystem(defaultConfig, config);
