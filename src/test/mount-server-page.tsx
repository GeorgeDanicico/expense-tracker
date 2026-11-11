import { ChakraProvider } from "@chakra-ui/react";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";

import { ledgerSystem } from "@/components/ui/theme";
import { loadPageAccount } from "@/lib/account/load-account";
import { ACCOUNT_API_KEY } from "@/lib/api/keys";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type ServerRender = { account: Awaited<ReturnType<typeof loadPageAccount>>; page: ReactElement<{ fallback: Record<string, Promise<unknown>> }>; fallback: Record<string, Promise<unknown>> };

/** What a page's server render produces: the layout's account, and the page (a `ServerFallback` holding the unawaited loads). */
export async function serverRender(Page: (props: never) => Promise<ReactElement>, props: object = {}): Promise<ServerRender> {
  const account = await loadPageAccount();
  const page = (await (Page as (props: object) => Promise<ReactElement>)(props)) as ServerRender["page"];
  return { account, page, fallback: page.props.fallback };
}

/**
 * The page in the browser as the server sent it: the account in the layout's fallback, the page under
 * it, and a fetcher that records every key it is asked for in `asked` (and never answers). Returns
 * `unmount` too; call it from `afterEach`.
 */
export async function mountServerPage({ account, page }: ServerRender, asked: string[]) {
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
  // SWR revalidates a mounted key with data on the next animation frame: give it time to.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  return { container, cache, unmount: () => { act(() => root.unmount()); container.remove(); } };
}
