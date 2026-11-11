import rule from "./streamed-section.mjs";
import { createRuleTester } from "./rule-tester.mjs";

const error = { messageId: "bare" };

createRuleTester().run("streamed-section", rule, {
  valid: [
    `import { StreamedSection } from "@/components/ui/streamed-section"; const a = <StreamedSection fallback={<Card />}><Block /></StreamedSection>;`,
    // No fallback: nothing is drawn first, so nothing is swapped out (a boundary for useSearchParams).
    `import { Suspense } from "react"; const a = <Suspense><Form /></Suspense>;`,
    // Another library's Suspense, or none imported.
    `import { Suspense } from "somewhere-else"; const a = <Suspense fallback={<p />}><Form /></Suspense>;`,
    `const a = <Suspense fallback={<p />}><Form /></Suspense>;`,
  ],
  invalid: [
    { code: `import { Suspense } from "react"; const a = <Suspense fallback={<Card />}><Block /></Suspense>;`, errors: [error] },
    { code: `import { Suspense as Wait } from "react"; const a = <Wait fallback={null}><Block /></Wait>;`, errors: [error] },
    { code: `import * as React from "react"; const a = <React.Suspense fallback={<Card />}><Block /></React.Suspense>;`, errors: [error] },
    { code: `import React from "react"; const a = <React.Suspense fallback={<Card />}><Block /></React.Suspense>;`, errors: [error] },
  ],
});
