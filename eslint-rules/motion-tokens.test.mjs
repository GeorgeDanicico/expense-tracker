import rule from "./motion-tokens.mjs";
import { createRuleTester } from "./rule-tester.mjs";

const literal = { messageId: "literal" };
const keyframes = { messageId: "keyframes" };

createRuleTester().run("motion-tokens", rule, {
  valid: [
    `<Box transition="none" />`,
    `<Box transitionProperty="opacity" transitionDuration="fast" />`,
    `<Box transitionDuration="moderate" transitionTimingFunction="{easings.standard}" />`,
    `<Box transition="opacity {durations.fast} {easings.standard}" />`,
    `<Box animation="slideUp {durations.moderate}" />`,
    `<Box css={{ transition: "none" }} />`,
    // dnd-kit hands over its own transition: a variable, not a literal.
    `<li style={{ transform: t, transition }} />`,
    `<Box transitionDuration={fast ? "fast" : "slow"} />`,
    // Only motion props are checked.
    `<Box w="120ms" />`,
    `<Box content="3s" />`,
    `const sizes = { height: "100ms" };`,
  ],
  invalid: [
    { code: `<Box transition="opacity 120ms ease" />`, errors: [literal] },
    { code: `<Box transition="opacity 0.15s" />`, errors: [literal] },
    { code: `<Box transition="background-color .6s, box-shadow .6s" />`, errors: [literal] },
    { code: `<Box transition={on ? "opacity 120ms" : "none"} />`, errors: [literal] },
    { code: "<Box transition={`opacity 200ms`} />", errors: [literal] },
    { code: `<Box transitionDuration="200ms" />`, errors: [literal] },
    { code: `<Box transitionTimingFunction="ease-in-out" />`, errors: [literal] },
    { code: `<Box transitionTimingFunction="cubic-bezier(0.4, 0, 0.2, 1)" />`, errors: [literal] },
    { code: `<Box animationDuration="1s" />`, errors: [literal] },
    { code: `<Box animation="spin 1s linear infinite" />`, errors: [literal] },
    { code: `<Box transitionDuration={{ base: "0ms", md: "200ms" }} />`, errors: [literal] },
    { code: `<Box css={{ "&:hover": { transition: "opacity 120ms ease" } }} />`, errors: [literal] },
    { code: `const style = { transition: "opacity 0.2s" };`, errors: [literal] },
    { code: `const style = { "animationDuration": "300ms" };`, errors: [literal] },
    { code: `const css = { "@keyframes spin": { to: { transform: "rotate(360deg)" } } };`, errors: [keyframes] },
    { code: "const css = `@keyframes fade { to { opacity: 1 } }`;", errors: [keyframes] },
  ],
});
