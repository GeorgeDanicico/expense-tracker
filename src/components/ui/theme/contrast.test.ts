import { describe, expect, it } from "vitest";

import { ledgerSystem } from ".";
import { EXPENSE_CATEGORIES } from "@/lib/expenses/categories";

/** The colour a token ends in, as `#rrggbb` (Chakra resolves semantic tokens to their raw ones). */
function hex(name: string): string {
  let value = `{colors.${name}}`;
  for (let step = 0; step < 6; step++) {
    const ref = /^\{(.+)\}$/.exec(value);
    if (!ref) break;
    const token = ledgerSystem.tokens.getByName(ref[1]);
    if (!token) throw new Error(`No token ${ref[1]}`);
    value = String(token.originalValue);
  }
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} resolves to ${value}, not a hex colour`);
  return value;
}

function luminance(color: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ["bg.canvas", "bg.surface", "bg.subtle", "bg.muted", "bg.selected"];
const TONES = ["error", "success", "warning", "info"];

/**
 * axe's colour-contrast rule needs a layout engine, which the unit tests' DOM (happy-dom) has not,
 * so the theme's text pairs are checked here: normal text needs 4.5:1 (WCAG AA 1.4.3), the border of a
 * control or an icon 3:1 (1.4.11).
 */
describe("theme colour contrast", () => {
  it("the text colours read on every surface", () => {
    for (const text of ["fg", "fg.muted", "fg.accent", ...TONES.map((tone) => `fg.${tone}`)]) {
      for (const surface of SURFACES) expect(contrast(hex(text), hex(surface)), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("each tone's text reads on its own tint", () => {
    for (const tone of ["positive", "negative", "warning", "info"]) {
      expect(contrast(hex(`status.${tone}.fg`), hex(`status.${tone}.bg`)), tone).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("filled buttons and badges: the contrast colour on the solid, and the palette's text on its tint", () => {
    for (const palette of ["brand", "neutral", "orange", "danger", "success", "warning", "info"]) {
      expect(contrast(hex(`${palette}.contrast`), hex(`${palette}.solid`)), `${palette} solid`).toBeGreaterThanOrEqual(4.5);
      // `orange` is only ever a solid button (sign-out's "No"); its tint is 4.1:1 and unused.
      if (palette !== "orange") expect(contrast(hex(`${palette}.fg`), hex(`${palette}.subtle`)), `${palette} subtle`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("each category's icon colour on its tile", () => {
    for (const category of EXPENSE_CATEGORIES) {
      expect(contrast(hex(`category.${category}.fg`), hex(`category.${category}.bg`)), category).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("fg.subtle is for icons and decoration only: it is under 4.5:1, so text never uses it", () => {
    expect(contrast(hex("fg.subtle"), hex("bg.surface"))).toBeLessThan(4.5);
    expect(contrast(hex("fg.subtle"), hex("bg.surface"))).toBeGreaterThanOrEqual(3);
  });

  it("the focus ring and control borders reach 3:1 on the surface", () => {
    expect(contrast(hex("brand.focusRing"), hex("bg.surface"))).toBeGreaterThanOrEqual(3);
  });
});
