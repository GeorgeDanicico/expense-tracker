"use client";

import { Stack, Text } from "@chakra-ui/react";

import { CopyButton } from "@/components/family/create-invite-dialog";
import { InlineAlert } from "@/components/ui/inline-alert";

/** What to tell a kid after a parent sets a temporary password: shown once, with the password to copy. */
export function KidSignInDetails({
  name,
  username,
  password,
}: {
  name: string;
  /** Omitted after a reset, where the kid already knows their username. */
  username?: string;
  password: string;
}) {
  return (
    <Stack gap="4">
      <Text textStyle="body" data-testid="kid-sign-in-message">
        {username ? (
          <>
            {name} can sign in with the username <strong>{username}</strong> and this password.
          </>
        ) : (
          <>{name} can sign in with this password.</>
        )}{" "}
        They&apos;ll choose a new one the first time.
      </Text>
      <Stack direction="row" align="center" justify="space-between" gap="3">
        <Text as="span" fontFamily="mono" fontSize="xl" fontWeight="semibold" wordBreak="break-all" data-testid="kid-password">
          {password}
        </Text>
        <CopyButton text={password} label="Copy temporary password" />
      </Stack>
      <InlineAlert status="warning">This password is shown only once. Share it only with {name}.</InlineAlert>
    </Stack>
  );
}
