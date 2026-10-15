import { DomainError } from "@/lib/errors";

/** The Postgres error codes our SQL raises on purpose (see "Conventions → Migrations"), as HTTP statuses. */
const STATUS_BY_CODE: Record<string, DomainError["status"]> = {
  "42501": 403, // insufficient_privilege: the caller may not do this
  P0002: 404, // no_data_found
  "23514": 422, // check_violation: invalid input
  "23505": 409, // unique_violation, such as "already in a family"
};

/**
 * Translates a Supabase (Postgres) error for the layers above. A known code becomes a `DomainError`
 * that keeps the database's message, so SQL must raise user-facing messages. Any other error becomes
 * a plain `Error` with `fallback`, which routes answer with a 500, keeping the details private.
 *
 * In a Supabase implementation: `if (error) throw translateDatabaseError(error, "Unable to load the family.");`
 */
export function translateDatabaseError(error: { code?: string; message: string }, fallback: string): Error {
  const status = error.code === undefined ? undefined : STATUS_BY_CODE[error.code];
  return status === undefined ? new Error(fallback) : new DomainError(error.message, status);
}
