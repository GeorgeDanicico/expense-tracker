import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedUser } from "@/lib/auth";
import { forgetLastActive } from "@/lib/family/last-active";
import { hashInviteCode } from "@/lib/family/invite-code";
import { KID_EMAIL_DOMAIN } from "@/lib/family/kid-account";
import { PARENT_PERMISSIONS, type FamilyData } from "@/lib/family/repository";
import { resetRateLimits } from "@/lib/http/rate-limit";
import { hashMcpToken } from "@/lib/mcp/tokens";
import { DEFAULT_KID_PERMISSIONS } from "@/lib/permissions";
import { aFamily, aFamilyMember, aKid, aParent, anInvite } from "@/test/builders";
import { FakeAuth } from "@/test/fakes/auth";
import { FakeOAuthConsent } from "@/test/fakes/oauth-consent";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs, testUser } from "@/test/route";

let auth: FakeAuth;
let consent: FakeOAuthConsent;

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(), getOAuthConsent: () => consent }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET as GET_ACCOUNT } from "@/app/api/account/route";
import { GET as GET_MCP } from "@/app/api/account/mcp/route";
import { GET as GET_APPS } from "@/app/api/account/mcp/apps/route";
import { POST as CREATE_TOKEN } from "@/app/api/account/mcp/tokens/route";
import { GET as GET_FAMILY } from "@/app/api/family/route";
import { GET as LIST_INVITES, POST as CREATE_INVITE } from "@/app/api/family/invites/route";
import { POST as PREVIEW_INVITE } from "@/app/api/family/join/preview/route";
import { PATCH as SET_PERMISSIONS } from "@/app/api/family/members/[id]/permissions/route";
import { GET as GET_AUTHORIZATION } from "@/app/api/oauth/authorizations/[id]/route";

// Security plan S9: what the account, family, members, invites, MCP and OAuth routes send to the
// browser. Every field in these snapshots has a reader in src/components, src/hooks or a page; a
// new field (or an old one coming back) shows up here as a snapshot change to justify. Beyond the
// snapshots, no body may carry a kid's generated address, an auth user id, or another member's email.
//
// Random values (new ids, secrets, invite codes) are replaced by placeholders; everything else is
// fixed, the clock included.

const NOW = new Date("2026-11-02T10:00:00.000Z");
const KID_USER: AuthenticatedUser = { id: "10000000-0000-4000-8000-000000000002", email: `teo@${KID_EMAIL_DOMAIN}` };
const KID_MEMBER_ID = "60000000-0000-4000-8000-000000000002";
const OTHER_PARENT_EMAIL = "second-parent@example.test";
const CODE = "ABCD2345";

let repositories: FakeRepositories;

/** Replaces values a run makes up, so the snapshot only changes when the shape or a fixed value does. */
function stable(body: unknown): unknown {
  return JSON.parse(
    JSON.stringify(body)
      .replaceAll(/sl_mcp_[A-Za-z0-9_-]{43}/g, "<secret>")
      .replaceAll(/sl_mcp_[A-Za-z0-9_-]{6}/g, "<prefix>")
      .replaceAll(/"code":"[A-Z0-9]{8}"/g, '"code":"<code>"')
      .replaceAll(/\/join\/[A-Z0-9]{8}/g, "/join/<code>")
      .replaceAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>"),
  );
}

/** The fields no response may carry, checked on every body here as well as by the snapshots. */
function expectNoPrivateFields(body: unknown) {
  const text = JSON.stringify(body);
  expect(text).not.toContain(KID_EMAIL_DOMAIN);
  expect(text).not.toContain('"userId"');
  expect(text).not.toContain(OTHER_PARENT_EMAIL);
  expect(text).not.toMatch(/token_?hash|codeHash/i);
}

async function shapeOf(response: Promise<{ status: number; body: unknown }>) {
  const { status, body } = await response;
  expectNoPrivateFields(body);
  return { status, body: stable(body) };
}

function signIn(user: AuthenticatedUser) {
  signedInAs(user);
  auth.currentUser = user;
  repositories.mcpTokens.caller = { userId: user.id };
}

/** The Smiths as their creator sees them: the creator, a second parent and a kid with a username. */
function smithsForAParent(): FamilyData {
  const family = aFamily();
  family.members.push(
    aFamilyMember({
      memberId: "60000000-0000-4000-8000-000000000003",
      userId: "10000000-0000-4000-8000-000000000003",
      role: "parent",
      displayName: OTHER_PARENT_EMAIL.split("@")[0],
      username: null,
      color: 3,
      avatarUrl: "/api/avatars/10000000-0000-4000-8000-000000000003/0a1b2c3d-0000-4000-8000-000000000000.webp",
      lastActiveAt: "2026-11-01T18:00:00.000Z",
      permissions: PARENT_PERMISSIONS,
    }),
    aFamilyMember({ memberId: KID_MEMBER_ID, userId: KID_USER.id, displayName: "Teo", username: "teo" }),
  );
  return family;
}

/** The same family as the kid sees it: other members' last activity and permissions are hidden. */
function smithsForTheKid(): FamilyData {
  const family = smithsForAParent();
  family.members = family.members.map((member) => {
    if (member.memberId === KID_MEMBER_ID) return member;
    const visible = { ...member };
    delete visible.lastActiveAt;
    delete visible.permissions;
    return visible;
  });
  return family;
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.stubEnv("FAMILY_ENABLED", "true");
  resetRateLimits();
  forgetLastActive();
  repositories = resetFakeRepositories();
  auth = new FakeAuth();
  consent = new FakeOAuthConsent(auth);
  signIn(testUser);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("account", () => {
  it("GET /api/account for a parent", async () => {
    repositories.family.membership = aParent();
    repositories.account.currencies.set(testUser.id, "RON");

    expect(await shapeOf(callRoute(GET_ACCOUNT))).toMatchSnapshot();
  });

  it("GET /api/account for a kid with only the generated address: no email, the username to show", async () => {
    signIn(KID_USER);
    repositories.family.membership = aKid();
    repositories.account.mustChangePassword.add(KID_USER.id);

    const shape = await shapeOf(callRoute(GET_ACCOUNT));

    expect(shape.body).toMatchObject({ email: null, signInName: "teo" });
    expect(shape).toMatchSnapshot();
  });
});

describe("family and members", () => {
  it("GET /api/family for a parent", async () => {
    repositories.family.membership = aParent();
    repositories.family.family = smithsForAParent();

    expect(await shapeOf(callRoute(GET_FAMILY))).toMatchSnapshot();
  });

  it("GET /api/family for a kid", async () => {
    signIn(KID_USER);
    repositories.family.membership = aKid();
    repositories.family.family = smithsForTheKid();

    expect(await shapeOf(callRoute(GET_FAMILY))).toMatchSnapshot();
  });

  it("PATCH /api/family/members/[id]/permissions answers the family like GET", async () => {
    repositories.family.membership = aParent();
    repositories.family.family = smithsForAParent();

    const shape = await shapeOf(callRoute(SET_PERMISSIONS, {
      method: "PATCH",
      body: { permissions: { ...DEFAULT_KID_PERMISSIONS, investments: "edit" } },
      params: { id: KID_MEMBER_ID },
    }));

    expect(shape.status).toBe(200);
    expect(shape.body).toEqual(await shapeOf(callRoute(GET_FAMILY)).then((get) => get.body));
  });
});

describe("invites", () => {
  beforeEach(() => {
    repositories.family.membership = aParent();
    repositories.family.family = smithsForAParent();
    repositories.family.invites.push(
      anInvite({ codeHash: hashInviteCode(CODE) }),
      anInvite({
        inviteId: "80000000-0000-4000-8000-000000000002",
        codeHash: "b".repeat(64),
        role: "parent",
        permissions: null,
        createdAt: "2026-10-02T09:00:00.000Z",
      }),
    );
  });

  it("GET /api/family/invites", async () => {
    expect(await shapeOf(callRoute(LIST_INVITES))).toMatchSnapshot();
  });

  it("POST /api/family/invites", async () => {
    expect(await shapeOf(callRoute(CREATE_INVITE, { method: "POST", body: { role: "kid", permissions: DEFAULT_KID_PERMISSIONS } })))
      .toMatchSnapshot();
  });

  it("POST /api/family/join/preview", async () => {
    signIn({ id: "10000000-0000-4000-8000-000000000009", email: "newcomer@example.test" });
    repositories.family.membership = null;

    expect(await shapeOf(callRoute(PREVIEW_INVITE, { method: "POST", body: { code: CODE } }))).toMatchSnapshot();
  });
});

describe("MCP", () => {
  beforeEach(async () => {
    repositories.mcpTokens.users.set(testUser.id, { email: testUser.email, enabled: true, kid: null });
    await repositories.mcpTokens.create({
      name: "Home server",
      hash: hashMcpToken(`sl_mcp_${"h".repeat(43)}`),
      prefix: "sl_mcp_hhhhhh",
      expiry: "3m",
    });
    consent.addGrant(testUser.id, { clientId: "client-a", uri: "https://claude.ai", logoUri: "https://claude.ai/logo.png" }, "2026-10-20T08:00:00.000Z");
  });

  it("GET /api/account/mcp: the switch, access, token list and connected apps", async () => {
    expect(await shapeOf(callRoute(GET_MCP))).toMatchSnapshot();
  });

  it("GET /api/account/mcp/apps", async () => {
    expect(await shapeOf(callRoute(GET_APPS))).toMatchSnapshot();
  });

  it("POST /api/account/mcp/tokens: the one response with a secret", async () => {
    expect(await shapeOf(callRoute(CREATE_TOKEN, { method: "POST", body: { name: "VPS", expiry: "1m" } }))).toMatchSnapshot();
  });
});

describe("OAuth", () => {
  const app = { clientId: "client-a", name: "Claude Code (ifam)", uri: "https://claude.ai", logoUri: "https://claude.ai/logo.png" };
  const details = (id: string) => callRoute(GET_AUTHORIZATION, { params: { id } });

  it("GET /api/oauth/authorizations/[id] asking for consent", async () => {
    repositories.mcpTokens.users.set(testUser.id, { email: testUser.email, enabled: true, kid: null });
    const id = consent.addRequest(testUser.id, { app, scopes: ["email", "profile"] });

    expect(await shapeOf(details(id))).toMatchSnapshot();
  });

  it("GET /api/oauth/authorizations/[id] refusing a kid with only the generated address", async () => {
    signIn(KID_USER);
    repositories.mcpTokens.users.set(KID_USER.id, { email: KID_USER.email, enabled: true, kid: { mcp: true } });
    const id = consent.addRequest(KID_USER.id, { app });

    const shape = await shapeOf(details(id));

    expect(shape.body).toMatchObject({ kind: "refused", reason: "email_required", signInName: "teo" });
    expect(shape).toMatchSnapshot();
  });

  it("GET /api/oauth/authorizations/[id] for an app the caller already allowed", async () => {
    repositories.mcpTokens.users.set(testUser.id, { email: testUser.email, enabled: true, kid: null });
    const id = consent.addRequest(testUser.id, { app, alreadyApproved: true });

    expect(await shapeOf(details(id))).toMatchSnapshot();
  });
});
