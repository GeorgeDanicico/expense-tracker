import "server-only";

import { HttpError } from "@/lib/http/route";

/**
 * The request body as bytes, refusing more than `maxBytes` with a 413 `tooLarge`. It checks
 * `Content-Length` first, then counts while reading, because the header can be missing or wrong.
 * It stops reading as soon as the limit is passed, so an oversized body is never held in memory.
 */
export async function readBodyWithLimit(request: Request, maxBytes: number, tooLarge: string): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) throw new HttpError(413, tooLarge);
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, tooLarge);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
