import { DomainError } from "@/lib/errors";

/** A Supabase (PostgREST) error, as far as the translator reads it. */
export type DatabaseError = { code?: string; message: string; hint?: string | null };

/**
 * The hint our own SQL puts on a message written for users:
 * `raise exception '…' using errcode = '…', hint = 'user'`. Postgres never sets it on its own errors
 * (row-level security, check and unique constraints, missing grants), and
 * supabase/tests/security_definer.sql checks that every `raise exception` of ours carries it.
 */
export const USER_FACING_HINT = "user";

type Status = DomainError["status"];

/** The Postgres error codes the app expects (see "Conventions → Migrations"), as HTTP statuses. */
const STATUS_BY_CODE: Record<string, Status> = {
  "42501": 403, // insufficient_privilege: an RLS refusal, or our own "only parents can…"
  P0002: 404, // no_data_found
  "23514": 422, // check_violation: invalid input
  "22023": 422, // invalid_parameter_value: our functions' "the input is wrong"
  "23505": 409, // unique_violation, such as "already in a family"
  "55000": 409, // object_not_in_prerequisite_state: "that import was already confirmed"
};

export type TranslateOptions = {
  /** Statuses for codes the shared map doesn't know, or that mean something else here (the token cap's P0001 → 409). */
  statuses?: Partial<Record<string, Status>>;
  /**
   * This call's own message for a code, used whoever raised it (in place of a marked message too),
   * for example "A valuation for this date already exists." for a unique violation.
   */
  messages?: Partial<Record<string, string>>;
};

/** Whether our own SQL raised this error with a message written for users (`hint = 'user'`). */
export function isUserFacing(error: DatabaseError): boolean {
  return error.hint === USER_FACING_HINT;
}

/**
 * Translates a Supabase (Postgres) error for the layers above; every repository throws through it.
 *
 * - A code with a status (the shared map, or `statuses`) becomes a `DomainError` with that status, so
 *   a unique violation is a 409, an RLS refusal a 403 and so on, in every repository. Its message is
 *   `messages[code]` when given, else the database's message **only** when our SQL marked it as
 *   user-facing (`isUserFacing`), else `fallback`. Postgres' own messages, which name tables,
 *   policies and constraints, never reach the client.
 * - Any other error becomes a plain `Error` with `fallback`, which routes answer with a 500, keeping
 *   the details private.
 *
 * In a Supabase implementation: `if (error) throw translateDatabaseError(error, "Unable to load the family.");`
 */
export function translateDatabaseError(
  error: DatabaseError,
  fallback: string,
  { statuses = {}, messages = {} }: TranslateOptions = {},
): Error {
  const code = error.code;
  const status = code === undefined ? undefined : statuses[code] ?? STATUS_BY_CODE[code];
  if (code === undefined || status === undefined) return new Error(fallback);
  const message = messages[code] ?? (isUserFacing(error) ? error.message : fallback);
  return new DomainError(message, status);
}
