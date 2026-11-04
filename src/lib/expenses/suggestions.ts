import type { ExpenseCategory, ExpenseSubtype } from "@/lib/expenses/categories";
import type { ClassifiedDescription } from "@/lib/expenses/repository";

/**
 * The expense form's suggestions and category guess ("How the app becomes mobile first", point 3,
 * in docs/ui-plan.md): worked out on the server from the caller's own recent expenses, with no AI
 * and no table of their own. Pure; `GET /api/expenses/suggestions` reads the rows.
 */

/** How many distinct descriptions are remembered, newest first. */
export const SUGGESTION_DESCRIPTIONS = 200;
/** How many of the newest expenses are read to find them (repeats count towards a description's uses). */
export const SUGGESTION_SCAN_ROWS = 1000;
/** How many suggestions the form shows. */
export const SUGGESTION_LIMIT = 5;
/** The longest query looked at, as long as a description can be. */
export const SUGGESTION_QUERY_MAX = 120;

export type Classification = { category: ExpenseCategory; subtype: ExpenseSubtype | null };

/** A description the caller has used, as they last spelled it, with its most used classification. */
export type ExpenseSuggestion = Classification & {
  description: string;
  /** How many of the expenses read have this description. */
  uses: number;
};

/** `GET /api/expenses/suggestions?q=`: the matches, best first, and the guess for `q` as a whole description. */
export type SuggestionsResponse = { suggestions: ExpenseSuggestion[]; guess: Classification | null };

/** How descriptions are compared: case, outer spaces and repeated spaces don't count. */
export function normalizeDescription(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

type Tally = {
  description: string;
  uses: number;
  /** Uses per classification, in the order they were first seen (newest first). */
  classes: Map<string, Classification & { uses: number }>;
};

/**
 * The first `max` distinct descriptions in `rows` (newest first), each with how often it was used
 * and the classification it was given most (the newest of those on a tie), in order of recency.
 */
export function distinctDescriptions(rows: readonly ClassifiedDescription[], max = SUGGESTION_DESCRIPTIONS): ExpenseSuggestion[] {
  const tallies = new Map<string, Tally>();
  for (const row of rows) {
    const key = normalizeDescription(row.description);
    if (!key) continue;
    let tally = tallies.get(key);
    if (!tally) {
      if (tallies.size >= max) continue;
      tally = { description: row.description.trim(), uses: 0, classes: new Map() };
      tallies.set(key, tally);
    }
    tally.uses += 1;
    const classKey = `${row.category}/${row.subtype ?? ""}`;
    const counted = tally.classes.get(classKey) ?? { category: row.category, subtype: row.subtype, uses: 0 };
    counted.uses += 1;
    tally.classes.set(classKey, counted);
  }
  return [...tallies.values()].map(({ description, uses, classes }) => {
    // Map keeps insertion order, so the first of the most used is the newest.
    const best = [...classes.values()].reduce((top, next) => (next.uses > top.uses ? next : top));
    return { description, uses, category: best.category, subtype: best.subtype };
  });
}

/** Whether every word of `query` starts a word of `description` (both normalised). */
function matchesWords(description: string, query: string) {
  const words = description.split(" ");
  return query.split(" ").every((part) => words.some((word) => word.startsWith(part)));
}

/**
 * The descriptions that match `query`: those that start with it first, then those where every word
 * of it starts a word ("bill elec" finds "Electricity bill"). Within each, the most used first, then
 * the newest. An empty query matches nothing.
 */
export function matchSuggestions(known: readonly ExpenseSuggestion[], query: string, limit = SUGGESTION_LIMIT) {
  const typed = normalizeDescription(query);
  if (!typed) return [];
  const ranked = known.flatMap((suggestion, recency) => {
    const description = normalizeDescription(suggestion.description);
    const rank = description.startsWith(typed) ? 0 : matchesWords(description, typed) ? 1 : null;
    return rank === null ? [] : [{ suggestion, rank, recency }];
  });
  ranked.sort((a, b) => a.rank - b.rank || b.suggestion.uses - a.suggestion.uses || a.recency - b.recency);
  return ranked.slice(0, limit).map((entry) => entry.suggestion);
}

/**
 * The category (and subtype) to guess for `description`: the one used most with exactly that
 * description, else the best match's, else none (the form keeps what it has).
 */
export function guessClassification(known: readonly ExpenseSuggestion[], description: string): Classification | null {
  const typed = normalizeDescription(description);
  const match = known.find((suggestion) => normalizeDescription(suggestion.description) === typed) ?? matchSuggestions(known, typed, 1)[0];
  return match ? { category: match.category, subtype: match.subtype } : null;
}

/** The answer to `GET /api/expenses/suggestions?q=` from the caller's newest expenses (newest first). */
export function suggestExpenses(rows: readonly ClassifiedDescription[], query: string): SuggestionsResponse {
  const known = distinctDescriptions(rows);
  const typed = query.slice(0, SUGGESTION_QUERY_MAX);
  return { suggestions: matchSuggestions(known, typed), guess: guessClassification(known, typed) };
}
