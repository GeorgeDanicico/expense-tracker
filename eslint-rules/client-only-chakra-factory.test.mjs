import rule from "./client-only-chakra-factory.mjs";
import { createRuleTester } from "./rule-tester.mjs";

const error = { messageId: "serverFactory" };

createRuleTester().run("client-only-chakra-factory", rule, {
  valid: [
    `"use client";\nimport { chakra } from "@chakra-ui/react";\nconst Row = chakra("li", rowRecipe);`,
    `'use client';\nimport { createContext } from "react";\nexport const Context = createContext(null);`,
    `"use strict";\n"use client";\nimport { chakra } from "@chakra-ui/react";\nconst Row = chakra("div");`,
    // Inside a function the call runs when it is rendered, on the client.
    `import { chakra } from "@chakra-ui/react";\nexport function Row() { const Item = useMemo(() => chakra("li"), []); return null; }`,
    // Recipes are plain configuration, fine on the server.
    `import { defineRecipe } from "@chakra-ui/react";\nexport const rowRecipe = defineRecipe({ base: {} });`,
    // A function of the same name from elsewhere.
    `import { createContext } from "@/lib/log/request-context";\nconst context = createContext();`,
    `const chakra = (tag) => tag;\nconst Row = chakra("li");`,
  ],
  invalid: [
    { code: `import { chakra } from "@chakra-ui/react";\nconst Row = chakra("li", rowRecipe);`, errors: [error] },
    { code: `import { chakra as styled } from "@chakra-ui/react";\nexport const Row = styled("li");`, errors: [error] },
    { code: `import { createRecipeContext } from "@chakra-ui/react";\nconst { withContext } = createRecipeContext({ key: "row" });`, errors: [error] },
    { code: `import { createSlotRecipeContext } from "@chakra-ui/react";\nconst { withProvider } = createSlotRecipeContext({ key: "card" });`, errors: [error] },
    { code: `import { createContext } from "react";\nexport const Context = createContext(null);`, errors: [error] },
    { code: `import * as React from "react";\nexport const Context = React.createContext(null);`, errors: [error] },
    // A directive further down doesn't count.
    { code: `import { chakra } from "@chakra-ui/react";\n"use client";\nconst Row = chakra("li");`, errors: [error] },
  ],
});
