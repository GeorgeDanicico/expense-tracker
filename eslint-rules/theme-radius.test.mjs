import rule from "./theme-radius.mjs";
import { createRuleTester } from "./rule-tester.mjs";

const CONTROL = "Control radius comes from the theme recipe; remove borderRadius.";
const MEMBER = "Control and dialog radius comes from the theme recipe; remove borderRadius.";

createRuleTester().run("theme-radius", rule, {
  valid: [
    `<Button size="sm" />`,
    `<Box borderRadius="lg" />`,
    `<Card rounded="xl" />`,
    `<Dialog.Root />`,
    `<NativeSelect.Field />`,
  ],
  invalid: [
    { code: `<Button borderRadius="lg" />`, errors: [{ message: CONTROL }] },
    { code: `<Input rounded="md" />`, errors: [{ message: CONTROL }] },
    { code: `<IconButton rounded="full" />`, errors: [{ message: CONTROL }] },
    { code: `<Textarea borderRadius="sm" />`, errors: [{ message: CONTROL }] },
    { code: `<Dialog.Content borderRadius="xl" />`, errors: [{ message: MEMBER }] },
    { code: `<NativeSelect.Field rounded="md" />`, errors: [{ message: MEMBER }] },
    { code: `<Tabs.Trigger borderRadius="md" />`, errors: [{ message: MEMBER }] },
  ],
});
