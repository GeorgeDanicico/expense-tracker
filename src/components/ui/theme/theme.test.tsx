import { readFileSync } from "node:fs";

import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { REDUCED_MOTION_QUERY } from "./global-css";
import { ledgerSystem } from "./index";
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

  it("is not handled a second time in globals.css", () => {
    const globals = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");
    expect(globals).not.toMatch(/@media\s*\(prefers-reduced-motion/);
  });

  it("emits the sheet and dialog keyframes", () => {
    const css = pageCss();
    for (const name of ["sheet-in", "sheet-out", "pop-in", "pop-out"]) expect(css).toContain(`@keyframes ${name}`);
  });
});
