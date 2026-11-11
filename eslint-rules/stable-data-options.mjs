import { ruleDocsUrl } from "./docs-url.mjs";

const NAME = "stable-data-options";
const SWR_HOOKS = new Set(["useSWR", "useSWRImmutable", "useServerFirstSWR"]);
const STABLE_KEYS = /\b(?:ACCOUNT_API_KEY|FAMILY_API_KEY)\b/;
const STABLE_OPTIONS = /\bSTABLE_DATA\b/;

const rule = {
  meta: {
    type: "suggestion",
    docs: { description: "Reads of the account and the family list go through STABLE_DATA, so a page opening doesn't fetch them again.", url: ruleDocsUrl(NAME) },
    schema: [],
    messages: {
      stable:
        "The account and the family list rarely change, so a read of them passes STABLE_DATA (src/lib/api/stable-data.ts) " +
        "or goes through useAccount() / useFamily(). Without it every page you open asks for them again. " +
        "See docs/lint-rules.md#stable-data-options.",
    },
  },
  create(context) {
    const { sourceCode } = context;
    return {
      CallExpression(node) {
        const { callee } = node;
        const [key, ...options] = node.arguments;
        if (callee.type !== "Identifier" || !SWR_HOOKS.has(callee.name) || !key) return;
        if (!STABLE_KEYS.test(sourceCode.getText(key))) return;
        if (options.some((argument) => STABLE_OPTIONS.test(sourceCode.getText(argument)))) return;
        context.report({ node: key, messageId: "stable" });
      },
    };
  },
};

export default rule;
