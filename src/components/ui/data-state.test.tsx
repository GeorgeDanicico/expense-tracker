// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
import useSWR from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DataError, DataLoading } from "@/components/ui/data-state";
import { SLOW_MESSAGE } from "@/components/ui/slow-notice";
import { clearSlow, markSlow } from "@/lib/api/slow-keys";
import { Provider } from "@/components/ui/provider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted = new Set<() => void>();

/** The app's real SWR config (`Provider`) around a screen, with a cache of its own. */
async function mount(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <Provider>
        <SWRConfig value={{ provider: () => new Map() }}>{element}</SWRConfig>
      </Provider>,
    );
  });
  mounted.add(() => { act(() => root.unmount()); container.remove(); });
  return container;
}

/** A screen that loads one key with `fetcher` and shows what the app's screens show. */
function Screen({ fetcher, keyName = "/api/thing" }: { fetcher: () => Promise<string>; keyName?: string }) {
  const { data, error, isLoading, mutate } = useSWR<string>(keyName, fetcher);
  if (error && !data) return <DataError retry={() => void mutate()} />;
  if (isLoading && !data) return <DataLoading label="Loading the thing…" slowKey={keyName} />;
  return <p>{data}</p>;
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const close of mounted) close();
  mounted.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("DataLoading", () => {
  it("says it is taking longer than usual after 8 s, with a Retry that loads again", async () => {
    const fetcher = vi.fn<() => Promise<string>>().mockReturnValue(new Promise(() => undefined));
    const page = await mount(<Screen fetcher={fetcher} />);

    await advance(7_999);
    expect(page.textContent).not.toContain(SLOW_MESSAGE);
    await advance(1);
    expect(page.textContent).toContain(SLOW_MESSAGE);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const retry = [...page.querySelectorAll("button")].find((button) => button.textContent?.includes("Retry"));
    expect(retry).toBeDefined();
    fetcher.mockResolvedValue("loaded");
    await act(async () => { retry!.click(); });
    await advance(0);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(page.textContent).toContain("loaded");
    expect(page.textContent).not.toContain(SLOW_MESSAGE);
  });

  it("goes back to the plain skeleton once the data arrives", async () => {
    let resolve: (value: string) => void = () => undefined;
    const page = await mount(<Screen fetcher={() => new Promise<string>((done) => { resolve = done; })} />);
    await advance(8_000);
    expect(page.textContent).toContain(SLOW_MESSAGE);

    await act(async () => resolve("late but here"));
    await advance(0);

    expect(page.textContent).toContain("late but here");
    expect(page.textContent).not.toContain(SLOW_MESSAGE);
  });

  it("stays quiet for a fast load", async () => {
    const page = await mount(<Screen fetcher={() => Promise.resolve("quick")} />);
    await advance(20_000);
    expect(page.textContent).toContain("quick");
    expect(page.textContent).not.toContain(SLOW_MESSAGE);
  });

  it("ignores a load that turned slow before it was on screen", async () => {
    markSlow("/api/left-behind");
    const page = await mount(<DataLoading label="Loading…" />);
    expect(page.textContent).not.toContain(SLOW_MESSAGE);
    clearSlow("/api/left-behind");
  });

  it("without a key of its own, says so for any slow load and retries it", async () => {
    const fetcher = vi.fn<() => Promise<string>>().mockReturnValue(new Promise(() => undefined));
    function Waiting() {
      const { data } = useSWR<string>("/api/other", fetcher);
      return data ? <p>{data}</p> : <DataLoading label="Loading…" />;
    }
    const page = await mount(<Waiting />);
    await advance(8_000);

    expect(page.textContent).toContain(SLOW_MESSAGE);
    fetcher.mockResolvedValue("here");
    await act(async () => { [...page.querySelectorAll("button")].find((button) => button.textContent?.includes("Retry"))!.click(); });
    await advance(0);
    expect(page.textContent).toContain("here");
  });
});

describe("what a failing read shows", () => {
  it("ends a hanging request in its error at 15 s, and doesn't retry a timeout", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { apiFetcher } = await import("@/lib/api/client");
    const page = await mount(<Screen fetcher={() => apiFetcher("/api/thing")} />);

    await advance(14_999);
    expect(page.textContent).toContain(SLOW_MESSAGE);
    expect(page.textContent).not.toContain("Unable to load data");
    await advance(1);
    expect(page.textContent).toContain("Unable to load data");

    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows a server error with its Retry within 15 s, after two quick retries", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "Something went wrong." }), { status: 500, headers: { "Content-Type": "application/json" } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { apiFetcher } = await import("@/lib/api/client");
    const page = await mount(<Screen fetcher={() => apiFetcher("/api/failing")} keyName="/api/failing" />);

    // The error is already there from the first try, while the retries go on.
    expect(page.textContent).toContain("Unable to load data");
    await advance(15_000);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(page.textContent).toContain("Unable to load data");
  });

  it("says the device is offline instead of the screen's own wording", async () => {
    vi.stubGlobal("navigator", { ...navigator, onLine: false });
    const container = await mount(<DataError message="Your reminders could not be loaded." retry={() => undefined} />);
    expect(container.textContent).toContain("You're offline");
    expect(container.textContent).not.toContain("Your reminders could not be loaded.");
  });

  it("keeps the screen's wording while online", async () => {
    const container = await mount(<DataError message="Your reminders could not be loaded." retry={() => undefined} />);
    expect(container.textContent).toContain("Your reminders could not be loaded.");
  });

  it("shows the server's reason for a 409 refusal instead of the screen's wording (B11)", async () => {
    const { ApiError } = await import("@/lib/api/client");
    const refusal = new ApiError("There are more than 500 net-worth items, more than the app can show.", 409);
    const container = await mount(<DataError message="Your net worth could not be loaded." error={refusal} retry={() => undefined} />);
    expect(container.textContent).toContain("more than 500 net-worth items");
    expect(container.textContent).not.toContain("Your net worth could not be loaded.");
  });

  it("keeps the screen's wording for any other failed request", async () => {
    const { ApiError } = await import("@/lib/api/client");
    const container = await mount(<DataError message="Your net worth could not be loaded." error={new ApiError("Unable to load net worth. (ref abc)", 500)} retry={() => undefined} />);
    expect(container.textContent).toContain("Your net worth could not be loaded.");
  });

  it("sends a 401 from any read to sign in", async () => {
    const replace = vi.fn();
    vi.stubGlobal("window", Object.assign(window, { location: { pathname: "/reminders", search: "", replace } }));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { apiFetcher } = await import("@/lib/api/client");
    await mount(<Screen fetcher={() => apiFetcher("/api/reminders")} keyName="/api/reminders" />);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/login?next=%2Freminders");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
