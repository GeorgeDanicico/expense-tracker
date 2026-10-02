import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  globalCss: {
    body: {
      bg: "canvas",
      color: "fg",
      fontSize: "0.875rem",
      fontWeight: "400",
      lineHeight: "1.5",
    },
    "*:focus-visible": {
      outline: "2px solid {colors.accent}",
      outlineOffset: "2px",
    },
  },
  theme: {
    tokens: {
      fonts: {
        body: { value: "var(--font-geist-sans), system-ui, sans-serif" },
        heading: { value: "var(--font-geist-sans), system-ui, sans-serif" },
      },
      fontSizes: {
        "2xs": { value: "0.75rem" },
        xs: { value: "0.75rem" },
        sm: { value: "0.8125rem" },
        md: { value: "0.875rem" },
        lg: { value: "1rem" },
        xl: { value: "1.5rem" },
        "2xl": { value: "1.5rem" },
        "3xl": { value: "1.625rem" },
      },
      fontWeights: {
        medium: { value: 500 },
        semibold: { value: 600 },
        bold: { value: 600 },
        extrabold: { value: 600 },
        black: { value: 600 },
      },
      radii: {
        lg: { value: "0.5rem" },
        xl: { value: "0.5rem" },
        "2xl": { value: "0.75rem" },
        "3xl": { value: "0.75rem" },
      },
    },
    semanticTokens: {
      colors: {
        canvas: { value: "#F4F3EE" },
        surface: { value: "#FFFFFF" },
        fg: {
          DEFAULT: { value: "#292824" },
          muted: { value: "#625F58" },
          subtle: { value: "#625F58" },
          error: { value: "#A33732" },
          success: { value: "#37634A" },
        },
        muted: { value: "#625F58" },
        accent: { value: "#A64B32" },
        clay: { value: "#D97757" },
        selected: { value: "#F5E8E1" },
        action: { value: "#292824" },
        positive: { value: "#37634A" },
        error: { value: "#A33732" },
        bg: {
          DEFAULT: { value: "#F4F3EE" },
          panel: { value: "#FFFFFF" },
          muted: { value: "#F4F3EE" },
          subtle: { value: "#F4F3EE" },
          error: { value: "#F9EBE9" },
          success: { value: "#EAF1EC" },
        },
        border: {
          DEFAULT: { value: "#DEDCD3" },
          muted: { value: "#DEDCD3" },
          subtle: { value: "#DEDCD3" },
          error: { value: "#A33732" },
        },
        // Existing category/status palettes continue to carry their original meaning.
        purple: {
          solid: { value: "#292824" },
          contrast: { value: "#FFFFFF" },
          fg: { value: "#A64B32" },
          subtle: { value: "#F5E8E1" },
          muted: { value: "#F5E8E1" },
          emphasized: { value: "#DEDCD3" },
          border: { value: "#DEDCD3" },
          focusRing: { value: "#A64B32" },
        },
        red: {
          solid: { value: "#A33732" },
          fg: { value: "#A33732" },
          subtle: { value: "#F9EBE9" },
          focusRing: { value: "#A33732" },
        },
        green: {
          solid: { value: "#37634A" },
          fg: { value: "#37634A" },
          subtle: { value: "#EAF1EC" },
          focusRing: { value: "#37634A" },
        },
      },
    },
    recipes: {
      link: { base: { minH: "2.75rem", alignItems: "center" } },
      button: {
        base: {
          minH: "2.75rem",
          minW: "2.75rem",
          borderRadius: "lg",
          fontWeight: "500",
        },
      },
      input: {
        base: {
          minH: "2.75rem",
          borderRadius: "lg",
          bg: "surface",
          borderColor: "border",
          "--focus-color": "colors.accent",
        },
      },
      textarea: {
        base: {
          borderRadius: "lg",
          bg: "surface",
          borderColor: "border",
          "--focus-color": "colors.accent",
        },
      },
      heading: { base: { fontWeight: "600", letterSpacing: "normal" } },
    },
    slotRecipes: {
      nativeSelect: {
        slots: ["root", "field", "indicator"],
        base: {
          field: { minH: "2.75rem", borderRadius: "lg", borderColor: "border" },
        },
      },
      field: {
        slots: [
          "root",
          "label",
          "helperText",
          "errorText",
          "requiredIndicator",
        ],
        base: {
          label: { fontSize: "0.8125rem", fontWeight: "500" },
          helperText: { color: "muted", fontSize: "0.75rem" },
          errorText: { color: "error", fontSize: "0.75rem" },
        },
      },
      dialog: {
        slots: [
          "trigger",
          "backdrop",
          "positioner",
          "content",
          "header",
          "body",
          "footer",
          "title",
          "description",
          "closeTrigger",
        ],
        base: {
          backdrop: { bg: "blackAlpha.500" },
          positioner: {
            p: "4",
            alignItems: "center",
            height: "var(--available-height, 100dvh)",
            top: "var(--viewport-offset-top, 0px)",
          },
          content: {
            borderRadius: "2xl",
            bg: "surface",
            boxShadow: "0 12px 40px rgb(41 40 36 / 18%)",
            maxH: "calc(var(--available-height, 100dvh) - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 2rem)",
            overflowY: "auto",
          },
          header: { p: "4", paddingInlineEnd: "16" },
          body: { px: "4", pt: "0", pb: "4" },
          footer: { p: "4" },
          title: { fontSize: "1rem", fontWeight: "600" },
          closeTrigger: { top: "2", insetEnd: "2" },
        },
      },
    },
  },
});

export const ledgerSystem = createSystem(defaultConfig, config);
