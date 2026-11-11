// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import useSWR, { SWRConfig, type Cache } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAccount } from "@/hooks/use-account";
import { useFamily } from "@/hooks/use-family";
import { useMemberColors } from "@/hooks/use-member-colors";
import type { AccountData } from "@/lib/account/types";
import { ACCOUNT_API_KEY, FAMILY_API_KEY, type FamilyResponse } from "@/lib/api/keys";
import { PARENT_PERMISSIONS } from "@/lib/family/repository";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNT: AccountData = {
  email: "ana@example.com",
  signInName: "ana@example.com",
  currency: "EUR",
  features: { family: true },
  membership: { memberId: "m1", role: "parent", isCreator: true, familyName: "Smiths", permissions: PARENT_PERMISSIONS },
  mustChangePassword: false,
  avatarUrl: null,
};
const FAMILY = { family: { family: { id: "f1", name: "Smiths", createdAt: "2026-11-01T00:00:00Z" }, members: [] } } as unknown as FamilyResponse;
/** SWR's "stale" is its dedupe window; a short one lets a test cross it. */
const DEDUPING_INTERVAL = 10;

let asked: string[];
let cleanup: (() => void) | null = null;

/** What a page on the signed-in shell reads: the account, the member colours (which read the family list). */
function StablePage() {
  const { account } = useAccount();
  const colorOf = useMemberColors();
  colorOf("m1");
  return <p data-testid="page">{account?.signInName ?? "loading"}</p>;
}

/** The same keys read the way a hook with no option does: SWR's own default, as the control. */
function PlainPage() {
  /* eslint-disable local/stable-data-options -- the control: what a read without the option does */
  const { data } = useSWR<AccountData>(ACCOUNT_API_KEY);
  useSWR<FamilyResponse>(FAMILY_API_KEY);
  /* eslint-enable local/stable-data-options */
  return <p data-testid="page">{data?.signInName ?? "loading"}</p>;
}

const sleep = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });

/** Mounts `Page` under the shell's fallback (the account, and optionally the family list) and returns a way to mount another page. */
async function openApp(first: () => React.ReactNode, fallback: Record<string, unknown> = { [ACCOUNT_API_KEY]: ACCOUNT, [FAMILY_API_KEY]: FAMILY }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const cache: Cache = new Map();
  const render = (page: React.ReactNode) =>
    act(async () => {
      root.render(
        <SWRConfig value={{
          provider: () => cache,
          fallback,
          dedupingInterval: DEDUPING_INTERVAL,
          revalidateOnFocus: false,
          errorRetryCount: 0,
          fetcher: async (key: string) => {
            asked.push(key);
            return key === ACCOUNT_API_KEY ? ACCOUNT : FAMILY;
          },
        }}>
          {page}
        </SWRConfig>,
      );
    });
  await render(first());
  await sleep();
  cleanup = () => { act(() => root.unmount()); container.remove(); };
  return { open: async (page: React.ReactNode) => { await render(null); await sleep(); await render(page); await sleep(); }, cache };
}

beforeEach(() => {
  asked = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup?.();
  cleanup = null;
});

describe("stable data", () => {
  it("is asked for again by a page opening after SWR's window when a hook has no option (the control)", async () => {
    const app = await openApp(() => <PlainPage />);
    await sleep();
    asked.length = 0;

    await app.open(<PlainPage />);

    expect(asked.sort()).toEqual([ACCOUNT_API_KEY, FAMILY_API_KEY]);
  });

  it("is not asked for again by a page opening later: the account, the family list and the colours come from what is there", async () => {
    const app = await openApp(() => <StablePage />);
    await sleep();

    await app.open(<StablePage />);
    await app.open(<StablePage />);

    expect(asked).toEqual([]);
  });

  it("is fetched when there is no answer yet", async () => {
    await openApp(() => <StablePage />, {});

    expect(asked.sort()).toEqual([ACCOUNT_API_KEY, FAMILY_API_KEY]);
  });

  it("is read again when the app comes back into view", async () => {
    await openApp(() => <StablePage />);
    await sleep();

    // SWR ignores a focus within `focusThrottleInterval` (5 s) of the hook mounting.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_000);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await sleep();

    expect(asked.sort()).toEqual([ACCOUNT_API_KEY, FAMILY_API_KEY]);
  });

  it("asks for the family list only when `useFamily` is enabled", async () => {
    function Off() {
      useFamily(false);
      return null;
    }
    await openApp(() => <Off />, {});

    expect(asked).toEqual([]);
  });
});
