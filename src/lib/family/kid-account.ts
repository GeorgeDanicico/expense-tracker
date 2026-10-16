/**
 * The domain of the generated email behind every kid account (`<username>@kids.ifam.invalid`).
 * Kids sign in with their username; the email only exists because the auth provider needs one.
 * `.invalid` is reserved (RFC 2606), so the address can never belong to anyone or receive mail.
 * Change it here only: everything that builds or recognises the address uses this constant.
 */
export const KID_EMAIL_DOMAIN = "kids.ifam.invalid";

/** The generated email of the kid account with this (already validated, lowercase) username. */
export function kidAccountEmail(username: string) {
  return `${username}@${KID_EMAIL_DOMAIN}`;
}
