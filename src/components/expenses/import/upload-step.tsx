"use client";

import { Box, Button, Stack, Text } from "@chakra-ui/react";
import { FileUp } from "lucide-react";
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";

import { Card } from "@/components/ui/card";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { ApiError } from "@/lib/api/client";
import {
  IMPORT_CSV_MAX_BYTES,
  IMPORT_DRAFT_HOURS,
  IMPORT_PDF_MAX_BYTES,
  tooLargeMessage,
  type ImportSourceKind,
} from "@/lib/imports/types";

/**
 * PDF statements are accepted by the server only from task I12; until then the picker names them
 * as coming soon and a dropped PDF is refused here without a request. Flip this when I12 lands.
 */
export const PDF_IMPORT_ENABLED = false;

export const PDF_COMING_SOON = "PDF statements are coming soon. Upload a CSV for now.";
export const NOT_A_STATEMENT_FILE = "Choose a CSV statement (a .csv file).";
export const EMPTY_STATEMENT_FILE = "That file is empty.";

/** The line under the picker: what happens to the file. */
export const DISCARD_NOTE = `The file is read and discarded. Only the rows below are kept, for ${IMPORT_DRAFT_HOURS} hours.`;

type FileFacts = Pick<File, "name" | "size">;

/** The kind a file name says it is: the extension decides, as browsers disagree about CSV types. */
export function statementKind(file: Pick<File, "name">): ImportSourceKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return "csv";
  if (name.endsWith(".pdf")) return "pdf";
  return null;
}

/** The `Content-Type` the file is sent with; the server still decides by the bytes. */
export function statementContentType(kind: ImportSourceKind): string {
  return kind === "pdf" ? "application/pdf" : "text/csv";
}

/**
 * Why the browser refuses `file` before sending it, or `null` when it may be sent. The server checks
 * all of this again; this only saves an upload that would fail.
 */
export function validateStatementFile(file: FileFacts): string | null {
  const kind = statementKind(file);
  if (kind === null) return NOT_A_STATEMENT_FILE;
  if (kind === "pdf" && !PDF_IMPORT_ENABLED) return PDF_COMING_SOON;
  if (file.size === 0) return EMPTY_STATEMENT_FILE;
  if (file.size > (kind === "pdf" ? IMPORT_PDF_MAX_BYTES : IMPORT_CSV_MAX_BYTES)) return tooLargeMessage(kind);
  return null;
}

/**
 * The message for a refused upload. The server's own message is specific to the refusal (too large,
 * not a statement, a layout not supported yet, imported already with its date), so it is shown as
 * it is; a status that arrives without one (a proxy's 413, say) gets a plain default.
 */
export function uploadErrorMessage(caught: unknown): string {
  if (caught instanceof ApiError) {
    if (caught.message && caught.message !== "Something went wrong. Please try again.") return caught.message;
    if (caught.status === 413) return tooLargeMessage("csv");
    if (caught.status === 415) return NOT_A_STATEMENT_FILE;
    if (caught.status === 429) return "Too many uploads. Try again later.";
  }
  return caught instanceof Error ? caught.message : "Unable to read the statement. Please try again.";
}

/** The first step: pick or drop a statement. It only reports the chosen file; the screen uploads it. */
export function UploadStep({
  onFile,
  pending,
  error,
  notice,
  noticeTone = "info",
}: {
  onFile: (file: File) => void;
  pending: boolean;
  /** Why the last file was refused. */
  error?: string;
  /** Something to say before the picker (an import was just discarded, say). */
  notice?: string;
  /** `warning` for a draft that is gone (expired, or confirmed elsewhere); `info` for a plain note. */
  noticeTone?: "info" | "warning";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [refused, setRefused] = useState("");

  function choose(file: File | undefined) {
    if (!file || pending) return;
    const problem = validateStatementFile(file);
    setRefused(problem ?? "");
    if (!problem) onFile(file);
  }

  function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again still fires `change`.
    event.target.value = "";
    choose(file);
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files[0]);
  }

  const shownError = refused || error;

  return (
    <Stack gap="3">
      {notice ? <InlineAlert status={noticeTone}>{notice}</InlineAlert> : null}
      {shownError ? <InlineAlert status="error">{shownError}</InlineAlert> : null}
      <Card>
        <Card.Body>
          <Box
            role="group"
            aria-label="Statement drop zone"
            borderWidth="1px"
            borderStyle="dashed"
            borderColor={dragging ? "fg.accent" : "border.strong"}
            borderRadius="card"
            bg={dragging ? "bg.selected" : "bg.subtle"}
            px={{ base: "3", sm: "4" }}
            py={{ base: "6", md: "10" }}
            onDragOver={(event) => {
              event.preventDefault();
              if (!pending) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
          >
            <Stack align="center" gap="3" textAlign="center">
              <Box color="fg.muted" aria-hidden="true">
                <FileUp size={ICON.nav} strokeWidth={ICON_STROKE} />
              </Box>
              <Stack gap="0.5">
                <Text textStyle="sectionTitle">Drop a statement here</Text>
                <Text textStyle="caption">
                  A CSV file from your bank, up to {IMPORT_CSV_MAX_BYTES / (1024 * 1024)} MB.{" "}
                  {PDF_IMPORT_ENABLED ? "PDF statements work too." : "PDF statements are coming soon."}
                </Text>
              </Stack>
              <input
                ref={input}
                type="file"
                accept={PDF_IMPORT_ENABLED ? ".csv,.pdf" : ".csv"}
                hidden
                onChange={pick}
                aria-label="Statement file"
              />
              <Button
                variant="solid"
                colorPalette="brand"
                width={{ base: "full", sm: "auto" }}
                loading={pending}
                loadingText="Reading the statement…"
                onClick={() => {
                  setRefused("");
                  input.current?.click();
                }}
              >
                <FileUp size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Choose a file
              </Button>
            </Stack>
          </Box>
        </Card.Body>
      </Card>
      <Text textStyle="caption">{DISCARD_NOTE}</Text>
    </Stack>
  );
}
