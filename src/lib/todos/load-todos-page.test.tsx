// @vitest-environment happy-dom
import { ChakraProvider } from "@chakra-ui/react";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";
import { getAuthenticatedUser } from "@/lib/auth";
import { ACCOUNT_API_KEY, FAMILY_API_KEY, TODOS_API_KEY, type TodosResponse } from "@/lib/api/keys";
import { forgetLastActive } from "@/lib/family/last-active";
import { aFamily, aParent } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { loggedLines } from "@/test/log-lines";
import { callRoute, signedInAs, testUser } from "@/test/route";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/todos",
}));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(), asPageCaller: (fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));
const logged = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/log", async (importOriginal) => (await import("@/test/log-lines")).memoryLogModule(await importOriginal(), logged));

import { GET as familyRoute } from "@/app/api/family/route";
import { GET as todosRoute } from "@/app/api/todos/route";
import TodosPage from "@/app/(app)/todos/page";
import { loadPageAccount } from "@/lib/account/load-account";

let repositories: FakeRepositories;
let asked: string[];
let cleanup: (() => void) | null = null;

beforeEach(() => {
  vi.spyOn(performance, "now").mockReturnValue(1_000);
  repositories = resetFakeRepositories();
  forgetLastActive();
  logged.length = 0;
  asked = [];
  vi.stubEnv("FAMILY_ENABLED", "true");
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function seedParent() {
  signedInAs(testUser);
  repositories.family.membership = aParent();
  repositories.family.family = aFamily();
  repositories.todos.seed({ title: "Fix the gate", assigneeMemberId: aParent().memberId });
}

async function serverRender() {
  const account = await loadPageAccount();
  const page = (await TodosPage()) as ReactElement<{ fallback: Record<string, Promise<unknown>> }>;
  return { account, page, fallback: page.props.fallback };
}

async function mount({ account, page }: Awaited<ReturnType<typeof serverRender>>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const cache = new Map();
  await act(async () => {
    root.render(
      <ChakraProvider value={ledgerSystem}>
        <SWRConfig value={{ provider: () => cache, fetcher: (key: string) => { asked.push(key); return new Promise(() => undefined); } }}>
          <SWRConfig value={{ fallback: { [ACCOUNT_API_KEY]: account } }}>{page}</SWRConfig>
        </SWRConfig>
      </ChakraProvider>,
    );
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  cleanup = () => { act(() => root.unmount()); container.remove(); };
  return { container, cache };
}

describe("To-dos' first data on the server (PF7)", () => {
  it("starts the board and the family list under the keys the page asks for, and the browser asks for neither", async () => {
    seedParent();
    const render = await serverRender();

    expect(Object.keys(render.fallback).sort()).toEqual([FAMILY_API_KEY, TODOS_API_KEY].sort());
    const { container } = await mount(render);

    expect(container.textContent).toContain("Fix the gate");
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(asked).toEqual([]);
  });

  it("puts the board in SWR's cache, so an optimistic write starts from the server's cards", async () => {
    seedParent();
    const { cache } = await mount(await serverRender());

    const board = (cache.get(TODOS_API_KEY) as { data?: TodosResponse } | undefined)?.data;
    expect(board?.todos.map((todo) => todo.title)).toEqual(["Fix the gate"]);
  });

  it("answers each key exactly as its API route does", async () => {
    seedParent();
    const { fallback } = await serverRender();

    for (const [key, route] of [[TODOS_API_KEY, todosRoute], [FAMILY_API_KEY, familyRoute]] as const) {
      const response = await callRoute(route, { url: key });
      expect(response.status).toBe(200);
      expect(await fallback[key]).toEqual(response.body);
    }
  });

  it("starts nothing for a user without a family, and the page shows its own state", async () => {
    signedInAs(testUser);
    const render = await serverRender();

    expect(render.fallback).toEqual({});
    const { container } = await mount(render);
    expect(container.textContent).toContain("The to-do board belongs to a family");
    expect(asked).toEqual([]);
  });

  it("starts nothing without a session", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect((await serverRender()).fallback).toEqual({});
  });

  it("leaves the board to the browser when its load failed, and logs it without the data", async () => {
    seedParent();
    vi.spyOn(repositories.todos, "list").mockRejectedValue(new Error("connection reset"));
    const render = await serverRender();

    expect(await render.fallback[TODOS_API_KEY]).toBeUndefined();
    expect(loggedLines(logged, "server_prefetch_failed")).toEqual([
      expect.objectContaining({ level: "error", route: "/todos", api: "/api/todos" }),
    ]);
    await mount(render);
    expect(asked).toEqual([TODOS_API_KEY]);
  });
});
