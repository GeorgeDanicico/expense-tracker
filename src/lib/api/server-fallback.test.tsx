// @vitest-environment happy-dom
import { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig, useSWRConfig, type Cache } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServerFallback, useServerFirstSWR } from "@/lib/api/server-fallback";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "/api/things";
type Things = { things: string[] };
const SERVER: Things = { things: ["from the server"] };

let asked: string[];
let clock: ReturnType<typeof vi.spyOn>;
let cleanup: (() => void) | null = null;

/** A block reading `KEY`; it shows what it has and lets the test reach SWR's global `mutate`. */
function Reader({ id }: { id: string }) {
  const { data } = useServerFirstSWR<Things>(KEY);
  return <p data-testid={id}>{data?.things.join(", ") ?? "loading"}</p>;
}

/** What the test reaches inside the page: SWR's `mutate` for its cache, and a switch for a second reader. */
const handles: { mutate?: ReturnType<typeof useSWRConfig>["mutate"]; showSecond?: (show: boolean) => void } = {};

/** One reader at once; `handles.showSecond(true)` mounts a second one later, as a block that hydrates after the first. */
function Page() {
  const [second, setSecond] = useState(false);
  const { mutate } = useSWRConfig();
  useEffect(() => {
    handles.mutate = mutate;
    handles.showSecond = setSecond;
  }, [mutate]);
  return (
    <>
      <Reader id="first" />
      {second ? <Reader id="second" /> : null}
    </>
  );
}

async function settle() {
  // SWR revalidates a mounted key with data on the next animation frame: give it time to.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
}

async function mount({ fallback = { [KEY]: Promise.resolve(SERVER) } as Record<string, unknown>, cache = new Map() as Cache } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <SWRConfig value={{ provider: () => cache, fetcher: async (key: string) => { asked.push(key); return { things: ["from the browser"] }; } }}>
        <ServerFallback fallback={fallback}>
          <Page />
        </ServerFallback>
      </SWRConfig>,
    );
  });
  await settle();
  cleanup = () => { act(() => root.unmount()); container.remove(); };
  return { text: (id: string) => container.querySelector(`[data-testid="${id}"]`)?.textContent, cache };
}

beforeEach(() => {
  asked = [];
  clock = vi.spyOn(performance, "now").mockReturnValue(1_000);
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.restoreAllMocks();
});

describe("useServerFirstSWR", () => {
  it("shows the server's copy without asking for it again", async () => {
    const page = await mount();

    expect(page.text("first")).toBe("from the server");
    expect(asked).toEqual([]);
  });

  it("writes the server's copy into SWR's cache, so a write starts from it", async () => {
    const page = await mount();

    expect(page.cache.get(KEY)?.data).toEqual(SERVER);
    await act(async () => { await handles.mutate?.<Things>(KEY, (current) => ({ things: [...(current?.things ?? []), "added"] }), { revalidate: false }); });
    expect(page.text("first")).toBe("from the server, added");
  });

  it("doesn't ask either when a second reader mounts after the first wrote the copy in", async () => {
    const page = await mount();
    clock.mockReturnValue(5_000);

    await act(async () => handles.showSecond?.(true));
    await settle();

    expect(page.text("second")).toBe("from the server");
    expect(asked).toEqual([]);
  });

  it("asks again for a reader that mounts once the copy is older than SWR's dedupe window (15 s)", async () => {
    const page = await mount();
    clock.mockReturnValue(17_000);

    await act(async () => handles.showSecond?.(true));
    await settle();

    expect(asked).toEqual([KEY]);
    expect(page.text("second")).toBe("from the browser");
  });

  it("asks as plain useSWR does for a key the server didn't send (a failed load resolves to nothing)", async () => {
    const page = await mount({ fallback: { [KEY]: Promise.resolve(undefined) } });

    expect(asked).toEqual([KEY]);
    expect(page.text("first")).toBe("from the browser");
  });

  it("prefers an answer SWR already has, and revalidates it on mount as usual", async () => {
    const cache = new Map() as Cache;
    cache.set(KEY, { data: { things: ["fetched before"] } });
    const page = await mount({ cache });

    expect(asked).toEqual([KEY]);
    expect(page.text("first")).toBe("from the browser");
  });
});
