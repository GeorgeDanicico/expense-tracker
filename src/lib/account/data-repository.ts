/**
 * Deleting an account's data and reading it for "Download my data" (security plan S13). Get it from
 * `getRepositories()`; never import an implementation.
 *
 * Every method acts as the signed-in caller, whom the database finds from the session: none of them
 * takes the caller's own id, so none can be aimed at someone else. The database checks the family
 * rules and the typed confirmation itself, and refuses with the messages below.
 */

/** The phrase a user types to delete their own account, compared ignoring case and surrounding spaces. */
export const DELETE_ACCOUNT_PHRASE = "delete my account";

/**
 * The database's refusals, word for word (supabase/migrations/20261102000300_…). The fakes and the
 * settings page use the same words.
 */
export const DELETION_REFUSALS = {
  creator: "You created a family, so your account can't be deleted yet. Delete the family first, then delete your account.",
  managed: "A parent manages your account. Ask a parent to delete it from Manage family.",
  member: "You're in a family. Ask the family's creator to remove you, then delete your account.",
  phrase: 'Type "delete my account" to confirm.',
  notParent: "Only a parent can delete a kid's account.",
  notManagedKid: "Only a kid account made for your family can be deleted here. The family's creator can remove other members instead.",
  kidName: "Type the kid's name to confirm.",
} as const;

/**
 * The parts of "Download my data", in the order the ZIP lists them. Each is one call to the
 * database's `export_my_data(section)` and becomes `<section>.json` and `<section>.csv`.
 */
export const EXPORT_SECTIONS = [
  "profile",
  "family_membership",
  "expenses",
  "expense_tabs",
  "categories",
  "investment_accounts",
  "investment_transactions",
  "net_worth_items",
  "net_worth_valuations",
  "reminders",
  "reminder_completions",
  "notification_settings",
  "push_subscriptions",
  "notifications",
  "account_notices",
  "mcp_tokens",
  "calendar_feeds",
  "import_batches",
  "import_rows",
  "import_expenses",
  "ai_usage",
  "todos",
  "calendar_events",
] as const;

export type ExportSection = (typeof EXPORT_SECTIONS)[number];

/** One row of an export section: the database's JSON object for it. */
export type ExportRow = Record<string, unknown>;

/** Reads the caller's export one section at a time, on the session it was opened with. */
export type ExportReader = {
  section(section: ExportSection): Promise<ExportRow[]>;
};

export interface AccountDataRepository {
  /**
   * Deletes everything the caller owns, in one transaction, after `confirm` (the typed
   * `DELETE_ACCOUNT_PHRASE`). The profile row stays until the auth user is deleted. Running it again
   * deletes nothing and succeeds. Refuses (`DomainError`) a family's creator (409), a member of a
   * family (409) and an account a family manages (403), with `DELETION_REFUSALS`' messages.
   */
  deleteMyData(confirm: string): Promise<void>;
  /**
   * A parent deletes everything a kid account made for their family owns, after typing the kid's
   * name, and gets the kid's user id for deleting the auth user. The membership and the profile stay
   * until then. Refuses a caller who isn't a parent (403), an unknown member (404), a member who isn't
   * such a kid (403) and a wrong name (422).
   */
  deleteManagedKidData(memberId: string, confirmName: string): Promise<string>;
  /**
   * Opens the caller's export. Call it inside the request; the reader keeps that request's session,
   * so its sections can be read while the response streams.
   */
  openExport(): Promise<ExportReader>;
}
