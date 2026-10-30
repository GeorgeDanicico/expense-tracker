"use client";

import { Box, Button, Link as ChakraLink, Stack, Text } from "@chakra-ui/react";
import { FileUp } from "lucide-react";
import Link from "next/link";
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

const MIB = 1024 * 1024;

export const NOT_A_STATEMENT_FILE = "Choose a CSV or PDF statement (a .csv or .pdf file).";
export const EMPTY_STATEMENT_FILE = "That file is empty.";

/** The line under the picker: what happens to the file. */
export const DISCARD_NOTE = `The file is read and discarded. Only the rows below are kept, for ${IMPORT_DRAFT_HOURS} hours.`;

/** The refusal code of a statement no parser reads while AI reading is off. */
const UNRECOGNISED_LAYOUT = "unrecognised_layout";

/**
 * The line that says AI reading would import any bank's statement, linking to Settings → AI. It is
 * on the upload step while the user's AI switch is off, and with the refusal of a layout no parser
 * reads.
 */
export function AiReadingHint() {
  return (
    <Text textStyle="caption" data-testid="ai-reading-hint">
      Turn on AI reading in{" "}
      <ChakraLink asChild color="fg.accent">
        <Link href="/settings/ai">Settings</Link>
      </ChakraLink>{" "}
      to import any bank&apos;s statement.
    </Text>
  );
}

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

/** The refusal code the server sent with a refused upload (`unrecognised_layout`, say), when it sent one. */
export function uploadErrorCode(caught: unknown): string | undefined {
  return caught instanceof ApiError ? caught.code : undefined;
}

/**
 * The first step: pick or drop a statement. It only reports the chosen file; the screen uploads it.
 * With `aiEnabled === false` it adds the line pointing at Settings → AI; while that is not known yet
 * (still loading, or the request failed) it says nothing about AI.
 */
export function UploadStep({
  onFile,
  pending,
  error,
  errorCode,
  aiEnabled,
  notice,
  noticeTone = "info",
}: {
  onFile: (file: File) => void;
  pending: boolean;
  /** Why the last file was refused. */
  error?: string;
  /** The server's code for that refusal. */
  errorCode?: string;
  /** The user's Settings → AI switch, or `undefined` while it is not known. */
  aiEnabled?: boolean;
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
  const aiOff = aiEnabled === false;
  // A layout nobody reads gets the hint inside its refusal; the standing line would repeat it.
  const hintInError = aiOff && !refused && errorCode === UNRECOGNISED_LAYOUT;

  return (
    <Stack gap="3">
      {notice ? <InlineAlert status={noticeTone}>{notice}</InlineAlert> : null}
      {shownError ? (
        <InlineAlert status="error">
          {shownError}
          {hintInError ? <Box mt="1"><AiReadingHint /></Box> : null}
        </InlineAlert>
      ) : null}
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
                  A CSV file from your bank, up to {IMPORT_CSV_MAX_BYTES / MIB} MB, or a PDF statement with
                  selectable text, up to {IMPORT_PDF_MAX_BYTES / MIB} MB.
                </Text>
              </Stack>
              <input
                ref={input}
                type="file"
                accept=".csv,.pdf"
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
      {aiOff && !hintInError ? <AiReadingHint /> : null}
      <Text textStyle="caption">{DISCARD_NOTE}</Text>
    </Stack>
  );
}
