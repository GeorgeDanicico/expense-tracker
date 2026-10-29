"use client";

import { createContext, useContext, type ReactNode } from "react";

import { ApiError, apiFetcher, apiRequest } from "@/lib/api/client";
import {
  IMPORTS_API_KEY,
  importApiUrl,
  importConfirmApiUrl,
  importUndoApiUrl,
  type ImportConfirmResponse,
  type ImportDetailResponse,
  type ImportUndoResponse,
  type ImportUploadResponse,
} from "@/lib/api/keys";
import type { confirmRows } from "@/lib/imports/review";
import { IMPORT_ALREADY_DONE_NOTICE } from "@/lib/imports/recent";
import type { ImportDraft } from "@/lib/imports/types";

/** The rows the confirm route takes: the ticked rows with their final values. */
export type ConfirmRows = ReturnType<typeof confirmRows>;

/**
 * The import page's requests. The page uses the REST API; `/dev/preview/import` swaps in an
 * in-memory one. Failures reject with an `ApiError` carrying the server's message (and, for a
 * confirm with a bad row, its `fieldErrors`).
 */
export type ImportApi = {
  /** Sends the statement as the raw body with the given `Content-Type` (never multipart). */
  upload(file: File, contentType: string): Promise<ImportUploadResponse>;
  /**
   * A draft with its rows, duplicate flags and `importable`. Rejects with a 404 `ApiError` for a
   * draft that is missing or has expired, and a 409 one for an import that was confirmed or undone
   * (the route answers those with the batch alone).
   */
  getDraft(id: string): Promise<ImportDraft>;
  confirm(id: string, rows: ConfirmRows): Promise<ImportConfirmResponse>;
  /** Discards a draft. */
  discard(id: string): Promise<void>;
  /** Undoes a confirmed import. */
  undo(id: string): Promise<ImportUndoResponse>;
};

export const restImportApi: ImportApi = {
  upload(file, contentType) {
    // The file's own bytes are the body, like the avatar upload; `headers` overrides the JSON default.
    return apiRequest<ImportUploadResponse>(IMPORTS_API_KEY, {
      method: "POST",
      body: file,
      headers: { "Content-Type": contentType },
    });
  },
  async getDraft(id) {
    const detail = await apiFetcher<ImportDetailResponse>(importApiUrl(id));
    if (!detail.rows) throw new ApiError(IMPORT_ALREADY_DONE_NOTICE, 409);
    return { batch: detail.batch, rows: detail.rows };
  },
  confirm(id, rows) {
    return apiRequest<ImportConfirmResponse>(importConfirmApiUrl(id), {
      method: "POST",
      body: JSON.stringify({ rows }),
    });
  },
  async discard(id) {
    await apiRequest<void>(importApiUrl(id), { method: "DELETE" });
  },
  undo(id) {
    return apiRequest<ImportUndoResponse>(importUndoApiUrl(id), { method: "POST" });
  },
};

const ImportApiContext = createContext<ImportApi>(restImportApi);

export function ImportApiProvider({ api, children }: { api: ImportApi; children: ReactNode }) {
  return <ImportApiContext.Provider value={api}>{children}</ImportApiContext.Provider>;
}

export function useImportApi() {
  return useContext(ImportApiContext);
}
