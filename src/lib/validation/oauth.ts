/** What every OAuth authorization route answers for a request it can't find, or that isn't the caller's. */
export const AUTHORIZATION_NOT_FOUND = "That authorization request doesn't exist or has expired.";

// Supabase's ids are URL-safe tokens. Anything else is refused before it reaches the provider, whose
// client puts the id into a URL path unencoded.
const AUTHORIZATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Whether `value` looks like an OAuth authorization id (the consent page's `authorization_id`). */
export function isAuthorizationId(value: string) {
  return AUTHORIZATION_ID_PATTERN.test(value);
}
