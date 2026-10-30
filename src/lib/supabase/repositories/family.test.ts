import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { PARENT_PERMISSIONS } from "@/lib/family/repository";
import type { Permissions } from "@/lib/permissions";
import { fakeSupabase } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => mocks);

import { supabaseFamilyRepository as family } from "@/lib/supabase/repositories/family";

const familyId = "70000000-0000-4000-8000-000000000151";
const parentMemberId = "60000000-0000-4000-8000-000000000151";
const kidMemberId = "60000000-0000-4000-8000-000000000152";
const parentUserId = "10000000-0000-4000-8000-000000000151";
const kidUserId = "10000000-0000-4000-8000-000000000152";
const inviteId = "80000000-0000-4000-8000-000000000151";
const otherInviteId = "80000000-0000-4000-8000-000000000152";

const kidPermissions = { expenses: "edit", investments: "off", net_worth: "edit", family_finance: "view", mcp: "off", ai: "off" };

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
        mcp: "off",
        ai: "off",
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
          currency: "RON",
          joinedAt: "2026-10-01T09:00:00+00:00",
        },
        {
          memberId: kidMemberId,
          userId: kidUserId,
          role: "kid",
          isCreator: false,
          displayName: "mihai",
          username: "mihai",
          currency: "USD",
          color: 3,
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
            currency: "RON",
            color: null,
            avatarUrl: null,
            joinedAt: "2026-10-01T09:00:00+00:00",
          },
          {
            memberId: kidMemberId,
            userId: kidUserId,
            role: "kid",
            isCreator: false,
            displayName: "mihai",
            username: "mihai",
            currency: "USD",
            color: 3,
            avatarUrl: null,
            joinedAt: "2026-10-02T09:00:00+00:00",
            lastActiveAt: null,
            permissions: kidPermissions,
          },
        ],
      });
      expect(result?.members[0]).not.toHaveProperty("lastActiveAt");
      expect(result?.members[0]).not.toHaveProperty("permissions");
    });

    it("gives a member the default currency when the entry has none or an unsupported one", async () => {
      const [parent, kid] = familyJson.members;
      useRpc(() => ({
        data: { ...familyJson, members: [{ ...parent, currency: undefined }, { ...kid, currency: "XYZ" }] },
        error: null,
      }));

      expect((await family.getFamily())?.members.map((member) => member.currency)).toEqual(["EUR", "EUR"]);
    });

    it("treats a missing or out-of-palette colour as automatic", async () => {
      const [parent, kid] = familyJson.members;
      useRpc(() => ({
        data: { ...familyJson, members: [{ ...parent, color: undefined }, { ...kid, color: 12 }] },
        error: null,
      }));

      expect((await family.getFamily())?.members.map((member) => member.color)).toEqual([null, null]);
    });

    it("turns a member's storage key into an avatar URL", async () => {
      const [parent, kid] = familyJson.members;
      const fileId = "20000000-0000-4000-8000-0000000000a1";
      useRpc(() => ({
        data: { ...familyJson, members: [{ ...parent, avatarPath: `${parentUserId}/${fileId}.webp` }, { ...kid, avatarPath: null }] },
        error: null,
      }));

      expect((await family.getFamily())?.members.map((member) => member.avatarUrl)).toEqual([
        `/api/avatars/${parentUserId}/${fileId}`,
        null,
      ]);
    });

    it("gives no avatar URL for a missing or malformed storage key", async () => {
      const [parent, kid] = familyJson.members;
      useRpc(() => ({
        data: {
          ...familyJson,
          members: [
            { ...parent, avatarPath: undefined },
            { ...kid, avatarPath: "https://example.com/picture.webp" },
          ],
        },
        error: null,
      }));

      expect((await family.getFamily())?.members.map((member) => member.avatarUrl)).toEqual([null, null]);
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

  describe("setMemberPermissions", () => {
    const teen = { expenses: "edit", investments: "edit", net_worth: "edit", family_finance: "off", mcp: "off", ai: "off" } as const;

    it("calls set_member_permissions with the member and every module", async () => {
      const { rpcs } = useRpc(() => ({ data: null, error: null }));

      await expect(family.setMemberPermissions(kidMemberId, teen)).resolves.toBeUndefined();

      expect(rpcs).toEqual([{ fn: "set_member_permissions", args: { p_member_id: kidMemberId, p_permissions: teen } }]);
    });

    it.each([
      { code: "42501", status: 403, message: "Only parents can change a kid's permissions." },
      { code: "P0002", status: 404, message: "That family member wasn't found." },
      { code: "23514", status: 422, message: "Choose an allowed level for every module." },
    ] as const)("translates $code into a $status with the database's message", async ({ code, status, message }) => {
      useRpc(() => ({ data: null, error: { code, message } }));

      await expect(family.setMemberPermissions(kidMemberId, teen)).rejects.toThrow(new DomainError(message, status));
    });

    it("hides any other database error behind a generic message", async () => {
      useRpc(() => ({ data: null, error: { message: "private database failure" } }));

      await expect(family.setMemberPermissions(kidMemberId, teen)).rejects.toThrow(
        new Error("Unable to save the permissions."),
      );
    });
  });

  describe("setMemberColor", () => {
    it("calls set_member_color with the member and the colour, or null", async () => {
      const { rpcs } = useRpc(() => ({ data: null, error: null }));

      await expect(family.setMemberColor(kidMemberId, 4)).resolves.toBeUndefined();
      await expect(family.setMemberColor(kidMemberId, null)).resolves.toBeUndefined();

      expect(rpcs).toEqual([
        { fn: "set_member_color", args: { p_member_id: kidMemberId, p_color: 4 } },
        { fn: "set_member_color", args: { p_member_id: kidMemberId, p_color: null } },
      ]);
    });

    it.each([
      { code: "42501", status: 403, message: "Only parents can choose member colours." },
      { code: "P0002", status: 404, message: "That family member wasn't found." },
      { code: "23514", status: 422, message: "Choose one of the eight colours." },
      { code: "23505", status: 409, message: "Another family member already has that colour." },
    ] as const)("translates $code into a $status with the database's message", async ({ code, status, message }) => {
      useRpc(() => ({ data: null, error: { code, message } }));

      await expect(family.setMemberColor(kidMemberId, 4)).rejects.toThrow(new DomainError(message, status));
    });

    it("hides any other database error behind a generic message", async () => {
      useRpc(() => ({ data: null, error: { message: "private database failure" } }));

      await expect(family.setMemberColor(kidMemberId, 4)).rejects.toThrow(new Error("Unable to save the colour."));
    });
  });

  describe("addManagedKid", () => {
    const youngKid = { expenses: "edit", investments: "off", net_worth: "off", family_finance: "off", mcp: "off", ai: "off" } as const;

    it("calls add_managed_kid with the account and every module as the request's caller", async () => {
      const { rpcs } = useRpc(() => ({ data: kidMemberId, error: null }));

      await family.addManagedKid(kidUserId, youngKid);

      expect(rpcs).toEqual([{ fn: "add_managed_kid", args: { p_user_id: kidUserId, p_permissions: youngKid } }]);
    });

    it("returns the new member's id", async () => {
      useRpc(() => ({ data: kidMemberId, error: null }));

      expect(await family.addManagedKid(kidUserId, youngKid)).toBe(kidMemberId);
    });

    it.each([
      { code: "42501", status: 403, message: "Only parents can add a kid." },
      { code: "P0002", status: 404, message: "That account wasn't found." },
      { code: "23505", status: 409, message: "That account is already in a family." },
      { code: "23514", status: 422, message: "Choose an allowed level for every module." },
    ] as const)("translates $code into a $status with the database's message", async ({ code, status, message }) => {
      useRpc(() => ({ data: null, error: { code, message } }));

      await expect(family.addManagedKid(kidUserId, youngKid)).rejects.toThrow(new DomainError(message, status));
    });

    it("hides any other database error behind a generic message", async () => {
      useRpc(() => ({ data: null, error: { message: "private database failure" } }));

      await expect(family.addManagedKid(kidUserId, youngKid)).rejects.toThrow(
        new Error("Unable to add the kid to the family."),
      );
    });

    it("treats a missing member id as a failure", async () => {
      useRpc(() => ({ data: null, error: null }));

      await expect(family.addManagedKid(kidUserId, youngKid)).rejects.toThrow(
        new Error("Unable to add the kid to the family."),
      );
    });
  });

  describe("requirePasswordChange", () => {
    it("calls require_password_change with the member as the request's caller", async () => {
      const { rpcs } = useRpc(() => ({ data: kidUserId, error: null }));

      await family.requirePasswordChange(kidMemberId);

      expect(rpcs).toEqual([{ fn: "require_password_change", args: { p_member_id: kidMemberId } }]);
    });

    it("returns the kid's user id", async () => {
      useRpc(() => ({ data: kidUserId, error: null }));

      expect(await family.requirePasswordChange(kidMemberId)).toBe(kidUserId);
    });

    it.each([
      { code: "42501", status: 403, message: "Only parents can reset a kid's password." },
      { code: "P0002", status: 404, message: "That family member wasn't found." },
    ] as const)("translates $code into a $status with the database's message", async ({ code, status, message }) => {
      useRpc(() => ({ data: null, error: { code, message } }));

      await expect(family.requirePasswordChange(kidMemberId)).rejects.toThrow(new DomainError(message, status));
    });

    it("hides any other database error behind a generic message", async () => {
      useRpc(() => ({ data: null, error: { message: "private database failure" } }));

      await expect(family.requirePasswordChange(kidMemberId)).rejects.toThrow(new Error("Unable to reset the password."));
    });

    it("treats a missing user id as a failure", async () => {
      useRpc(() => ({ data: null, error: null }));

      await expect(family.requirePasswordChange(kidMemberId)).rejects.toThrow(new Error("Unable to reset the password."));
    });
  });

  describe("removeMember", () => {
    it("calls remove_family_member with the member", async () => {
      const { rpcs } = useRpc(() => ({ data: null, error: null }));

      await expect(family.removeMember(kidMemberId)).resolves.toBeUndefined();

      expect(rpcs).toEqual([{ fn: "remove_family_member", args: { p_member_id: kidMemberId } }]);
    });

    it.each([
      { code: "42501", status: 403, message: "Only the family's creator can remove members." },
      { code: "P0002", status: 404, message: "That family member wasn't found." },
    ] as const)("translates $code into a $status with the database's message", async ({ code, status, message }) => {
      useRpc(() => ({ data: null, error: { code, message } }));

      await expect(family.removeMember(kidMemberId)).rejects.toThrow(new DomainError(message, status));
    });

    it("hides any other database error behind a generic message", async () => {
      useRpc(() => ({ data: null, error: { message: "private database failure" } }));

      await expect(family.removeMember(kidMemberId)).rejects.toThrow(new Error("Unable to remove the member."));
    });
  });

  describe("deleteFamily", () => {
    it("calls delete_family with the typed name", async () => {
      const { rpcs } = useRpc(() => ({ data: null, error: null }));

      await expect(family.deleteFamily("the smiths")).resolves.toBeUndefined();

      expect(rpcs).toEqual([{ fn: "delete_family", args: { p_confirm_name: "the smiths" } }]);
    });

    it.each([
      { code: "42501", status: 403, message: "Only the family's creator can delete the family." },
      { code: "23514", status: 422, message: "Type the family's name to confirm." },
    ] as const)("translates $code into a $status with the database's message", async ({ code, status, message }) => {
      useRpc(() => ({ data: null, error: { code, message } }));

      await expect(family.deleteFamily("The Smiths")).rejects.toThrow(new DomainError(message, status));
    });

    it("hides any other database error behind a generic message", async () => {
      useRpc(() => ({ data: null, error: { message: "private database failure" } }));

      await expect(family.deleteFamily("The Smiths")).rejects.toThrow(new Error("Unable to delete the family."));
    });
  });

  describe("touchLastActive", () => {
    it("calls touch_last_active as the request's caller, with no arguments", async () => {
      const { rpcs } = useRpc(() => ({ data: null, error: null }));

      await expect(family.touchLastActive()).resolves.toBeUndefined();
      expect(rpcs).toEqual([{ fn: "touch_last_active", args: {} }]);
    });

    it("translates a missing caller into a 403", async () => {
      useRpc(() => ({ data: null, error: { code: "42501", message: "Sign in first." } }));

      await expect(family.touchLastActive()).rejects.toThrow(new DomainError("Sign in first.", 403));
    });

    it("hides any other database error behind a generic message", async () => {
      useRpc(() => ({ data: null, error: { message: "private database failure" } }));

      await expect(family.touchLastActive()).rejects.toThrow(new Error("Unable to record your last activity."));
    });
  });

  describe("createInvite", () => {
    const codeHash = "0123456789abcdef".repeat(4);
    const created = { invite_id: inviteId, expires_at: "2026-10-18T09:00:00+00:00" };

    it("calls create_family_invite with null permissions for a parent invite", async () => {
      const { rpcs } = useRpc(() => ({ data: [created], error: null }));

      await family.createInvite({ role: "parent", permissions: null, codeHash });

      expect(rpcs).toEqual([
        { fn: "create_family_invite", args: { p_role: "parent", p_permissions: null, p_code_hash: codeHash } },
      ]);
    });

    it("sends a kid invite's permissions", async () => {
      const { rpcs } = useRpc(() => ({ data: [created], error: null }));

      await family.createInvite({ role: "kid", permissions: kidPermissions as Permissions, codeHash });

      expect(rpcs[0].args).toEqual({ p_role: "kid", p_permissions: kidPermissions, p_code_hash: codeHash });
    });

    it("returns the invite's id and expiry", async () => {
      useRpc(() => ({ data: [created], error: null }));

      expect(await family.createInvite({ role: "parent", permissions: null, codeHash })).toEqual({
        inviteId,
        expiresAt: "2026-10-18T09:00:00+00:00",
      });
    });

    it("refuses a malformed hash as a server failure, without calling the database", async () => {
      const { rpcs } = useRpc(() => ({ data: [created], error: null }));

      await expect(family.createInvite({ role: "parent", permissions: null, codeHash: "ABCD2345" })).rejects.toThrow(
        new Error("Unable to create the invite."),
      );
      expect(rpcs).toEqual([]);
    });

    it("translates a non-parent caller into a 403", async () => {
      useRpc(() => ({ data: null, error: { code: "42501", message: "Only parents can invite people to the family." } }));

      await expect(family.createInvite({ role: "parent", permissions: null, codeHash })).rejects.toThrow(
        new DomainError("Only parents can invite people to the family.", 403),
      );
    });

    it("translates invalid permissions into a 422", async () => {
      useRpc(() => ({ data: null, error: { code: "23514", message: "Choose an allowed level for every module." } }));

      await expect(
        family.createInvite({ role: "kid", permissions: kidPermissions as Permissions, codeHash }),
      ).rejects.toThrow(new DomainError("Choose an allowed level for every module.", 422));
    });

    it("translates a hash already in use into a 409", async () => {
      useRpc(() => ({ data: null, error: { code: "23505", message: "That invite code is already in use." } }));

      await expect(family.createInvite({ role: "parent", permissions: null, codeHash })).rejects.toThrow(
        new DomainError("That invite code is already in use.", 409),
      );
    });

    it("hides any other database error behind a generic message", async () => {
      useRpc(() => ({ data: null, error: { message: "private database failure" } }));

      await expect(family.createInvite({ role: "parent", permissions: null, codeHash })).rejects.toThrow(
        new Error("Unable to create the invite."),
      );
    });

    it("treats a missing row as a failure", async () => {
      useRpc(() => ({ data: [], error: null }));

      await expect(family.createInvite({ role: "parent", permissions: null, codeHash })).rejects.toThrow(
        new Error("Unable to create the invite."),
      );
    });
  });

  describe("listInvites", () => {
    const kidInviteRow = {
      invite_id: inviteId,
      role: "kid",
      permissions: kidPermissions,
      created_by_name: "Ana",
      created_at: "2026-10-16T09:00:00+00:00",
      expires_at: "2026-10-23T09:00:00+00:00",
    };

    it("calls list_family_invites as the request's caller, with no arguments", async () => {
      const { rpcs } = useRpc(() => ({ data: [], error: null }));

      expect(await family.listInvites()).toEqual([]);
      expect(rpcs).toEqual([{ fn: "list_family_invites", args: {} }]);
    });

    it("maps kid and parent invites, keeping the database's order", async () => {
      const parentInviteRow = { ...kidInviteRow, invite_id: otherInviteId, role: "parent", permissions: null, created_by_name: null };
      useRpc(() => ({ data: [parentInviteRow, kidInviteRow], error: null }));

      expect(await family.listInvites()).toEqual([
        {
          inviteId: otherInviteId,
          role: "parent",
          permissions: null,
          createdByName: null,
          createdAt: "2026-10-16T09:00:00+00:00",
          expiresAt: "2026-10-23T09:00:00+00:00",
        },
        {
          inviteId,
          role: "kid",
          permissions: kidPermissions,
          createdByName: "Ana",
          createdAt: "2026-10-16T09:00:00+00:00",
          expiresAt: "2026-10-23T09:00:00+00:00",
        },
      ]);
    });

    it("treats a kid invite's unknown levels as off", async () => {
      useRpc(() => ({ data: [{ ...kidInviteRow, permissions: { expenses: "edit", investments: "view" } }], error: null }));

      expect((await family.listInvites())[0].permissions).toEqual({
        expenses: "edit",
        investments: "off",
        net_worth: "off",
        family_finance: "off",
        mcp: "off",
        ai: "off",
      });
    });

    it("translates a non-parent caller into a 403", async () => {
      useRpc(() => ({ data: null, error: { code: "42501", message: "Only parents can see the family's invites." } }));

      await expect(family.listInvites()).rejects.toThrow(new DomainError("Only parents can see the family's invites.", 403));
    });

    it("hides any other database error behind a generic message", async () => {
      useRpc(() => ({ data: null, error: { message: "private database failure" } }));

      await expect(family.listInvites()).rejects.toThrow(new Error("Unable to load the invites."));
    });
  });

  describe("revokeInvite", () => {
    it("calls revoke_family_invite with the invite's id", async () => {
      const { rpcs } = useRpc(() => ({ data: null, error: null }));

      await expect(family.revokeInvite(inviteId)).resolves.toBeUndefined();
      expect(rpcs).toEqual([{ fn: "revoke_family_invite", args: { p_invite_id: inviteId } }]);
    });

    it("translates a non-parent caller into a 403", async () => {
      useRpc(() => ({ data: null, error: { code: "42501", message: "Only parents can revoke invites." } }));

      await expect(family.revokeInvite(inviteId)).rejects.toThrow(new DomainError("Only parents can revoke invites.", 403));
    });

    it("translates an unknown or other-family invite into a 404", async () => {
      useRpc(() => ({ data: null, error: { code: "P0002", message: "That invite wasn't found." } }));

      await expect(family.revokeInvite(inviteId)).rejects.toThrow(new DomainError("That invite wasn't found.", 404));
    });

    it("hides any other database error behind a generic message", async () => {
      useRpc(() => ({ data: null, error: { message: "private database failure" } }));

      await expect(family.revokeInvite(inviteId)).rejects.toThrow(new Error("Unable to revoke the invite."));
    });
  });

  describe("previewInvite", () => {
    const codeHash = "0123456789abcdef".repeat(4);
    const kidPreviewRow = {
      family_name: "The Smiths",
      inviter_name: "Ana",
      role: "kid",
      permissions: kidPermissions,
      expires_at: "2026-10-23T09:00:00+00:00",
    };

    it("calls preview_family_invite with the code's hash", async () => {
      const { rpcs } = useRpc(() => ({ data: [], error: null }));

      await family.previewInvite(codeHash);

      expect(rpcs).toEqual([{ fn: "preview_family_invite", args: { p_code_hash: codeHash } }]);
    });

    it("maps a kid invite with every module", async () => {
      useRpc(() => ({ data: [kidPreviewRow], error: null }));

      expect(await family.previewInvite(codeHash)).toEqual({
        familyName: "The Smiths",
        inviterName: "Ana",
        role: "kid",
        permissions: kidPermissions,
        expiresAt: "2026-10-23T09:00:00+00:00",
      });
    });

    it("maps a parent invite with null permissions and a missing inviter name", async () => {
      useRpc(() => ({ data: [{ ...kidPreviewRow, role: "parent", permissions: null, inviter_name: null }], error: null }));

      expect(await family.previewInvite(codeHash)).toMatchObject({ role: "parent", permissions: null, inviterName: null });
    });

    it("treats a kid invite's unknown levels as off", async () => {
      useRpc(() => ({ data: [{ ...kidPreviewRow, permissions: { expenses: "edit", investments: "view" } }], error: null }));

      expect((await family.previewInvite(codeHash))?.permissions).toEqual({
        expenses: "edit",
        investments: "off",
        net_worth: "off",
        family_finance: "off",
        mcp: "off",
        ai: "off",
      });
    });

    it("returns null for a code that can't be redeemed", async () => {
      useRpc(() => ({ data: [], error: null }));

      expect(await family.previewInvite(codeHash)).toBeNull();
    });

    it("refuses a malformed hash as a server failure, without calling the database", async () => {
      const { rpcs } = useRpc(() => ({ data: [kidPreviewRow], error: null }));

      await expect(family.previewInvite("ABCD2345")).rejects.toThrow(new Error("Unable to check the invite code."));
      expect(rpcs).toEqual([]);
    });

    it("translates a missing caller into a 403", async () => {
      useRpc(() => ({ data: null, error: { code: "42501", message: "Sign in to use an invite code." } }));

      await expect(family.previewInvite(codeHash)).rejects.toThrow(new DomainError("Sign in to use an invite code.", 403));
    });

    it("hides any other database error behind a generic message", async () => {
      useRpc(() => ({ data: null, error: { message: "private database failure" } }));

      await expect(family.previewInvite(codeHash)).rejects.toThrow(new Error("Unable to check the invite code."));
    });
  });

  describe("redeemInvite", () => {
    const codeHash = "0123456789abcdef".repeat(4);

    it("calls redeem_family_invite with the code's hash and returns the new member id", async () => {
      const { rpcs } = useRpc(() => ({ data: kidMemberId, error: null }));

      expect(await family.redeemInvite(codeHash)).toBe(kidMemberId);
      expect(rpcs).toEqual([{ fn: "redeem_family_invite", args: { p_code_hash: codeHash } }]);
    });

    it("refuses a malformed hash as a server failure, without calling the database", async () => {
      const { rpcs } = useRpc(() => ({ data: kidMemberId, error: null }));

      await expect(family.redeemInvite("a".repeat(63))).rejects.toThrow(new Error("Unable to join the family."));
      expect(rpcs).toEqual([]);
    });

    it("translates being already in a family into a 409", async () => {
      useRpc(() => ({ data: null, error: { code: "23505", message: "You're already in a family." } }));

      await expect(family.redeemInvite(codeHash)).rejects.toThrow(new DomainError("You're already in a family.", 409));
    });

    it("translates a code that can't be redeemed into a 404", async () => {
      useRpc(() => ({ data: null, error: { code: "P0002", message: "This code isn't valid anymore." } }));

      await expect(family.redeemInvite(codeHash)).rejects.toThrow(new DomainError("This code isn't valid anymore.", 404));
    });

    it("hides any other database error behind a generic message", async () => {
      useRpc(() => ({ data: null, error: { message: "private database failure" } }));

      await expect(family.redeemInvite(codeHash)).rejects.toThrow(new Error("Unable to join the family."));
    });

    it("treats a missing member id as a failure", async () => {
      useRpc(() => ({ data: null, error: null }));

      await expect(family.redeemInvite(codeHash)).rejects.toThrow(new Error("Unable to join the family."));
    });
  });
});
