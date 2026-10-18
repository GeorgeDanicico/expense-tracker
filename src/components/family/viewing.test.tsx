import { ChakraProvider } from "@chakra-ui/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";
import type { AccountData, AccountMembership } from "@/lib/account/types";
import type { FamilyData, FamilyMember } from "@/lib/family/repository";
import { PARENT_PERMISSIONS } from "@/lib/family/repository";
import { DEFAULT_KID_PERMISSIONS } from "@/lib/permissions";

const ME_ID = "60000000-0000-4000-8000-000000000001";
const ANA_ID = "60000000-0000-4000-8000-000000000002";
const TEO_ID = "60000000-0000-4000-8000-000000000003";

const state = vi.hoisted(() => ({
  search: "",
  account: undefined as AccountData | undefined,
  family: undefined as { family: FamilyData | null } | undefined,
  familyError: undefined as unknown,
  fetched: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.search),
  usePathname: () => "/expenses",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/hooks/use-account", () => ({
  useAccount: () => ({ account: state.account, currency: state.account?.currency ?? "EUR" }),
}));
vi.mock("swr", () => ({
  default: (key: unknown) => {
    state.fetched.push(key);
    return { data: key ? state.family : undefined, error: key ? state.familyError : undefined };
  },
}));

import { useViewing } from "@/hooks/use-viewing";

import { ViewingBar, ViewingPicker, viewingHref } from "./viewing-picker";
import { WriteOnly } from "./write-only";

function aMember(overrides: Partial<FamilyMember>): FamilyMember {
  return {
    memberId: ME_ID,
    userId: "u",
    role: "kid",
    isCreator: false,
    displayName: "Member",
    username: null,
    currency: "EUR",
    color: null,
    avatarUrl: null,
    joinedAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

const MEMBERS = [
  aMember({ memberId: ME_ID, role: "parent", isCreator: true, displayName: "Maria" }),
  aMember({ memberId: ANA_ID, displayName: "Ana", currency: "RON" }),
  aMember({ memberId: TEO_ID, displayName: "Teo", currency: "USD" }),
];

function membership(overrides: Partial<AccountMembership> = {}): AccountMembership {
  return { memberId: ME_ID, role: "parent", isCreator: true, familyName: "The Smiths", permissions: PARENT_PERMISSIONS, ...overrides };
}

function anAccount(m: AccountMembership | null): AccountData {
  return { email: "me@example.com", currency: "EUR", features: { family: true }, membership: m, mustChangePassword: false, avatarUrl: null };
}

function html(node: React.ReactNode) {
  // Chakra writes its style rules into the markup; only the elements matter here.
  return renderToStaticMarkup(<ChakraProvider value={ledgerSystem}>{node}</ChakraProvider>).replace(/<style[\s\S]*?<\/style>/g, "");
}

/** The chips' labels, in order, with whether each is pressed (chip text follows a decorative dot or icon). */
function chips(markup: string) {
  return [...markup.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>(.*?)<\/button>/g)].map(
    ([, pressed, inner]) => `${inner.replace(/<[^>]+>/g, "")}${pressed === "true" ? " (selected)" : ""}`,
  );
}

function Probe() {
  const viewing = useViewing();
  return createElement("pre", null, JSON.stringify({ ...viewing, hrefFor: viewing.hrefFor("/investments?a=1") }));
}

function viewingNow() {
  const text = renderToStaticMarkup(createElement(Probe)).replace(/^<pre>|<\/pre>$/g, "").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
  return JSON.parse(text) as ReturnType<typeof useViewing> & { hrefFor: string };
}

beforeEach(() => {
  state.search = "";
  state.account = anAccount(membership());
  state.family = { family: { family: { id: "f", name: "The Smiths", createdAt: "2026-10-01T00:00:00Z" }, members: MEMBERS } };
  state.familyError = undefined;
  state.fetched = [];
});

describe("useViewing", () => {
  it("is yourself without ?member=, without loading the family", () => {
    const viewing = viewingNow();

    expect(viewing).toMatchObject({ member: null, readOnly: false, viewed: null, currency: "EUR", ready: true, hrefFor: "/investments?a=1" });
    expect(state.fetched).toEqual([null]);
  });

  it("is yourself when ?member= is your own id, in any case", () => {
    state.search = `member=${ME_ID.toUpperCase()}`;

    expect(viewingNow()).toMatchObject({ member: null, readOnly: false });
  });

  it("is read-only for another member, with their name and currency", () => {
    state.search = `member=${ANA_ID}`;

    expect(viewingNow()).toMatchObject({
      member: ANA_ID,
      readOnly: true,
      name: "Ana",
      currency: "RON",
      ready: true,
      hrefFor: `/investments?a=1&member=${ANA_ID}`,
    });
  });

  it("is the read-only family view for ?member=all, without loading the member list", () => {
    state.search = "member=all";

    expect(viewingNow()).toMatchObject({
      member: "all",
      family: true,
      readOnly: true,
      name: "everyone",
      ready: true,
      hrefFor: "/investments?a=1&member=all",
    });
    expect(state.fetched).toEqual([null]);
  });

  it("waits for the family before it is ready, and falls back to your currency", () => {
    state.search = `member=${ANA_ID}`;
    state.family = undefined;

    expect(viewingNow()).toMatchObject({ readOnly: true, ready: false, name: "this member", currency: "EUR" });
  });

  it("stops waiting when the family can't be loaded, and stays read-only", () => {
    state.search = `member=${ANA_ID}`;
    state.family = undefined;
    state.familyError = new Error("down");

    expect(viewingNow()).toMatchObject({ readOnly: true, ready: true });
  });
});

describe("WriteOnly", () => {
  it("shows its controls for your own data", () => {
    expect(html(<WriteOnly><button>Add</button></WriteOnly>)).toContain("Add");
  });

  it("hides its controls for another member's data", () => {
    state.search = `member=${ANA_ID}`;

    expect(html(<WriteOnly><button>Add</button></WriteOnly>)).not.toContain("Add");
  });
});

describe("ViewingBar", () => {
  it("is not shown for your own data", () => {
    expect(html(<ViewingBar noun="expenses" />)).toBe("");
  });

  it("names whose data it is", () => {
    state.search = `member=${ANA_ID}`;

    expect(html(<ViewingBar noun="expenses" />)).toContain("You&#x27;re viewing Ana&#x27;s expenses");
  });
});

describe("the family view in the picker and the bar", () => {
  it("offers Family (everyone) only on a page that can show it", () => {
    expect(chips(html(<ViewingPicker />))).not.toContain("Family");
    expect(chips(html(<ViewingPicker allowFamily />))).toEqual(["Me (selected)", "Family", "Ana", "Teo"]);
  });

  it("selects Family (everyone) for ?member=all", () => {
    state.search = "member=all";

    expect(chips(html(<ViewingPicker allowFamily />))).toEqual(["Me", "Family (selected)", "Ana", "Teo"]);
  });

  it("says the whole family's expenses are being viewed", () => {
    state.search = "member=all";

    expect(html(<ViewingBar noun="expenses" />)).toContain("You&#x27;re viewing the whole family&#x27;s expenses");
  });
});

describe("ViewingPicker", () => {
  it("lists Me and the other members, not yourself", () => {
    expect(chips(html(<ViewingPicker />))).toEqual(["Me (selected)", "Ana", "Teo"]);
  });

  it("selects the viewed member", () => {
    state.search = `member=${ANA_ID}`;

    expect(chips(html(<ViewingPicker />))).toEqual(["Me", "Ana (selected)", "Teo"]);
  });

  it("shows for a kid with Family finance on", () => {
    state.account = anAccount(membership({ role: "kid", isCreator: false, memberId: ANA_ID, permissions: { ...DEFAULT_KID_PERMISSIONS, family_finance: "view" } }));

    expect(chips(html(<ViewingPicker />))).toContain("Maria");
  });

  it("is hidden for a kid with Family finance off", () => {
    state.account = anAccount(membership({ role: "kid", isCreator: false, memberId: ANA_ID, permissions: DEFAULT_KID_PERMISSIONS }));

    expect(html(<ViewingPicker />)).toBe("");
    expect(state.fetched).toEqual([null, null]);
  });

  it("is hidden without a family", () => {
    state.account = anAccount(null);

    expect(html(<ViewingPicker />)).toBe("");
  });

  it("is hidden when nobody else is in the family", () => {
    state.family = { family: { family: { id: "f", name: "x", createdAt: "" }, members: [MEMBERS[0]] } };

    expect(html(<ViewingPicker />)).toBe("");
  });

  it("is hidden while the account or family is still loading", () => {
    state.family = undefined;
    expect(html(<ViewingPicker />)).toBe("");
    state.account = undefined;
    expect(html(<ViewingPicker />)).toBe("");
  });
});

describe("viewingHref", () => {
  it("sets the member and keeps the other parameters", () => {
    expect(viewingHref("/dashboard", new URLSearchParams("view=monthly&month=2026-09"), ANA_ID)).toBe(
      `/dashboard?view=monthly&month=2026-09&member=${ANA_ID}`,
    );
  });

  it("removes the member for Me, and the bare path when nothing is left", () => {
    expect(viewingHref("/net-worth", new URLSearchParams(`member=${ANA_ID}`), "")).toBe("/net-worth");
  });

  it("drops a saved tab and its filters, which belong to one member", () => {
    expect(viewingHref("/expenses", new URLSearchParams("tab=t1&scope=year&year=2026&search=car&month=2026-09"), ANA_ID)).toBe(
      `/expenses?month=2026-09&member=${ANA_ID}`,
    );
  });
});
