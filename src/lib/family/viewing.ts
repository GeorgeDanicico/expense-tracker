/** The query parameter a finance read takes to show another family member's data. */
export const MEMBER_PARAM = "member";

/** The `?member=` value for the combined family view (F46 expenses, F47 investments and net worth); the other finance reads answer 404 to it. */
export const ALL_MEMBERS = "all";

/**
 * Whose data a finance read shows. Every finance GET response carries it as `viewing`; the page
 * passes `?member=<memberId>` to see another member's data. Safe to import from the frontend.
 * - `memberId`: the viewed member's id, or the caller's own (null for a caller without a family).
 * - `displayName`: the viewed member's name; null when viewing yourself (the UI says "Me").
 * - `readOnly`: true when viewing someone else. Writes always act on the caller.
 * - `currency`: the viewed member's currency, so amounts get the right symbol; null when viewing
 *   yourself (use your own account currency).
 */
export type Viewing = { memberId: string | null; displayName: string | null; currency: string | null; readOnly: boolean };
