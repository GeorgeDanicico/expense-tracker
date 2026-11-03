import rule from "./no-raw-dialog.mjs";
import { createRuleTester } from "./rule-tester.mjs";

createRuleTester().run("no-raw-dialog", rule, {
  valid: [
    `<AppDialog open={open} onClose={close} title="Edit" />`,
    `<ConfirmDialog open={open} />`,
    `<Dialog.Content />`,
    `<Dialog.Title>Edit</Dialog.Title>`,
    `<Drawer.Body />`,
    `<Menu.Root />`,
    `<Dialog />`,
  ],
  invalid: [
    { code: `<Dialog.Root open={open}></Dialog.Root>`, errors: [{ messageId: "rawDialog", data: { name: "Dialog.Root" } }] },
    { code: `<Drawer.Root placement="bottom" />`, errors: [{ messageId: "rawDialog", data: { name: "Drawer.Root" } }] },
    { code: `<Dialog.RootProvider value={dialog} />`, errors: [{ messageId: "rawDialog" }] },
  ],
});
