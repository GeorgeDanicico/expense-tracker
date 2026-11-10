import "server-only";

import type { AuthenticatedUser } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { getCurrentMember } from "@/lib/family/current-member";
import { requireFamilyFeature } from "@/lib/family/feature";
import type { CurrentMember } from "@/lib/family/repository";
import { withUser, type RouteHandler, type WithUserOptions } from "@/lib/http/route";
import { can, type ModuleKey, type ModuleLevel } from "@/lib/permissions";

/** The one forbidden message for every permission refusal of the route wrappers and MCP tools. */
export const FORBIDDEN_MESSAGE = "You don't have access to this.";

/**
 * The caller's membership, after checking they may use `module` at `level`: a 403 with
 * `FORBIDDEN_MESSAGE` otherwise. Users without a family and parents always pass, and while the family
 * flag is off `getCurrentMember()` returns `null` without a query, so nothing changes.
 *
 * `withPermission` runs it before a handler. Call it directly only for a check that depends on the
 * request, like `POST /api/reminders/[id]/complete` with `logExpense` (it adds an expense, so it needs
 * `expenses`), and list that route in src/app/api/permissions.test.ts.
 */
export async function requirePermission<M extends ModuleKey>(module: M, level: ModuleLevel<M>): Promise<CurrentMember | null> {
  const member = await getCurrentMember();
  if (!can(member, module, level)) throw new DomainError(FORBIDDEN_MESSAGE, 403);
  return member;
}

/**
 * `withUser`, plus a family permission check: after authenticating, a caller who may not use
 * `module` at `level` gets 403 `{ error: "You don't have access to this." }` and the handler never
 * runs (`requirePermission`). A failure while reading the membership is mapped exactly like a
 * handler error.
 *
 * The handler gets the membership it was checked against as its fourth argument (`null` without a
 * family or while the flag is off); finance reads pass it to `resolveViewedUser`. The membership is
 * read alongside `withUser`'s password check (`readAlongside`), not after it.
 */
export function withPermission<M extends ModuleKey, Req extends Request = Request, Ctx = unknown>(
  module: M,
  level: ModuleLevel<M>,
  handler: (request: Req, user: AuthenticatedUser, context: Ctx, member: CurrentMember | null) => Promise<Response>,
  options: WithUserOptions = {},
): RouteHandler<Req, Ctx> {
  return withUser<Req, Ctx>(async (request, user, context) => {
    const member = await requirePermission(module, level);
    return handler(request, user, context, member);
  }, { ...options, readAlongside: getCurrentMember });
}

/**
 * `withUser` for a family route only parents may use, for the ones whose work starts outside the
 * database (`POST /api/family/kids` creates the account with the admin client, which no SQL rule
 * sees). While the family flag is off it answers 404 like every family route; then a caller who isn't
 * a parent of a family gets 403 with `FORBIDDEN_MESSAGE` and the handler never runs. The handler gets
 * the parent's membership as its fourth argument.
 *
 * Family writes that go straight to an RPC keep plain `withUser`: the RPC checks the role itself.
 */
export function withParent<Req extends Request = Request, Ctx = unknown>(
  handler: (request: Req, user: AuthenticatedUser, context: Ctx, parent: CurrentMember) => Promise<Response>,
  options: WithUserOptions = {},
): RouteHandler<Req, Ctx> {
  return withUser<Req, Ctx>(async (request, user, context) => {
    requireFamilyFeature();
    const member = await getCurrentMember();
    if (member?.role !== "parent") throw new DomainError(FORBIDDEN_MESSAGE, 403);
    return handler(request, user, context, member);
  }, { ...options, readAlongside: getCurrentMember });
}
