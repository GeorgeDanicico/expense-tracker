"use client";

import { Button, Flex, Input, Stack, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";

import { useCalendarApi } from "@/components/family-calendar/calendar-api";
import { CopyButton } from "@/components/family/create-invite-dialog";
import { useOrigin } from "@/components/settings/mcp-command";
import { AppDialog } from "@/components/ui/app-dialog";
import { DataLoading } from "@/components/ui/data-state";
import { FormActions } from "@/components/ui/form-actions";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import { formatDateTime } from "@/lib/calendar";
import type { CalendarFeed } from "@/lib/family-calendar/feed-repository";
import { feedWebcalUrl } from "@/lib/family-calendar/feed-link";

export const SECRET_WARNING = "Copy it now. Once you close this, it can't be shown again.";

/** The apps that can subscribe today, and the ones that can't until the app has a public address. */
export const SUBSCRIBE_STEPS = [
  {
    app: "Apple Calendar on an iPhone or iPad",
    steps: "Tap Add to Calendar on the phone, or open Settings → Calendar → Accounts → Add Subscribed Calendar and paste the link. iOS decides how often it refreshes, often every 15 minutes to an hour.",
  },
  {
    app: "Calendar on a Mac",
    steps: "Click Add to Calendar, or choose File → New Calendar Subscription and paste the link. Set Auto-refresh to Every 5 minutes.",
  },
  {
    app: "Classic Outlook for Windows",
    steps: "Choose Add Calendar → From Internet and paste the link. If Outlook won't take webcal://, start it with http:// or https:// instead, as the app's own address does.",
  },
] as const;

export const UNSUPPORTED_NOTE =
  "New Outlook, the Windows Calendar app, Outlook.com and Google Calendar aren't supported yet: they fetch the link from Microsoft's or Google's servers, which can't reach the app. They'll work once the app has a public address.";

export const REACH_NOTE = "The phone or computer has to reach the app itself, for example over Tailscale.";

/** "Link created on 28 Oct 2026, 09:00. Last used 29 Oct 2026, 08:15." (or "Not used yet."). */
export function feedStatusLine(feed: CalendarFeed) {
  const created = formatDateTime(feed.createdAt, "en-GB");
  const used = feed.lastFetchedAt ? `Last used ${formatDateTime(feed.lastFetchedAt, "en-GB")}.` : "Not used yet.";
  return `Link created on ${created}. ${used}`;
}

export type ManageAction = "regenerate" | "off";

const CONFIRMATIONS: Record<ManageAction, { title: string; body: string; confirm: string }> = {
  regenerate: {
    title: "Make a new link?",
    body: "The current link stops working right away. Calendars using it need the new one.",
    confirm: "Regenerate",
  },
  off: {
    title: "Turn off the link?",
    body: "Calendars using it stop updating. You can make a new link later.",
    confirm: "Turn off",
  },
};

/** What the dialog shows; `SubscribeDialog` holds the state and the requests. */
export function SubscribeContent({
  feed,
  link,
  loadError,
  confirming,
  pending,
  error,
  onCreate,
  onAsk,
  onConfirm,
  onRetry,
}: {
  /** The live link; `undefined` while it loads. */
  feed: CalendarFeed | null | undefined;
  /** The `webcal://` link, only while its secret is on screen (just made). */
  link: string | null;
  loadError: string;
  confirming: ManageAction | null;
  pending: boolean;
  error: string;
  onCreate: () => void;
  /** Asks to regenerate or turn off, or `null` to keep the link. */
  onAsk: (action: ManageAction | null) => void;
  onConfirm: (action: ManageAction) => void;
  onRetry: () => void;
}) {
  return (
    <Stack gap="5">
      <Stack gap="2">
        <Text textStyle="bodySm">
          Show the events you go to in Apple Calendar, Outlook and other calendar apps. It&apos;s read-only there, so
          changes are made here, and it updates every 15 minutes or so.
        </Text>
        <Text textStyle="bodySm">
          Only the events you attend are included, not the whole family&apos;s. Anyone with the link sees them, so keep it private.
        </Text>
      </Stack>

      {loadError ? (
        <InlineAlert status="error" action={<Button size="xs" variant="ghost" onClick={onRetry}>Try again</Button>}>
          {loadError}
        </InlineAlert>
      ) : feed === undefined ? (
        <DataLoading layout="section" label="Loading your calendar link…" />
      ) : (
        <Stack gap="4">
          {error ? <InlineAlert status="error">{error}</InlineAlert> : null}
          {feed === null ? (
            <Flex align="center" justify="space-between" gap="3" wrap="wrap">
              <Text textStyle="bodySm" color="fg.muted">You don&apos;t have a calendar link yet.</Text>
              <Button size="sm" variant="solid" colorPalette="brand" loading={pending} onClick={onCreate}>Create link</Button>
            </Flex>
          ) : (
            <Stack gap="3">
              {link ? (
                <>
                  <InlineAlert status="warning">{SECRET_WARNING}</InlineAlert>
                  <FormField label="Your calendar link">
                    <Flex align="center" gap="2" width="full">
                      <Input
                        value={link}
                        readOnly
                        fontFamily="mono"
                        autoComplete="off"
                        spellCheck={false}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <CopyButton text={link} label="Copy link" />
                    </Flex>
                  </FormField>
                  <Flex>
                    <Button asChild size="sm" variant="solid" colorPalette="brand">
                      <a href={link}>Add to Calendar</a>
                    </Button>
                  </Flex>
                </>
              ) : (
                <Stack gap="0.5">
                  <Text textStyle="bodySm">{feedStatusLine(feed)}</Text>
                  <Text textStyle="caption">The link is only shown when it&apos;s made. Regenerate it to get a new one.</Text>
                </Stack>
              )}
              {confirming ? (
                <InlineAlert status="warning" title={CONFIRMATIONS[confirming].title}>
                  <Stack gap="2.5" align="flex-start">
                    <Text as="span">{CONFIRMATIONS[confirming].body}</Text>
                    <Flex gap="2">
                      <Button size="xs" variant="solid" colorPalette="danger" loading={pending} onClick={() => onConfirm(confirming)}>
                        {CONFIRMATIONS[confirming].confirm}
                      </Button>
                      <Button size="xs" variant="outline" disabled={pending} onClick={() => onAsk(null)}>Keep it</Button>
                    </Flex>
                  </Stack>
                </InlineAlert>
              ) : (
                <Flex gap="2" wrap="wrap">
                  <Button size="xs" variant="outline" onClick={() => onAsk("regenerate")}>Regenerate</Button>
                  <Button size="xs" variant="outline" onClick={() => onAsk("off")}>Turn off</Button>
                </Flex>
              )}
            </Stack>
          )}
        </Stack>
      )}

      <Stack gap="3">
        <Text textStyle="label">How to add it</Text>
        <Stack as="ul" gap="2.5" m="0" p="0" listStyleType="none">
          {SUBSCRIBE_STEPS.map(({ app, steps }) => (
            <Stack as="li" key={app} gap="0.5">
              <Text textStyle="bodySm" fontWeight="medium">{app}</Text>
              <Text textStyle="caption">{steps}</Text>
            </Stack>
          ))}
        </Stack>
        <Text textStyle="caption">{REACH_NOTE}</Text>
        <InlineAlert status="neutral">{UNSUPPORTED_NOTE}</InlineAlert>
      </Stack>
    </Stack>
  );
}

/**
 * "Your events in other calendar apps": makes, regenerates and turns off the caller's feed link. A
 * new secret lives only in this component's state, so closing the dialog drops it for good; reopening
 * it shows when the link was made and last used instead. Mount it only while open.
 */
export function SubscribeDialog({ onClose }: { onClose: () => void }) {
  const api = useCalendarApi();
  const origin = useOrigin();
  const form = useApiForm();
  const [feed, setFeed] = useState<CalendarFeed | null | undefined>(undefined);
  const [secret, setSecret] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState<ManageAction | null>(null);

  useEffect(() => {
    let current = true;
    api.feedLink().then(
      (loaded) => { if (current) setFeed(loaded); },
      () => { if (current) setLoadError("Your calendar link could not be loaded."); },
    );
    return () => { current = false; };
  }, [api, attempt]);

  function retry() {
    setLoadError("");
    setFeed(undefined);
    setAttempt((count) => count + 1);
  }

  function create() {
    void form.submit(async () => {
      const created = await api.createFeedLink();
      setFeed(created.feed);
      setSecret(created.token);
      setConfirming(null);
    }, { fallback: "Unable to create your calendar link. Please try again." });
  }

  function confirm(action: ManageAction) {
    if (action === "regenerate") return create();
    void form.submit(async () => {
      await api.deleteFeedLink();
      setFeed(null);
      setSecret(null);
      setConfirming(null);
    }, { fallback: "Unable to turn off your calendar link. Please try again." });
  }

  return (
    <AppDialog
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      size="md"
      fullHeightOnPhone
      title="Your events in other calendar apps"
      footer={<FormActions submitLabel="Done" onSubmit={onClose} />}
    >
      <SubscribeContent
        feed={feed}
        link={secret ? feedWebcalUrl(origin, secret) : null}
        loadError={loadError}
        confirming={confirming}
        pending={form.pending}
        error={form.error}
        onCreate={create}
        onAsk={(action) => { form.reset(); setConfirming(action); }}
        onConfirm={confirm}
        onRetry={retry}
      />
    </AppDialog>
  );
}
