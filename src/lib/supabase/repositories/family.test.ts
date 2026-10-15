import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { PARENT_PERMISSIONS } from "@/lib/family/repository";
import { fakeSupabase } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => mocks);

import { supabaseFamilyRepository as family } from "@/lib/supabase/repositories/family";

const familyId = "70000000-0000-4000-8000-000000000151";
const parentMemberId = "60000000-0000-4000-8000-000000000151";
const kidMemberId = "60000000-0000-4000-8000-000000000152";
const parentUserId = "10000000-0000-4000-8000-000000000151";
const kidUserId = "10000000-0000-4000-8000-000000000152";

const kidPermissions = { expenses: "edit", investments: "off", net_worth: "edit", family_finance: "view" };

const membershipRow = {
  member_id: kidMemberId,
  family_id: familyId,
  family_name: "The Smiths",
  role: "kid",
  is_creator: false,
  permissions: kidPermissions,
};

function useRpc(answer: (fn: string) => { data: unknown; error: unknown }) {
  const database = fakeSupabase({}, { rpc: answer });
  mocks.createClient.mockResolvedValue(database.client);
  return database;
}

describe("Supabase family repository", () => {
  beforeEach(() => vi.resetAllMocks());

  describe("getMembership", () => {
    it("calls get_my_membership as the request's caller, with no arguments", async () => {
      const { rpcs } = useRpc(() => ({ data: [], error: null }));

      await family.getMembership();

      expect(rpcs).toEqual([{ fn: "get_my_membership", args: {} }]);
    });

    it("returns null when the caller has no family", async () => {
      useRpc(() => ({ data: [], error: null }));

      expect(await family.getMembership()).toBeNull();
    });

    it("maps a kid's membership with every module", async () => {
      useRpc(() => ({ data: [membershipRow], error: null }));

      expect(await family.getMembership()).toEqual({
        memberId: kidMemberId,
        familyId,
        familyName: "The Smiths",
        role: "kid",
        isCreator: false,
        permissions: kidPermissions,
      });
    });

    it("gives a parent's null permissions the parent permissions", async () => {
      const parentRow = { ...membershipRow, member_id: parentMemberId, role: "parent", is_creator: true, permissions: null };
      useRpc(() => ({ data: [parentRow], error: null }));

      expect(await family.getMembership()).toMatchObject({
        memberId: parentMemberId,
        role: "parent",
        isCreator: true,
        permissions: PARENT_PERMISSIONS,
      });
    });

    it("treats a kid's missing or unknown levels as off", async () => {
      const permissions = { expenses: "edit", investments: "view", family_finance: "edit" };
      useRpc(() => ({ data: [{ ...membershipRow, permissions }], error: null }));

      expect((await family.getMembership())?.permissions).toEqual({
        expenses: "edit",
        investments: "off",
        net_worth: "off",
        family_finance: "off",
      });
    });

    it("translates a known database error into a domain error", async () => {
      useRpc(() => ({ data: null, error: { code: "42501", message: "Authentication is required." } }));

      await expect(family.getMembership()).rejects.toThrow(new DomainError("Authentication is required.", 403));
    });

    it("hides any other database error behind a generic message", async () => {
      useRpc(() => ({ data: null, error: { message: "private database failure" } }));

      await expect(family.getMembership()).rejects.toThrow(new Error("Unable to load your family membership."));
    });
  });

  describe("getFamily", () => {
    const familyJson = {
      family: { id: familyId, name: "The Smiths", createdAt: "2026-10-01T09:00:00+00:00" },
      members: [
        {
          memberId: parentMemberId,
          userId: parentUserId,
          role: "parent",
          isCreator: true,
          displayName: "Ana",
          username: null,
          joinedAt: "2026-10-01T09:00:00+00:00",
        },
        {
          memberId: kidMemberId,
          userId: kidUserId,
          role: "kid",
          isCreator: false,
          displayName: "mihai",
          username: "mihai",
          joinedAt: "2026-10-02T09:00:00+00:00",
          lastActiveAt: null,
          permissions: kidPermissions,
        },
      ],
    };

    it("calls get_family as the request's caller, with no arguments", async () => {
      const { rpcs } = useRpc(() => ({ data: null, error: null }));

      await family.getFamily();

      expect(rpcs).toEqual([{ fn: "get_family", args: {} }]);
    });

    it("returns null when the caller has no family", async () => {
      useRpc(() => ({ data: null, error: null }));

      expect(await family.getFamily()).toBeNull();
    });

    it("maps the family and its members, leaving hidden fields out", async () => {
      useRpc(() => ({ data: familyJson, error: null }));

      const result = await family.getFamily();

      expect(result).toEqual({
        family: { id: familyId, name: "The Smiths", createdAt: "2026-10-01T09:00:00+00:00" },
        members: [
          {
            memberId: parentMemberId,
            userId: parentUserId,
            role: "parent",
            isCreator: true,
            displayName: "Ana",
            username: null,
            joinedAt: "2026-10-01T09:00:00+00:00",
          },
          {
            memberId: kidMemberId,
            userId: kidUserId,
            role: "kid",
            isCreator: false,
            displayName: "mihai",
            username: "mihai",
            joinedAt: "2026-10-02T09:00:00+00:00",
            lastActiveAt: null,
            permissions: kidPermissions,
          },
        ],
      });
      expect(result?.members[0]).not.toHaveProperty("lastActiveAt");
      expect(result?.members[0]).not.toHaveProperty("permissions");
    });

    it("gives a visible parent's null permissions the parent permissions", async () => {
      const parent = { ...familyJson.members[0], lastActiveAt: "2026-10-15T09:00:00+00:00", permissions: null };
      useRpc(() => ({ data: { ...familyJson, members: [parent] }, error: null }));

      expect((await family.getFamily())?.members[0]).toMatchObject({
        lastActiveAt: "2026-10-15T09:00:00+00:00",
        permissions: PARENT_PERMISSIONS,
      });
    });

    it("translates a known database error into a domain error", async () => {
      useRpc(() => ({ data: null, error: { code: "42501", message: "Authentication is required." } }));

      await expect(family.getFamily()).rejects.toThrow(new DomainError("Authentication is required.", 403));
    });

    it("hides any other database error behind a generic message", async () => {
      useRpc(() => ({ data: null, error: { message: "private database failure" } }));

      await expect(family.getFamily()).rejects.toThrow(new Error("Unable to load the family."));
    });
  });

  describe("createFamily", () => {
    it("calls create_family with the name as the request's caller", async () => {
      const { rpcs } = useRpc(() => ({ data: familyId, error: null }));

      await family.createFamily("The Smiths");

      expect(rpcs).toEqual([{ fn: "create_family", args: { p_name: "The Smiths" } }]);
    });

    it("returns the new family's id", async () => {
      useRpc(() => ({ data: familyId, error: null }));

      expect(await family.createFamily("The Smiths")).toBe(familyId);
    });

    it("translates being already in a family into a 409", async () => {
      useRpc(() => ({ data: null, error: { code: "23505", message: "You're already in a family." } }));

      await expect(family.createFamily("The Smiths")).rejects.toThrow(new DomainError("You're already in a family.", 409));
    });

    it("translates an invalid name into a 422 with the database's message", async () => {
      useRpc(() => ({ data: null, error: { code: "23514", message: "Use at most 60 characters." } }));

      await expect(family.createFamily("x".repeat(61))).rejects.toThrow(new DomainError("Use at most 60 characters.", 422));
    });

    it("translates a missing caller into a 403", async () => {
      useRpc(() => ({ data: null, error: { code: "42501", message: "Sign in to create a family." } }));

      await expect(family.createFamily("The Smiths")).rejects.toThrow(new DomainError("Sign in to create a family.", 403));
    });

    it("hides any other database error behind a generic message", async () => {
      useRpc(() => ({ data: null, error: { message: "private database failure" } }));

      await expect(family.createFamily("The Smiths")).rejects.toThrow(new Error("Unable to create the family."));
    });

    it("treats a missing id as a failure", async () => {
      useRpc(() => ({ data: null, error: null }));

      await expect(family.createFamily("The Smiths")).rejects.toThrow(new Error("Unable to create the family."));
    });
  });
});
