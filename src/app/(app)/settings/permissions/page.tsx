"use client";

import { Stack, Text } from "@chakra-ui/react";

import { PermissionList } from "@/components/family/permission-list";
import { Card } from "@/components/ui/card";
import { DataError, DataLoading } from "@/components/ui/data-state";
import { useAccount } from "@/hooks/use-account";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function MyPermissionsPage() {
  useDocumentTitle("My permissions");
  const { account, error, mutate } = useAccount();

  if (error && !account) return <DataError retry={() => void mutate()} />;
  if (!account) return <DataLoading label="Loading your permissions…" />;

  const membership = account.membership;

  return (
    <Card>
      <Card.Header
        title="My permissions"
        description="What you can use in the app."
      />
      <Card.Body>
        {!membership ? (
          <Text textStyle="bodySm">You&apos;re not in a family yet.</Text>
        ) : membership.role === "parent" ? (
          <Text textStyle="bodySm">Parents can use every part of the app.</Text>
        ) : (
          <Stack gap="4">
            <PermissionList permissions={membership.permissions} />
            <Text textStyle="caption">
              Your parents can see: your expenses, investments and net worth,
              and when you last used the app.
            </Text>
          </Stack>
        )}
      </Card.Body>
    </Card>
  );
}
