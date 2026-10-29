"use client";

import { Button } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useImportApi } from "@/components/expenses/import/import-api";
import { ResultView } from "@/components/expenses/import/result-view";
import { ReviewStep } from "@/components/expenses/import/review-step";
import { statementContentType, statementKind, UploadStep, uploadErrorMessage } from "@/components/expenses/import/upload-step";
import { DataLoading } from "@/components/ui/data-state";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { useAccount } from "@/hooks/use-account";
import type { ImportConfirmResponse } from "@/lib/api/keys";
import type { ImportDraft } from "@/lib/imports/types";

type Step =
  | { kind: "upload"; notice?: string }
  | { kind: "review"; draft: ImportDraft; reopened: boolean; warnings: string[] }
  | { kind: "done"; result: ImportConfirmResponse };

/**
 * The import page's three steps: upload a statement, review its rows, and the result after Confirm.
 * Only the caller's own expenses are ever imported, so this never reads `?member=`.
 */
export function ImportScreen() {
  const api = useImportApi();
  const { currency: accountCurrency, account } = useAccount();
  const [step, setStep] = useState<Step>({ kind: "upload" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File) {
    const kind = statementKind(file);
    if (!kind || pending) return;
    setPending(true);
    setError("");
    try {
      const { batch, reopened, warnings } = await api.upload(file, statementContentType(kind));
      const draft = await api.getDraft(batch.id);
      setStep({ kind: "review", draft, reopened, warnings });
    } catch (caught) {
      setError(uploadErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  function startOver(notice?: string) {
    setError("");
    setStep({ kind: "upload", notice });
  }

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
      ) : step.kind === "upload" ? (
        <UploadStep onFile={(file) => void upload(file)} pending={pending} error={error} notice={step.notice} />
      ) : step.kind === "review" ? (
        <ReviewStep
          key={step.draft.batch.id}
          draft={step.draft}
          accountCurrency={accountCurrency}
          reopened={step.reopened}
          warnings={step.warnings}
          onConfirmed={(result) => setStep({ kind: "done", result })}
          onDiscarded={() => startOver("The import was discarded. Nothing was added.")}
          onStartOver={() => startOver()}
        />
      ) : (
        <ResultView result={step.result} accountCurrency={accountCurrency} onUploadAnother={() => startOver()} />
      )}
    </>
  );
}
