import "server-only";

import type { AuthenticatedUser } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { getCurrentMember } from "@/lib/family/current-member";
import { withUser, type RouteHandler } from "@/lib/http/route";
import { can, type ModuleKey, type ModuleLevel } from "@/lib/permissions";

export const FORBIDDEN_MESSAGE = "You don't have access to this.";

/**
 * `withUser`, plus a family permission check: after authenticating, a caller who may not use
 * `module` at `level` gets 403 `{ error: "You don't have access to this." }` and the handler never
 * runs. Users without a family and parents always pass, and while the family flag is off
 * `getCurrentMember()` returns `null` without a query, so nothing changes. A failure while reading
 * the membership is mapped exactly like a handler error.
 */
export function withPermission<M extends ModuleKey, Req extends Request = Request, Ctx = unknown>(
  module: M,
  level: ModuleLevel<M>,
  handler: (request: Req, user: AuthenticatedUser, context: Ctx) => Promise<Response>,
  options: { failure?: string } = {},
): RouteHandler<Req, Ctx> {
  return withUser<Req, Ctx>(async (request, user, context) => {
    if (!can(await getCurrentMember(), module, level)) throw new DomainError(FORBIDDEN_MESSAGE, 403);
    return handler(request, user, context);
  }, options);
}
