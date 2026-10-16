import { getAuth } from "@/lib/auth";
import { HttpError, noContent, parseBody, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { changePasswordSchema } from "@/lib/validation/password";

/**
 * Sets a new password for the signed-in user, then clears their "must change password" flag.
 * The flag lives in `profiles`, so the user's own session clears it; when the provider refuses the
 * password, the flag stays set.
 */
export const POST = withUser(async (request) => {
  const { password } = await parseBody(request, changePasswordSchema, "Check the highlighted details and try again.");

  const updated = await getAuth().updatePassword(password);
  if (!updated.ok) throw new HttpError(400, updated.reason);

  await getRepositories().account.completePasswordChange();
  return noContent();
}, { failure: "Unable to change your password. Please try again." });
