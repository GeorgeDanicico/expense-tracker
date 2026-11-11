import rule from "./stable-data-options.mjs";
import { createRuleTester } from "./rule-tester.mjs";

const error = { messageId: "stable" };

createRuleTester().run("stable-data-options", rule, {
  valid: [
    `useSWR(ACCOUNT_API_KEY, STABLE_DATA)`,
    `useServerFirstSWR(enabled ? FAMILY_API_KEY : null, STABLE_DATA)`,
    `useSWR(FAMILY_API_KEY, { ...STABLE_DATA, refreshInterval: 1000 })`,
    `useSWR(TODOS_API_KEY)`,
    `useSWR(dashboardApiKey(member))`,
    `useSWR(key)`,
    `useSomething(ACCOUNT_API_KEY)`,
    `mutate(FAMILY_API_KEY)`,
  ],
  invalid: [
    { code: `useSWR(ACCOUNT_API_KEY)`, errors: [error] },
    { code: `useSWR(FAMILY_API_KEY, { revalidateOnFocus: true })`, errors: [error] },
    { code: `useSWR(account?.membership ? FAMILY_API_KEY : null)`, errors: [error] },
    { code: `useServerFirstSWR(FAMILY_API_KEY, { revalidateOnFocus: false })`, errors: [error] },
    { code: `useSWRImmutable(ACCOUNT_API_KEY)`, errors: [error] },
  ],
});
