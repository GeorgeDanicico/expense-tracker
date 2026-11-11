import { ruleDocsUrl } from "./docs-url.mjs";

const NAME = "lazy-popper";
/** Chakra's components that float a panel beside a button: each brings the positioning library and a state machine. */
const POPPER_COMPONENTS = new Set(["Menu", "Tooltip", "Popover", "HoverCard", "Combobox", "Select", "DatePicker", "ColorPicker"]);

const rule = {
  meta: {
    type: "problem",
    docs: { description: "Menu, Tooltip and the other floating panels of Chakra load lazily: use useLazyMenu.", url: ruleDocsUrl(NAME) },
    schema: [],
    messages: {
      eager:
        "Don't import {{name}} from @chakra-ui/react: it brings the positioning library and a state machine (about 26 KiB gzipped) into the " +
        "first load of every page. Use useLazyMenu() from src/components/ui/lazy-menu.tsx, which loads it when the page is idle. " +
        "See docs/lint-rules.md#lazy-popper.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "@chakra-ui/react" || node.importKind === "type") return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") continue;
          const name = specifier.imported.name ?? specifier.imported.value;
          if (POPPER_COMPONENTS.has(name)) context.report({ node: specifier, messageId: "eager", data: { name } });
        }
      },
    };
  },
};

export default rule;
