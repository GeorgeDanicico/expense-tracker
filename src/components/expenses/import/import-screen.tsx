"use client";

import { Button, Stack } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";

import { useImportApi } from "@/components/expenses/import/import-api";
import { RecentImports } from "@/components/expenses/import/recent-imports";
import { ResultView } from "@/components/expenses/import/result-view";
import { ReviewStep } from "@/components/expenses/import/review-step";
import { statementContentType, statementKind, UploadStep, uploadErrorCode, uploadErrorMessage } from "@/components/expenses/import/upload-step";
import { DataLoading } from "@/components/ui/data-state";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { useAccount } from "@/hooks/use-account";
import { useAiSettings } from "@/hooks/use-ai-settings";
import { ApiError } from "@/lib/api/client";
import { afterImportDraftChange } from "@/lib/api/invalidate";
import type { ImportConfirmResponse } from "@/lib/api/keys";
import { IMPORT_EXPIRED_NOTICE } from "@/lib/imports/recent";
import type { ImportDraft } from "@/lib/imports/types";

/** The query parameter that names the draft being reviewed, so a reload or a bookmark comes back to it. */
export const DRAFT_PARAM = "draft";

type Step =
  | { kind: "upload"; notice?: string; tone?: "info" | "warning" }
  /** A draft is being loaded (Resume, or a link with `?draft=`). */
  | { kind: "opening" }
  | { kind: "review"; draft: ImportDraft; reopened: boolean; warnings: string[] }
  | { kind: "done"; result: ImportConfirmResponse };

/**
 * Keeps `?draft=` in the address bar without a navigation: Next.js folds `history.replaceState` into
 * its router, and any other query parameter stays as it is.
 */
function setDraftInUrl(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(DRAFT_PARAM, id);
  else url.searchParams.delete(DRAFT_PARAM);
  window.history.replaceState(null, "", url);
}

/**
 * The import page's steps: upload a statement (with the list of recent imports to resume, discard or
 * undo), review its rows, and the result after Confirm. `?draft=<id>` opens a draft directly: a draft
 * that has expired answers 404 and gives "This import has expired" with the upload step. Only the
 * caller's own expenses are ever imported, so this never reads `?member=`.
 */
export function ImportScreen() {
  const api = useImportApi();
  const { mutate } = useSWRConfig();
  const { currency: accountCurrency, account } = useAccount();
  const searchParams = useSearchParams();
  // The draft the link named when the page loaded; later changes to the address bar are our own.
  const [requested] = useState(() => searchParams.get(DRAFT_PARAM));
  const [step, setStep] = useState<Step>(requested ? { kind: "opening" } : { kind: "upload" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState<string | undefined>();
  // Whether the user's AI switch is on, once known; the upload step points at Settings → AI while it is off.
  const { settings: aiSettings } = useAiSettings();

  async function upload(file: File) {
    const kind = statementKind(file);
    if (!kind || pending) return;
    setPending(true);
    setError("");
    setErrorCode(undefined);
    try {
      const { batch, reopened, warnings } = await api.upload(file, statementContentType(kind));
      const draft = await api.getDraft(batch.id);
      setDraftInUrl(batch.id);
      afterImportDraftChange(mutate);
      setStep({ kind: "review", draft, reopened, warnings });
    } catch (caught) {
      setError(uploadErrorMessage(caught));
      setErrorCode(uploadErrorCode(caught));
    } finally {
      setPending(false);
    }
  }

  /** Back to the upload step, with the list refreshed: what was just done changes it. */
  function startOver(notice?: string, tone: "info" | "warning" = "info") {
    setError("");
    setErrorCode(undefined);
    setDraftInUrl(null);
    afterImportDraftChange(mutate);
    setStep({ kind: "upload", notice, tone });
  }

  /** Opens a draft by id: Resume on the list, or a link with `?draft=`. */
  async function openDraft(id: string) {
    setError("");
    setStep({ kind: "opening" });
    try {
      const draft = await api.getDraft(id);
      setDraftInUrl(id);
      setStep({ kind: "review", draft, reopened: false, warnings: [] });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        startOver(IMPORT_EXPIRED_NOTICE, "warning");
      } else if (caught instanceof ApiError && caught.status === 409) {
        startOver(caught.message, "warning");
      } else {
        startOver();
        setError(caught instanceof Error ? caught.message : "The import could not be opened. Please try again.");
      }
    }
  }

  const opened = useRef(false);
  useEffect(() => {
    // Once (not twice in Strict Mode): a link with `?draft=` opens that draft as the page loads.
    if (opened.current || !requested) return;
    opened.current = true;
    void openDraft(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageHeader
        title="Import a statement"
        description="Read a bank statement, check the rows, and add them to your expenses."
        actions={
          <Button asChild variant="ghost" size={{ base: "md", sm: "sm" }}>
            <Link href="/expenses">
              <ArrowLeft size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Expenses
            </Link>
          </Button>
        }
      />
      {/* The account's currency decides which rows can be imported, so wait for it. */}
      {!account ? (
        <DataLoading label="Loading your account…" layout="section" />
      ) : step.kind === "opening" ? (
        <DataLoading label="Opening the import…" layout="section" />
      ) : step.kind === "upload" ? (
        <Stack gap={{ base: "5", md: "6" }}>
          <UploadStep
            onFile={(file) => void upload(file)}
            pending={pending}
            error={error}
            errorCode={errorCode}
            aiEnabled={aiSettings ? aiSettings.enabled : undefined}
            notice={step.notice}
            noticeTone={step.tone}
          />
          <RecentImports onResume={(id) => void openDraft(id)} />
        </Stack>
      ) : step.kind === "review" ? (
        <ReviewStep
          key={step.draft.batch.id}
          draft={step.draft}
          accountCurrency={accountCurrency}
          reopened={step.reopened}
          warnings={step.warnings}
          onConfirmed={(result) => {
            setDraftInUrl(null);
            setStep({ kind: "done", result });
          }}
          onDiscarded={() => startOver("The import was discarded. Nothing was added.")}
          onStartOver={() => startOver()}
        />
      ) : (
        <ResultView result={step.result} accountCurrency={accountCurrency} onUploadAnother={() => startOver()} />
      )}
    </>
  );
}
