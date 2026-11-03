import rule from "./theme-colors.mjs";
import { createRuleTester } from "./rule-tester.mjs";

const HEX = "Use a colour token (e.g. fg.muted, status.warning.fg) instead of a hex value.";
const PALETTE = "Use a theme palette: brand, neutral, danger, success, warning or info.";

createRuleTester().run("theme-colors", rule, {
  valid: [
    `<Text color="fg.muted" />`,
    `<Box bg="bg.surface" borderColor="border" />`,
    `<Button colorPalette="brand" />`,
    `<Button colorPalette={"danger"} />`,
    `<Button colorPalette={ok ? "success" : "warning"} />`,
    `<Button colorPalette={palette} />`,
    `<Text id="#abc" />`,
    `<Text color={tokenFor(status)} />`,
  ],
  invalid: [
    { code: `<Text color="#ff0000" />`, errors: [{ message: HEX }] },
    { code: `<Box bg="#abc" />`, errors: [{ message: HEX }] },
    { code: `<Box borderColor={ok ? "#00000080" : "border"} />`, errors: [{ message: HEX }] },
    { code: `<svg fill="#123456" />`, errors: [{ message: HEX }] },
    { code: `<Button colorPalette="purple" />`, errors: [{ message: PALETTE }] },
    { code: `<Button colorPalette={"orange"} />`, errors: [{ message: PALETTE }] },
    { code: `<Button colorPalette={ok ? "teal" : "brand"} />`, errors: [{ message: PALETTE }] },
    { code: `<Button colorPalette={ok ? "brand" : "pink"} />`, errors: [{ message: PALETTE }] },
  ],
});
