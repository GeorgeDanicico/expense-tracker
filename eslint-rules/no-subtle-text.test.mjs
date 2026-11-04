import rule from "./no-subtle-text.mjs";
import { createRuleTester } from "./rule-tester.mjs";

const error = { messageId: "subtleText" };

createRuleTester().run("no-subtle-text", rule, {
  valid: [
    `<Text color="fg.muted">x</Text>`,
    `<Text color="fg">x</Text>`,
    `<Text>x</Text>`,
    `<Box color="fg.subtle"><Icon /></Box>`,
    `<Spinner color="fg.subtle" />`,
    `<Box bg="fg.subtle" />`,
    `<Text color={on ? "fg" : "fg.muted"}>x</Text>`,
  ],
  invalid: [
    { code: `<Text color="fg.subtle">x</Text>`, errors: [error] },
    { code: `<Text color={'fg.subtle'}>x</Text>`, errors: [error] },
    { code: `<Text color={on ? "fg" : "fg.subtle"}>x</Text>`, errors: [error] },
    { code: `<Text textStyle="label" color={dim && "fg.subtle"}>x</Text>`, errors: [error] },
  ],
});
