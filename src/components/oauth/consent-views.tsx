"use client";

import { Box, Button, Center, Flex, Heading, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Brand } from "@/components/layout/brand";
import { Card } from "@/components/ui/card";
import { DataError, DataLoading } from "@/components/ui/data-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { OAuthAuthorizationResponse } from "@/lib/api/keys";
import { BRAND } from "@/lib/brand";
import { MCP_REFUSALS } from "@/lib/mcp/refusals";

export type ConsentDetails = Extract<OAuthAuthorizationResponse, { kind: "consent" }>;
export type RefusedDetails = Extract<OAuthAuthorizationResponse, { kind: "refused" }>;
export type Decision = "approve" | "deny";

/** What a connected app may do: everything the user can, through the MCP tools. */
export const CONSENT_CAPABILITIES =
  "Read and change your expenses, tabs, net worth and investments, as you, within your permissions.";

/** Where a refusal can be fixed from, when the user can fix it themselves. */
const REFUSAL_LINKS: Partial<Record<RefusedDetails["reason"], { href: string; label: string }>> = {
  mcp_off: { href: "/settings/mcp", label: "Open AI assistant settings" },
  email_required: { href: "/settings", label: "Open Settings" },
};

/** The host the app sends the browser back to (`localhost:4567` for Claude Code), or the raw value if it isn't a URL. */
export function redirectHost(redirectUri: string) {
  try {
    return new URL(redirectUri).host || redirectUri;
  } catch {
    return redirectUri;
  }
}

/** A refusal's message, and a link to where the user can fix it (none when only a parent can). */
export function refusalHelp(reason: RefusedDetails["reason"]) {
  return { message: MCP_REFUSALS[reason], link: REFUSAL_LINKS[reason] ?? null };
}

/** The page around every state: outside the app shell, like the sign-in screen. */
export function ConsentFrame({ children }: { children: ReactNode }) {
  return (
    <Center minH="100dvh" px={{ base: "4", md: "6" }} py={{ base: "6", md: "10" }} bg="bg.canvas">
      <Card width="full" maxW="420px">
        <Card.Body p={{ base: "5", md: "6" }}>
          <Stack gap="5">
            <Brand />
            {children}
          </Stack>
        </Card.Body>
      </Card>
    </Center>
  );
}

export function ConsentLoading({ label }: { label: string }) {
  return (
    <ConsentFrame>
      <DataLoading layout="section" label={label} />
    </ConsentFrame>
  );
}

export function ConsentLoadError({ retry }: { retry: () => void }) {
  return (
    <ConsentFrame>
      <DataError message="The request could not be loaded. Check your connection and try again." retry={retry} />
    </ConsentFrame>
  );
}

/** A request that doesn't exist, has expired, or belongs to another account. */
export function ConsentExpired() {
  return (
    <ConsentFrame>
      <Stack gap="1">
        <Heading as="h1" size="xl">
          This request has expired
        </Heading>
        <Text textStyle="sm" color="fg.muted">
          It may have been answered already, or it belongs to another account. Start connecting again
          from the app.
        </Text>
      </Stack>
      <Button asChild variant="outline" size="md" width="full">
        <Link href="/dashboard">Go to {BRAND.name}</Link>
      </Button>
    </ConsentFrame>
  );
}

function SignedInAs({ email }: { email: string }) {
  return (
    <Text textStyle="caption">
      Signed in as{" "}
      <Text as="span" color="fg" fontWeight="medium">
        {email}
      </Text>
    </Text>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack gap="0.5" minW="0">
      <Text textStyle="label" color="fg.muted">
        {label}
      </Text>
      {children}
    </Stack>
  );
}

type DecisionProps = {
  /** The decision in flight, or null. Stays set while the browser leaves for the app. */
  pending: Decision | null;
  error: string;
};

/** "{app} wants to use your account": who is asking, where it sends you back to, and what it can do. */
export function ConsentRequestCard({
  details,
  pending,
  error,
  onDecide,
}: DecisionProps & { details: ConsentDetails; onDecide: (decision: Decision) => void }) {
  const { app, email, redirectUri } = details;
  return (
    <ConsentFrame>
      <Stack gap="1.5">
        <Heading as="h1" size="xl">
          {app.name} wants to use your {BRAND.name} account
        </Heading>
        <SignedInAs email={email} />
      </Stack>

      <Box borderWidth="1px" borderColor="border" borderRadius="control" bg="bg.subtle" px="3.5" py="3">
        <Detail label="It will send you back to">
          <Text fontFamily="mono" fontSize="lg" fontWeight="semibold" lineHeight="1.5rem" wordBreak="break-all">
            {redirectHost(redirectUri)}
          </Text>
        </Detail>
      </Box>

      <Stack gap="3">
        <Detail label="App address">
          <Text textStyle="sm" color={app.uri ? "fg" : "fg.muted"} wordBreak="break-all">
            {app.uri ?? "Not given"}
          </Text>
        </Detail>
        <Detail label="What it can do">
          <Text textStyle="sm">{CONSENT_CAPABILITIES}</Text>
        </Detail>
      </Stack>

      <InlineAlert status="warning" title="Only allow apps you started connecting yourself.">
        Any app can use any name. The address it sends you back to is what tells a real one apart.
      </InlineAlert>

      {error ? <InlineAlert status="error">{error}</InlineAlert> : null}

      <Flex gap="3">
        <Button
          flex="1"
          variant="outline"
          size="md"
          loading={pending === "deny"}
          disabled={pending !== null}
          onClick={() => onDecide("deny")}
        >
          Deny
        </Button>
        <Button
          flex="1"
          variant="solid"
          colorPalette="brand"
          size="md"
          loading={pending === "approve"}
          disabled={pending !== null}
          onClick={() => onDecide("approve")}
        >
          Allow
        </Button>
      </Flex>
    </ConsentFrame>
  );
}

/** Why no app can use the account right now, and the one way out: back to the app, denied. */
export function ConsentRefusedCard({
  details,
  pending,
  error,
  onBack,
}: DecisionProps & { details: RefusedDetails; onBack: () => void }) {
  const { message, link } = refusalHelp(details.reason);
  return (
    <ConsentFrame>
      <Stack gap="1.5">
        <Heading as="h1" size="xl">
          {details.app ? `${details.app.name} can't use your account` : "AI assistants can't use your account"}
        </Heading>
        <SignedInAs email={details.email} />
      </Stack>

      <InlineAlert
        status="warning"
        action={
          link ? (
            <Button asChild size="xs" variant="outline" alignSelf="center" flexShrink="0">
              <Link href={link.href}>{link.label}</Link>
            </Button>
          ) : undefined
        }
      >
        {message}
      </InlineAlert>

      <Text textStyle="sm" color="fg.muted">
        Once that&apos;s sorted, start connecting again from the app.
      </Text>

      {error ? <InlineAlert status="error">{error}</InlineAlert> : null}

      <Button variant="solid" colorPalette="brand" size="md" width="full" loading={pending !== null} onClick={onBack}>
        Back to the app
      </Button>
    </ConsentFrame>
  );
}
