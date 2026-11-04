import { ChakraProvider } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";
import type { AccountData } from "@/lib/account/types";
import { ACCOUNT_API_KEY } from "@/lib/api/keys";
import { PARENT_PERMISSIONS } from "@/lib/family/repository";
import { DEFAULT_KID_PERMISSIONS } from "@/lib/permissions";

const navigation = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { MobileTabBar } from "./mobile-tab-bar";
import { SectionNav } from "./section-nav";
import { SidebarNav } from "./sidebar-nav";

const membership = (role: "parent" | "kid", permissions = DEFAULT_KID_PERMISSIONS): AccountData["membership"] => ({
  memberId: "m1",
  role,
  isCreator: false,
  familyName: "Popescu",
  permissions: role === "parent" ? PARENT_PERMISSIONS : permissions,
});

function render(node: ReactNode, who: AccountData["membership"] = membership("parent")) {
  const account: AccountData = { email: "a@b.c", signInName: "a@b.c", currency: "EUR", features: { family: who !== null }, membership: who, mustChangePassword: false, avatarUrl: null };
  return renderToStaticMarkup(
    <ChakraProvider value={ledgerSystem}>
      <SWRConfig value={{ provider: () => new Map(), fetcher: () => new Promise(() => {}), fallback: { [ACCOUNT_API_KEY]: account } }}>{node}</SWRConfig>
    </ChakraProvider>,
  );
}

/** The links in `html` as `label=href`, with `*` on the one marked as the current page. */
function links(html: string) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes, inner]) => {
    const href = attributes.match(/href="([^"]*)"/)?.[1];
    const text = inner.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "").trim();
    return `${text}=${href}${attributes.includes('aria-current="page"') ? "*" : ""}`;
  });
}

beforeEach(() => {
  navigation.pathname = "/dashboard";
});

describe("the bottom bar", () => {
  it("is Home, Money, the + button, Planning and More, in that order, with labels", () => {
    const html = render(<MobileTabBar />);
    expect(links(html)).toEqual(["Home=/dashboard*", "Money=/expenses", "Planning=/reminders", "More=/more"]);
    const at = (text: string) => html.indexOf(text);
    expect(at(">Money<")).toBeLessThan(at('aria-label="Quick add"'));
    expect(at('aria-label="Quick add"')).toBeLessThan(at(">Planning<"));
    expect(html).toContain('aria-label="Primary navigation"');
  });

  it.each([
    ["/expenses", "Money"],
    ["/expenses/import", "Money"],
    ["/net-worth", "Money"],
    ["/calendar", "Planning"],
    ["/settings/family", "More"],
    ["/more", "More"],
  ])("highlights the tab for %s", (pathname, tab) => {
    navigation.pathname = pathname;
    const current = links(render(<MobileTabBar />)).filter((link) => link.endsWith("*"));
    expect(current).toHaveLength(1);
    expect(current[0].startsWith(`${tab}=`)).toBe(true);
  });

  it("leaves Money out for a kid with every money module off, and the + stays between the rest", () => {
    const html = render(<MobileTabBar />, membership("kid", { ...DEFAULT_KID_PERMISSIONS, expenses: "off" }));
    expect(links(html)).toEqual(["Home=/dashboard*", "Planning=/reminders", "More=/more"]);
  });
});

describe("the sidebar", () => {
  it("has Add at the top and the same groups: Home, Money, Planning, More", () => {
    const html = render(<SidebarNav signInName="a@b.c" />);
    expect(html.indexOf("Add")).toBeLessThan(html.indexOf("Home"));
    for (const label of ["Money", "Planning", "More"]) expect(html).toContain(`>${label}</p>`);
    expect(links(html)).toEqual([
      "Home=/dashboard*",
      "Expenses=/expenses",
      "Investments=/investments",
      "Net worth=/net-worth",
      "Reminders=/reminders",
      "To-dos=/todos",
      "Calendar=/calendar",
      "Settings=/settings",
    ]);
  });

  it("shows a user without a family Reminders alone, and a kid without investments Expenses alone", () => {
    expect(links(render(<SidebarNav signInName="a" />, null))).toEqual(
      ["Home=/dashboard*", "Expenses=/expenses", "Investments=/investments", "Net worth=/net-worth", "Reminders=/reminders", "Settings=/settings"],
    );
    expect(links(render(<SidebarNav signInName="a" />, membership("kid"))).slice(1, 3)).toEqual(["Expenses=/expenses", "Reminders=/reminders"]);
  });
});

describe("the segmented control", () => {
  const segments = (html: string) => [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map(([input]) => ({ value: input.match(/value="([^"]*)"/)?.[1], checked: input.includes("checked") }));

  it("switches Money's pages by their URLs, with the current page selected", () => {
    navigation.pathname = "/investments";
    expect(segments(render(<SectionNav />))).toEqual([
      { value: "/expenses", checked: false },
      { value: "/investments", checked: true },
      { value: "/net-worth", checked: false },
    ]);
  });

  it("keeps Expenses selected on its import page", () => {
    navigation.pathname = "/expenses/import";
    expect(segments(render(<SectionNav />)).find((segment) => segment.checked)?.value).toBe("/expenses");
  });

  it("switches Planning's pages for a family member", () => {
    navigation.pathname = "/todos";
    expect(segments(render(<SectionNav />)).map((segment) => segment.value)).toEqual(["/reminders", "/todos", "/calendar"]);
  });

  it("shows nothing for a section with one page, or outside Money and Planning", () => {
    navigation.pathname = "/reminders";
    expect(segments(render(<SectionNav />, null))).toEqual([]);
    navigation.pathname = "/expenses";
    expect(segments(render(<SectionNav />, membership("kid")))).toEqual([]);
    for (const pathname of ["/dashboard", "/settings", "/more"]) {
      navigation.pathname = pathname;
      expect(segments(render(<SectionNav />))).toEqual([]);
    }
  });
});
