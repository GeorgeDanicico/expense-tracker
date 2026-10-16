import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { fakeSupabase } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => mocks);

import { supabaseNoticeRepository as notices } from "@/lib/supabase/repositories/notices";

const noticeId = "90000000-0000-4000-8000-000000000151";

function useRpc(answer: (fn: string) => { data: unknown; error: unknown }) {
  const database = fakeSupabase({}, { rpc: answer });
  mocks.createClient.mockResolvedValue(database.client);
  return database;
}

describe("Supabase notice repository", () => {
  beforeEach(() => vi.resetAllMocks());

  describe("listUnseen", () => {
    it("calls get_my_notices with no arguments and maps the rows", async () => {
      const { rpcs } = useRpc(() => ({
        data: [{ id: noticeId, kind: "family_deleted", family_name: "The Smiths", created_at: "2026-10-01T10:00:00Z" }],
        error: null,
      }));

      expect(await notices.listUnseen()).toEqual([
        { id: noticeId, kind: "family_deleted", familyName: "The Smiths", createdAt: "2026-10-01T10:00:00Z" },
      ]);
      expect(rpcs).toEqual([{ fn: "get_my_notices", args: {} }]);
    });

    it("rejects a kind it does not know", async () => {
      useRpc(() => ({
        data: [{ id: noticeId, kind: "other", family_name: "X", created_at: "2026-10-01T10:00:00Z" }],
        error: null,
      }));

      await expect(notices.listUnseen()).rejects.toThrow(new Error("Unable to load your notices."));
    });

    it("hides a database error behind a generic message", async () => {
      useRpc(() => ({ data: null, error: { message: "private database failure" } }));

      await expect(notices.listUnseen()).rejects.toThrow(new Error("Unable to load your notices."));
    });
  });

  describe("dismiss", () => {
    it("calls dismiss_notice with the notice's id", async () => {
      const { rpcs } = useRpc(() => ({ data: null, error: null }));

      await expect(notices.dismiss(noticeId)).resolves.toBeUndefined();
      expect(rpcs).toEqual([{ fn: "dismiss_notice", args: { p_notice_id: noticeId } }]);
    });

    it("translates an unknown notice into a 404", async () => {
      useRpc(() => ({ data: null, error: { code: "P0002", message: "Notice not found." } }));

      await expect(notices.dismiss(noticeId)).rejects.toThrow(new DomainError("Notice not found.", 404));
    });

    it("hides any other database error behind a generic message", async () => {
      useRpc(() => ({ data: null, error: { message: "private database failure" } }));

      await expect(notices.dismiss(noticeId)).rejects.toThrow(new Error("Unable to dismiss the notice."));
    });
  });
});
