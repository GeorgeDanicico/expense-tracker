import rule from "./lazy-popper.mjs";
import { createRuleTester } from "./rule-tester.mjs";

const error = { messageId: "eager" };

createRuleTester().run("lazy-popper", rule, {
  valid: [
    `import { Box, Flex, Portal } from "@chakra-ui/react";`,
    `import { Button, IconButton } from "@chakra-ui/react";`,
    `import { Menu } from "./my-menu";`,
    `import { useLazyMenu } from "@/components/ui/lazy-menu";`,
  ],
  invalid: [
    { code: `import { Menu } from "@chakra-ui/react";`, errors: [error] },
    { code: `import { Box, Tooltip } from "@chakra-ui/react";`, errors: [error] },
    { code: `import { Popover, Menu } from "@chakra-ui/react";`, errors: [error, error] },
    { code: `import { Menu as ChakraMenu } from "@chakra-ui/react";`, errors: [error] },
    { code: `import { Select, HoverCard, Combobox } from "@chakra-ui/react";`, errors: [error, error, error] },
  ],
});
