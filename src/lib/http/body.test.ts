import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { readBodyWithLimit } from "@/lib/http/body";
import { HttpError } from "@/lib/http/route";

const URL = "http://localhost/api/account/avatar";
const LIMIT = 10;
const TOO_LARGE = "That file is too large.";

function bytes(length: number, fill = 7) {
  return new Uint8Array(length).fill(fill);
}

/** A body sent as separate chunks with no `Content-Length`, like a chunked upload. */
function streamedRequest(chunks: Uint8Array[]) {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[pulled];
      pulled += 1;
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
  const request = new NextRequest(URL, { method: "PUT", body: stream, duplex: "half" });
  return { request, pulledChunks: () => pulled };
}

async function expectTooLarge(promise: Promise<unknown>) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HttpError);
  expect(error).toMatchObject({ status: 413, message: TOO_LARGE });
}

describe("readBodyWithLimit", () => {
  it("returns an empty array when there is no body", async () => {
    const request = new NextRequest(URL, { method: "PUT" });

    const body = await readBodyWithLimit(request, LIMIT, TOO_LARGE);

    expect(body).toEqual(new Uint8Array());
  });

  it("returns a body exactly at the limit", async () => {
    const request = new NextRequest(URL, { method: "PUT", body: bytes(LIMIT) });

    const body = await readBodyWithLimit(request, LIMIT, TOO_LARGE);

    expect(body).toEqual(bytes(LIMIT));
  });

  it("joins a streamed body's chunks in order", async () => {
    const { request } = streamedRequest([bytes(3, 1), bytes(4, 2), bytes(3, 3)]);

    const body = await readBodyWithLimit(request, LIMIT, TOO_LARGE);

    expect(Array.from(body)).toEqual([1, 1, 1, 2, 2, 2, 2, 3, 3, 3]);
  });

  it("refuses a declared Content-Length over the limit without reading the body", async () => {
    const request = new NextRequest(URL, {
      method: "PUT",
      body: bytes(LIMIT + 1),
      headers: { "content-length": String(LIMIT + 1) },
    });

    await expectTooLarge(readBodyWithLimit(request, LIMIT, TOO_LARGE));
    expect(request.bodyUsed).toBe(false);
  });

  it("refuses a body over the limit with no Content-Length, and stops reading at the limit", async () => {
    const { request, pulledChunks } = streamedRequest([bytes(6), bytes(6), bytes(6), bytes(6)]);
    expect(request.headers.get("content-length")).toBeNull();

    await expectTooLarge(readBodyWithLimit(request, LIMIT, TOO_LARGE));
    expect(pulledChunks()).toBeLessThan(4);
  });
});
