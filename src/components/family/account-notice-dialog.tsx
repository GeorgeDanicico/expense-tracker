"use client";

import { Button, Text } from "@chakra-ui/react";
import { useFamilyWrites } from "@/components/family/use-family-writes";
import { AppDialog } from "@/components/ui/app-dialog";
import { StreamedSection } from "@/components/ui/streamed-section";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import type { AccountNotice } from "@/lib/account/notice-repository";
import { ACCOUNT_NOTICES_API_KEY, type NoticesResponse } from "@/lib/api/keys";
import { useServerFirstSWR } from "@/lib/api/server-fallback";

/** What a notice says. The family's own data is gone from the user's view, their personal data is not. */
export function noticeMessage(notice: Pick<AccountNotice, "kind" | "familyName">): string {
  return notice.kind === "family_deleted"
    ? `The family ${notice.familyName} was deleted. Your own expenses, investments and net worth are still here.`
    : `You were removed from the family ${notice.familyName}. Your own data is still here.`;
}

/** The dialog title for a notice. */
export function noticeTitle(notice: Pick<AccountNotice, "kind">): string {
  return notice.kind === "family_deleted" ? "Your family was deleted" : "You were removed from the family";
}

/** The dialog for one notice, with OK (and closing it) calling `onDismiss`. */
export function NoticeDialog({
  notice,
  onDismiss,
  pending = false,
  error = "",
}: {
  notice: Pick<AccountNotice, "kind" | "familyName">;
  onDismiss: () => void;
  pending?: boolean;
  error?: string;
}) {
  return (
    <AppDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onDismiss();
      }}
      size="sm"
      placement="center"
      role="alertdialog"
      title={noticeTitle(notice)}
      footer={
        <Button variant="solid" colorPalette="brand" loading={pending} onClick={onDismiss}>
          OK
        </Button>
      }
    >
      <Text>{noticeMessage(notice)}</Text>
      {error ? <InlineAlert status="error">{error}</InlineAlert> : null}
    </AppDialog>
  );
}

/**
 * Shows the oldest unseen notice, in a boundary of its own. OK marks it as seen and moves on to the next one. Mount it only
 * while the family feature is on (the notices route answers 404 otherwise) and inside a boundary: the
 * `(app)` layout starts the notices on the server and they stream in (PF8).
 */
export function AccountNoticeDialog() {
  return (
    <StreamedSection fallback={null}>
      <OldestNotice />
    </StreamedSection>
  );
}

function OldestNotice() {
  const writes = useFamilyWrites();
  const { data } = useServerFirstSWR<NoticesResponse>(ACCOUNT_NOTICES_API_KEY);
  const form = useApiForm();
  const notice = data?.notices[0];

  if (!notice) return null;

  return (
    <NoticeDialog
      key={notice.id}
      notice={notice}
      pending={form.pending}
      error={form.error}
      onDismiss={() =>
        void form.submit(
          async () => {
            await writes.dismissNotice(notice.id);
          },
          { fallback: "Unable to dismiss the notice. Please try again." },
        )
      }
    />
  );
}
