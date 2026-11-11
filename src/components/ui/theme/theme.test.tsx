import { readdirSync, readFileSync } from "node:fs";

import * as chakra from "@chakra-ui/react";
import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { REDUCED_MOTION_QUERY } from "./global-css";
import { ledgerConfig, ledgerSystem } from "./index";
import { DURATION_MS, EASINGS, transition } from "./motion";

type Token = { name: string; value: string; extensions: { cssVar?: { var: string; ref: string } } };
const tokens = (ledgerSystem.tokens as unknown as { allTokens: Token[] }).allTokens;

/** All the CSS the provider writes into the page. */
const pageCss = () =>
  [...renderToStaticMarkup(<ChakraProvider value={ledgerSystem}><p>x</p></ChakraProvider>).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1])
    .join("\n");

describe("theme tokens", () => {
  it("gives every token its own CSS variable, so none ends up referring to itself", () => {
    const byVar = new Map<string, string[]>();
    for (const token of tokens) {
      const cssVar = token.extensions.cssVar?.var;
      if (!cssVar) continue;
      byVar.set(cssVar, [...(byVar.get(cssVar) ?? []), token.name]);
    }
    // Colour palettes (`colorPalette.*`) and negative spacing (`spacing.-4`) share variables on purpose.
    const clashes = [...byVar].filter(([, names]) => new Set(names).size > 1 && !names.some((name) => name.includes("colorPalette") || name.includes(".-")));
    expect(clashes).toEqual([]);
    const selfReferences = tokens.filter((token) => token.extensions.cssVar && token.value === token.extensions.cssVar.ref);
    expect(selfReferences.map((token) => token.name)).toEqual([]);
  });

  it("fills the status surfaces (bg.error and the status palettes) with their colours", () => {
    const value = (name: string) => tokens.find((token) => token.name === name)?.value;
    expect(value("colors.status.negative.bg")).toBe("var(--chakra-colors-signal-negative-bg)");
    expect(value("colors.signal.negativeBg")).toBe("#F9EBE9");
    expect(value("colors.bg.error")).toBe("var(--chakra-colors-signal-negative-bg)");
  });

  it("has the motion tokens from the direction doc", () => {
    for (const [name, ms] of Object.entries(DURATION_MS)) {
      expect(tokens.find((token) => token.name === `durations.${name}`)?.value).toBe(`${ms}ms`);
    }
    for (const [name, curve] of Object.entries(EASINGS)) {
      expect(tokens.find((token) => token.name === `easings.${name}`)?.value).toBe(curve);
    }
    expect(transition("transform, opacity", "moderate", "enter")).toBe(
      "transform {durations.moderate} {easings.enter}, opacity {durations.moderate} {easings.enter}",
    );
  });

  it("has the four radius steps", () => {
    const radius = (name: string) => tokens.find((token) => token.name === `radii.${name}`)?.value;
    expect([radius("control"), radius("card"), radius("sheet"), radius("pill")]).toEqual(["0.625rem", "1rem", "1.375rem", "9999px"]);
  });
});

describe("reduced motion", () => {
  it("turns every animation and transition off in one media block", () => {
    const css = pageCss();
    const block = css.slice(css.indexOf(`@media ${REDUCED_MOTION_QUERY}`));
    expect(block).not.toBe(css);
    expect(block).toMatch(/^@media \(prefers-reduced-motion: reduce\)\{html,\*,\*::before,\*::after\{[^}]*\banimation:none!important;[^}]*\btransition:none!important;/);
  });

  it("leaves a skeleton's shimmer to that block: it is the recipe's CSS animation, with no timer in JavaScript", () => {
    const recipe = defaultConfig.theme?.recipes?.skeleton as unknown as { defaultVariants: { variant: string }; variants: { variant: Record<string, { animation?: string }> } };
    expect(recipe.defaultVariants.variant).toBe("pulse");
    expect(recipe.variants.variant.pulse.animation).toBe("pulse");
  });

  it("is not handled a second time in globals.css", () => {
    const globals = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");
    expect(globals).not.toMatch(/@media\s*\(prefers-reduced-motion/);
  });

  it("emits the sheet and dialog keyframes", () => {
    const css = pageCss();
    for (const name of ["sheet-in", "sheet-out", "pop-in", "pop-out"]) expect(css).toContain(`@keyframes ${name}`);
  });
});

describe("the trimmed Chakra defaults (PF9)", () => {
  type Config = { theme: { recipes: Record<string, unknown>; slotRecipes: Record<string, unknown> } };
  const configOf = (system: unknown) => (system as { _config: Config })._config;
  const full = createSystem(defaultConfig, ledgerConfig);
  const trimmed = configOf(ledgerSystem).theme;
  const reference = configOf(full).theme;
  const pageCssOf = (system: typeof ledgerSystem) =>
    [...renderToStaticMarkup(<ChakraProvider value={system}><p>x</p></ChakraProvider>).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join("\n");

  it("writes the same CSS into the page as the full default theme", () => {
    expect(pageCssOf(ledgerSystem)).toBe(pageCssOf(full));
  });

  it("keeps each recipe it has exactly as the full theme has it, with the app's changes on top", () => {
    for (const kind of ["recipes", "slotRecipes"] as const) {
      for (const [key, recipe] of Object.entries(trimmed[kind])) expect(JSON.stringify(recipe), `${kind}.${key}`).toBe(JSON.stringify(reference[kind][key]));
    }
  });

  it("leaves out only recipes of components the app doesn't use", () => {
    const left = [...Object.keys(reference.recipes), ...Object.keys(reference.slotRecipes)].filter((key) => !(key in trimmed.recipes) && !(key in trimmed.slotRecipes));
    expect(left.length).toBeGreaterThan(40);
    // The names of the left-out recipes, as the components they style are exported (`emptyState` -> `EmptyState`).
    const used = new Set<string>();
    for (const file of readdirSync(new URL("../../..", import.meta.url), { recursive: true, encoding: "utf8" })) {
      if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
      const source = readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");
      for (const match of source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"@chakra-ui\/react"/g)) {
        for (const name of match[1].split(",")) used.add(name.trim().split(" as ")[0].replace(/^type /, ""));
      }
    }
    // A component that borrows another's recipe (`IconButton` is a `button`, `Checkbox` draws a `checkmark`).
    const borrowed: Record<string, string[]> = { IconButton: ["button"], Checkbox: ["checkmark", "checkbox"], InputGroup: ["input"] };
    const missing = left.filter((key) => used.has(key[0].toUpperCase() + key.slice(1)) || Object.entries(borrowed).some(([name, keys]) => used.has(name) && keys.includes(key)));
    expect(missing).toEqual([]);
    // The check above only means something if Chakra still exports those components.
    for (const name of ["Menu", "Tabs", "Switch", "Dialog"]) expect(chakra).toHaveProperty(name);
  });
});
