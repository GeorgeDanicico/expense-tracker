import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";

const reportClientError = vi.hoisted(() => vi.fn());
const effects = vi.hoisted(() => [] as Array<{ deps: unknown[] | undefined }>);

vi.mock("@/lib/client-log", () => ({ reportClientError }));
// renderToStaticMarkup never runs effects: run them as they are declared, and keep their dependencies to check.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => void, deps?: unknown[]) => {
    effects.push({ deps });
    effect();
  },
}));

import AppError from "./(app)/error";
import RootError from "./error";
import GlobalError from "./global-error";

const retry = vi.fn();
const serverError = Object.assign(new Error("An error occurred in the Server Components render."), { digest: "2810403425" });

function render(node: React.ReactNode) {
  return renderToStaticMarkup(<ChakraProvider value={ledgerSystem}>{node}</ChakraProvider>);
}

beforeEach(() => {
  reportClientError.mockClear();
  effects.length = 0;
});

describe("the error boundaries", () => {
  it("(app)/error.tsx reports its error as a boundary error, in an effect that depends only on the error", () => {
    const html = render(<AppError error={serverError} retry={retry} />);

    expect(reportClientError).toHaveBeenCalledExactlyOnceWith(serverError, "boundary");
    expect(effects).toEqual([{ deps: [serverError] }]);
    expect(html).toContain("We couldn’t load this page");
    expect(html).toContain("Try again");
  });

  it("error.tsx, for pages outside (app), reports as a boundary error, without the way home", () => {
    const html = render(<RootError error={serverError} retry={retry} />);

    expect(reportClientError).toHaveBeenCalledExactlyOnceWith(serverError, "boundary");
    expect(effects).toEqual([{ deps: [serverError] }]);
    const appHtml = render(<AppError error={serverError} retry={retry} />);
    expect(appHtml).toContain("Go to Home");
    expect(html).not.toContain("Go to Home");
    expect(html).toContain("We couldn’t load this page");
  });

  it("global-error.tsx reports as a global boundary error and renders its own document", () => {
    const html = renderToStaticMarkup(<GlobalError error={serverError} retry={retry} />);

    expect(reportClientError).toHaveBeenCalledExactlyOnceWith(serverError, "global_boundary");
    expect(effects).toEqual([{ deps: [serverError] }]);
    expect(html).toMatch(/^<html lang="en">/);
    expect(html).toContain("<body");
    expect(html).toContain("We couldn’t load this page");
    expect(html).toContain("Try again");
  });

  it("reports a value that isn't an Error too", () => {
    render(<AppError error="boom" retry={retry} />);

    expect(reportClientError).toHaveBeenCalledWith("boom", "boundary");
  });
});
