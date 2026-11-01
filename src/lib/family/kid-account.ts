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

/**
 * The address sign-in tries for a username no account has, so an unknown username goes through the
 * same provider call as a real one and answers alike, in about the same time (audit B7). No account
 * can have it: usernames start with a letter or number, and sign-up refuses `KID_EMAIL_DOMAIN`.
 */
export const UNKNOWN_USERNAME_EMAIL = `_unknown-username@${KID_EMAIL_DOMAIN}`;

/** Whether `email` is a kid account's generated address (any case), which never reaches the browser. */
export function isKidAccountEmail(email: string) {
  return email.toLowerCase().endsWith(`@${KID_EMAIL_DOMAIN}`);
}

/** The account's email for its owner to see: `null` for a kid's generated address. */
export function visibleEmail(email: string): string | null {
  return isKidAccountEmail(email) ? null : email;
}

/**
 * What the app shows as "signed in as": the email, or for a kid account that has only its generated
 * address, the username (the address's part before the `@`).
 */
export function signInName(email: string): string {
  return isKidAccountEmail(email) ? email.slice(0, email.lastIndexOf("@")) : email;
}
