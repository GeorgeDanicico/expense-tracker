"use client";

import { useEffect, useState } from "react";

import { linkedCard, withoutCardHref } from "@/lib/todos/filters";

/**
 * Which card's dialog is open, with `?card=<id>` (where a to-do notification leads) opening it.
 *
 * Once `todos` has loaded, each new `cardParam` opens that card, whatever the filters show; a
 * refetch doesn't reopen a dialog closed by hand. An id the board doesn't have (a deleted card, an
 * old done one not loaded) opens nothing and is dropped from the URL, and `close` drops the param
 * too, so a reload or a later notification for the same card starts afresh. The URL changes with
 * `history.replaceState`, which Next syncs into `useSearchParams` without a navigation.
 */
export function useLinkedCard(todos: readonly { id: string }[] | undefined, cardParam: string | null, pathname: string) {
  const [openId, setOpenId] = useState<string | null>(null);
  // The `?card=` value already acted on.
  const [handledCard, setHandledCard] = useState<string | null>(null);

  if (cardParam !== handledCard && todos) {
    // Adjusting state while rendering, once per `?card=` value, so the dialog opens straight away.
    setHandledCard(cardParam);
    const linked = linkedCard(cardParam, todos);
    if (linked) setOpenId(linked.id);
  }

  const stale = Boolean(cardParam && todos && !linkedCard(cardParam, todos));
  useEffect(() => {
    if (stale) window.history.replaceState(null, "", withoutCardHref(pathname, window.location.search));
  }, [stale, pathname]);

  const close = () => {
    setOpenId(null);
    if (cardParam !== null) window.history.replaceState(null, "", withoutCardHref(pathname, window.location.search));
  };

  return { openId, open: setOpenId, close };
}
