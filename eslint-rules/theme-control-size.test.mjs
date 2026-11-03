import rule from "./theme-control-size.mjs";
import { createRuleTester } from "./rule-tester.mjs";

const MESSAGE = "Controls use theme sizes (xs/sm/md); don't force 44px minimum heights.";

createRuleTester().run("theme-control-size", rule, {
  valid: [
    `<Button size="md" />`,
    `<Button minH="8" />`,
    `<Box minH="11" />`,
    `<ListRow minHeight="14" />`,
    `<Dialog.Root minH="11" />`,
  ],
  invalid: [
    { code: `<Button minH="11" />`, errors: [{ message: MESSAGE }] },
    { code: `<Input minHeight="14" />`, errors: [{ message: MESSAGE }] },
    { code: `<IconButton minH="11" />`, errors: [{ message: MESSAGE }] },
    { code: `<NativeSelect.Field minH="11" />`, errors: [{ message: MESSAGE }] },
    { code: `<Tabs.Trigger minHeight="14" />`, errors: [{ message: MESSAGE }] },
  ],
});
