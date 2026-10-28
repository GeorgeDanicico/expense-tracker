import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  feedStatusLine,
  REACH_NOTE,
  SECRET_WARNING,
  SUBSCRIBE_STEPS,
  SubscribeContent,
  UNSUPPORTED_NOTE,
} from "@/components/family-calendar/subscribe-dialog";
import { ledgerSystem } from "@/components/ui/theme";
import type { CalendarFeed } from "@/lib/family-calendar/feed-repository";
import { feedWebcalUrl } from "@/lib/family-calendar/feed-link";

const noop = () => {};
const FEED: CalendarFeed = { id: "f1", createdAt: "2026-10-28T09:00:00.000Z", lastFetchedAt: "2026-10-29T08:15:00.000Z" };
const LINK = feedWebcalUrl("https://ledger.example.ts.net", `sl_cal_${"A".repeat(43)}`);

type Props = Parameters<typeof SubscribeContent>[0];
function render(props: Partial<Props> = {}) {
  const all: Props = {
    feed: null, link: null, loadError: "", confirming: null, pending: false, error: "",
    onCreate: noop, onAsk: noop, onConfirm: noop, onRetry: noop, ...props,
  };
  return renderToStaticMarkup(<ChakraProvider value={ledgerSystem}><SubscribeContent {...all} /></ChakraProvider>);
}

describe("feedStatusLine", () => {
  it("says when the link was made and last used", () => {
    expect(feedStatusLine(FEED)).toMatch(/^Link created on 28 Oct 2026, \d{2}:\d{2}\. Last used 29 Oct 2026, \d{2}:\d{2}\.$/);
  });

  it("says so when no calendar app has fetched it", () => {
    expect(feedStatusLine({ ...FEED, lastFetchedAt: null })).toMatch(/\. Not used yet\.$/);
  });
});

describe("SubscribeContent", () => {
  it("says what the feed holds, whatever the state", () => {
    for (const props of [{ feed: undefined }, { feed: null }, { feed: FEED }, { feed: FEED, link: LINK }]) {
      const html = render(props);
      expect(html).toContain("Only the events you attend");
      expect(html).toContain("read-only");
      expect(html).toContain("every 15 minutes or so");
    }
  });

  it("lists the apps that work, the apps that don't yet, and what the device must reach", () => {
    const html = render();

    for (const { app } of SUBSCRIBE_STEPS) expect(html).toContain(app);
    expect(html).toContain("Add Subscribed Calendar");
    expect(html).toContain("New Outlook, the Windows Calendar app, Outlook.com and Google Calendar aren&#x27;t supported yet");
    expect(html).toContain(UNSUPPORTED_NOTE.replaceAll("'", "&#x27;"));
    expect(html).toContain(REACH_NOTE);
  });

  it("offers to create a link when there is none, with no secret and no manage buttons", () => {
    const html = render({ feed: null });

    expect(html).toContain("Create link");
    expect(html).not.toContain('href="webcal://');
    expect(html).not.toContain("<input");
    expect(html).not.toContain(">Regenerate</button>");
    expect(html).not.toContain(">Turn off</button>");
  });

  it("shows a loading state while the link loads", () => {
    const html = render({ feed: undefined });

    expect(html).toContain("Loading your calendar link");
    expect(html).not.toContain("Create link");
  });

  it("shows a new link once: the field, Copy, Add to Calendar and the warning", () => {
    const html = render({ feed: FEED, link: LINK });

    expect(html).toContain(SECRET_WARNING.replaceAll("'", "&#x27;"));
    expect(html).toContain(`value="${LINK}"`);
    expect(html).toContain('aria-label="Copy link"');
    expect(html).toContain(`href="${LINK}"`);
    expect(html).toContain(">Add to Calendar</a>");
    expect(html).toContain(">Regenerate</button>");
    expect(html).toContain(">Turn off</button>");
    expect(html).not.toContain("Link created on");
  });

  it("shows when the link was made and last used instead of the link on a later visit", () => {
    const html = render({ feed: FEED, link: null });

    expect(html).toContain("Link created on 28 Oct 2026");
    expect(html).toContain("Last used 29 Oct 2026");
    expect(html).not.toContain('href="webcal://');
    expect(html).not.toContain("<input");
    expect(html).not.toContain("Add to Calendar</a>");
    expect(html).toContain(">Regenerate</button>");
    expect(html).toContain(">Turn off</button>");
  });

  it("asks before regenerating, saying the old link stops at once", () => {
    const html = render({ feed: FEED, confirming: "regenerate" });

    expect(html).toContain("Make a new link?");
    expect(html).toContain("stops working right away");
    expect(html).toContain("Keep it");
  });

  it("asks before turning the link off", () => {
    const html = render({ feed: FEED, confirming: "off" });

    expect(html).toContain("Turn off the link?");
    expect(html).toContain("stop updating");
  });

  it("shows a failed request, and a failed load with a retry", () => {
    expect(render({ feed: FEED, error: "Unable to turn off your calendar link. Please try again." })).toContain("Unable to turn off your calendar link.");
    const failed = render({ feed: undefined, loadError: "Your calendar link could not be loaded." });
    expect(failed).toContain("could not be loaded");
    expect(failed).toContain("Try again");
  });
});
