"use client";

import { Button, Text } from "@chakra-ui/react";
import useSWR, { useSWRConfig } from "swr";

import { AppDialog } from "@/components/ui/app-dialog";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import type { AccountNotice } from "@/lib/account/notice-repository";
import { apiRequest } from "@/lib/api/client";
import { afterNoticeDismissed } from "@/lib/api/invalidate";
import { ACCOUNT_NOTICES_API_KEY, dismissNoticeApiUrl, type NoticesResponse } from "@/lib/api/keys";

/** What a notice says. The family's own data is gone from the user's view, their personal data is not. */
export function noticeMessage(notice: Pick<AccountNotice, "kind" | "familyName">): string {
  return notice.kind === "family_deleted"
    ? `The family ${notice.familyName} was deleted. Your own expenses, investments and net worth are still here.`
    : `You were removed from the family ${notice.familyName}. Your own data is still here.`;
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
      title={notice.kind === "family_deleted" ? "Your family was deleted" : "You left the family"}
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
 * Shows the oldest unseen notice. OK marks it as seen and moves on to the next one. Mount it only
 * while the family feature is on: the notices route answers 404 otherwise.
 */
export function AccountNoticeDialog() {
  const { mutate } = useSWRConfig();
  const { data } = useSWR<NoticesResponse>(ACCOUNT_NOTICES_API_KEY);
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
            await apiRequest(dismissNoticeApiUrl(notice.id), { method: "POST" });
            await afterNoticeDismissed(mutate, notice.id);
          },
          { fallback: "Unable to dismiss the notice. Please try again." },
        )
      }
    />
  );
}
