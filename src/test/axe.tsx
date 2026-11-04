import { ChakraProvider } from "@chakra-ui/react";
import axe, { type AxeResults, type Result } from "axe-core";
import type { ReactElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { ledgerSystem } from "@/components/ui/theme";

// React reads this to know `act` is available outside a test renderer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Lets pending promises (SWR's fixture fetches) and the renders they cause settle. */
async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

/**
 * Renders `element` into the document (happy-dom, see the file's `@vitest-environment` line), lets
 * its fixture data load, and returns the container for axe.
 */
export async function mountForAxe(element: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ChakraProvider value={ledgerSystem}>{element}</ChakraProvider>); });
  await settle();
  return { container, unmount: async () => { await act(async () => root.unmount()); container.remove(); } };
}

/**
 * Rules that cannot run without a layout engine. happy-dom has none, so colour contrast and the
 * target size are checked from the theme's tokens instead (`src/components/ui/theme/contrast.test.ts`)
 * and in a real browser while reviewing screenshots.
 */
const NO_LAYOUT = ["color-contrast", "color-contrast-enhanced", "target-size", "scrollable-region-focusable"];

export async function runAxe(container: HTMLElement): Promise<Result[]> {
  const results: AxeResults = await axe.run(container, {
    // happy-dom cannot parse every selector axe builds (attribute values with quotes); the html is reported instead.
    selectors: false,
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    rules: Object.fromEntries(NO_LAYOUT.map((id) => [id, { enabled: false }])),
  });
  return results.violations;
}

export function describeViolations(violations: Result[]): string {
  return violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.slice(0, 4).map((n) => `  ${n.html.slice(0, 160)}\n    ${n.failureSummary?.split("\n").slice(1).join(" ")}`).join("\n")}`)
    .join("\n");
}
