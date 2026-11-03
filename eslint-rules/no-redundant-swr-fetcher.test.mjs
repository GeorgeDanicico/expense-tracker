import rule from "./no-redundant-swr-fetcher.mjs";
import { createRuleTester } from "./rule-tester.mjs";

const error = { messageId: "redundant" };

createRuleTester().run("no-redundant-swr-fetcher", rule, {
  valid: [
    `useSWR(key)`,
    `useSWR(key, { refreshInterval: 1000 })`,
    `useSWR(key, otherFetcher)`,
    `useSWR(key, (url) => apiFetcher(url))`,
    `useSWR(key, undefined, { revalidateOnMount: false })`,
    `useSomething(key, apiFetcher)`,
    `apiFetcher(url)`,
  ],
  invalid: [
    { code: `useSWR(key, apiFetcher)`, errors: [error] },
    { code: `useSWR(overviewKey(member), apiFetcher)`, errors: [error] },
    { code: `useSWR(key, apiFetcher, { keepPreviousData: true })`, errors: [error] },
    { code: `useSWRImmutable(key, apiFetcher)`, errors: [error] },
    { code: `useSWRInfinite(getKey, apiFetcher)`, errors: [error] },
  ],
});
