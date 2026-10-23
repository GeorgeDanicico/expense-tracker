"use client";

import { Box, Flex, Text } from "@chakra-ui/react";
import { useSyncExternalStore } from "react";

import { CopyButton } from "@/components/family/create-invite-dialog";
import { BRAND } from "@/lib/brand";

/** The name Claude Code lists this server under: the brand, in lower case (`ifam`). */
export const MCP_SERVER_NAME = BRAND.name.toLowerCase();

/**
 * The command that adds this app to Claude Code. With a personal token it also sends the token as a
 * bearer header; without one, Claude Code connects through the sign-in page (OAuth).
 */
export function claudeMcpAddCommand(origin: string, secret?: string) {
  const command = `claude mcp add --transport http ${MCP_SERVER_NAME} ${origin}/api/mcp`;
  return secret ? `${command} --header "Authorization: Bearer ${secret}"` : command;
}

const noSubscription = () => () => {};

/** The page's origin (`https://ledger.example`), or an empty string while rendering on the server. */
export function useOrigin() {
  return useSyncExternalStore(
    noSubscription,
    () => window.location.origin,
    () => "",
  );
}

/** A shell command in a monospace block, with a Copy button. */
export function CommandBlock({
  command,
  copyLabel,
  onCopied,
}: {
  command: string;
  copyLabel: string;
  onCopied?: () => void;
}) {
  return (
    <Flex align="flex-start" gap="2" p="3" borderWidth="1px" borderColor="border" borderRadius="md" bg="bg.subtle">
      <Box flex="1" minW="0">
        <Text as="code" display="block" fontFamily="mono" textStyle="bodySm" wordBreak="break-all" textAlign="start">
          {command}
        </Text>
      </Box>
      <CopyButton text={command} label={copyLabel} onCopied={onCopied} />
    </Flex>
  );
}
