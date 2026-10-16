"use client";

import { Button, Center, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

import { Brand } from "@/components/layout/brand";
import { JoinFamilyForm } from "@/components/family/join-family-form";
import { Card } from "@/components/ui/card";
import { DataError, DataLoading } from "@/components/ui/data-state";
import { useAccount } from "@/hooks/use-account";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ApiError } from "@/lib/api/client";

/**
 * The invite link. A signed-out visitor is sent to sign in and brought back here; a signed-in one
 * sees the same confirmation as "Join with a code", with the code filled in.
 */
export default function JoinLinkPage() {
  useDocumentTitle("Join a family");
  const router = useRouter();
  const { code } = useParams<{ code: string }>();
  const { account, error, isLoading, mutate } = useAccount();
  const signedOut = error instanceof ApiError && error.status === 401;
  const familyOff = account !== undefined && !account.features.family;

  useEffect(() => {
    if (signedOut) router.replace(`/login?next=${encodeURIComponent(`/join/${code}`)}`);
    else if (familyOff) router.replace("/dashboard");
  }, [signedOut, familyOff, code, router]);

  if ((isLoading && !account) || signedOut || familyOff) {
    return <DataLoading layout="screen" label="Checking your invite…" />;
  }
  if (!account) return <DataError retry={() => void mutate()} />;

  return (
    <Center minH="100dvh" px={{ base: "4", md: "6" }} py={{ base: "6", md: "10" }} bg="bg.canvas">
      <Stack width="full" maxW="400px" gap="5">
        <Brand />
        {account.membership ? (
          <Card>
            <Card.Header title="You're already in a family" description={`You're a member of ${account.membership.familyName}.`} />
            <Card.Footer justifyContent="flex-end" borderTopWidth="1px" pt="3">
              <Button asChild variant="solid" colorPalette="brand">
                <Link href="/settings/family">Go to your family</Link>
              </Button>
            </Card.Footer>
          </Card>
        ) : (
          <>
            <JoinFamilyForm initialCode={code} onJoined={() => router.replace("/settings/family")} />
            <Text textStyle="xs" color="fg.muted" textAlign="center">
              Signed in as {account.email}.
            </Text>
          </>
        )}
      </Stack>
    </Center>
  );
}
