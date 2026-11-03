import { ruleDocsUrl } from "./docs-url.mjs";

const NAME = "no-redundant-swr-fetcher";
const SWR_HOOKS = new Set(["useSWR", "useSWRImmutable", "useSWRInfinite"]);

const rule = {
  meta: {
    type: "suggestion",
    docs: { description: "useSWR(key, apiFetcher) repeats the fetcher that the global SWRConfig already sets.", url: ruleDocsUrl(NAME) },
    schema: [],
    messages: {
      redundant:
        "Drop apiFetcher: the global SWRConfig (src/components/ui/provider.tsx) already uses it, so useSWR(key) is enough. " +
        "See docs/lint-rules.md#no-redundant-swr-fetcher.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        const fetcher = node.arguments[1];
        if (callee.type === "Identifier" && SWR_HOOKS.has(callee.name) && fetcher?.type === "Identifier" && fetcher.name === "apiFetcher") {
          context.report({ node: fetcher, messageId: "redundant" });
        }
      },
    };
  },
};

export default rule;
