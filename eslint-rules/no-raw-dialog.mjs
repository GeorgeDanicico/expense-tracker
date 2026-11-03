import { ruleDocsUrl } from "./docs-url.mjs";

const NAME = "no-raw-dialog";

const rule = {
  meta: {
    type: "problem",
    docs: { description: "Dialog.Root and Drawer.Root only in src/components/ui; screens use AppDialog.", url: ruleDocsUrl(NAME) },
    schema: [],
    messages: {
      rawDialog:
        "Use AppDialog (or ConfirmDialog) from @/components/ui instead of {{name}}: it is the one place that decides how a dialog looks and behaves on a phone. " +
        "See docs/lint-rules.md#no-raw-dialog.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const { name } = node;
        if (
          name.type === "JSXMemberExpression" &&
          name.object.type === "JSXIdentifier" &&
          (name.object.name === "Dialog" || name.object.name === "Drawer") &&
          (name.property.name === "Root" || name.property.name === "RootProvider")
        ) {
          context.report({ node, messageId: "rawDialog", data: { name: `${name.object.name}.${name.property.name}` } });
        }
      },
    };
  },
};

export default rule;
