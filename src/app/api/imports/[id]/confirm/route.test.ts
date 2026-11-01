import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetFakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

const mocks = vi.hoisted(() => ({ confirmDraft: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/imports/service", () => ({ confirmDraft: mocks.confirmDraft }));
// `withUser` reads the caller's must-change-password flag from the account repository.
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { POST } from "@/app/api/imports/[id]/confirm/route";

const ID = "8d0f7c2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f";
const row = (index: number) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  description: "Ș".repeat(120),
  amount: "12.34",
  category: "groceries",
  subtype: null,
  expenseDate: "2026-10-01",
  notes: "ă".repeat(500),
});
const confirm = (body: unknown) => callRoute(POST, { method: "POST", url: `/api/imports/${ID}/confirm`, body, params: { id: ID } });

// readJson's usual 64 KB is too little for this body: the route allows 1 MB (security plan S5).
describe("POST /api/imports/[id]/confirm body limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFakeRepositories();
    signedInAs();
    mocks.confirmDraft.mockResolvedValue({ batch: {}, created: [] });
  });

  it("reads 500 rows of full-length non-ASCII text", async () => {
    const rows = Array.from({ length: 500 }, (_, index) => row(index));
    expect(new TextEncoder().encode(JSON.stringify({ rows })).byteLength).toBeGreaterThan(64 * 1024);

    expect((await confirm({ rows })).status).toBe(200);
    expect(mocks.confirmDraft).toHaveBeenCalledWith(expect.any(String), ID, { rows });
  });

  it("refuses a body over 1 MB with 413", async () => {
    expect(await confirm({ rows: [], padding: "x".repeat(1024 * 1024) })).toMatchObject({
      status: 413,
      body: { error: "The request is too large." },
    });
    expect(mocks.confirmDraft).not.toHaveBeenCalled();
  });
});
