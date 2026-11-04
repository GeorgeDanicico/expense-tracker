import { describe, expect, it } from "vitest";

import type { ClassifiedDescription } from "@/lib/expenses/repository";
import {
  distinctDescriptions,
  guessClassification,
  matchSuggestions,
  suggestExpenses,
  SUGGESTION_DESCRIPTIONS,
} from "@/lib/expenses/suggestions";

const row = (description: string, category: ClassifiedDescription["category"] = "groceries", subtype: ClassifiedDescription["subtype"] = null) =>
  ({ description, category, subtype });

// Newest first, as the repository answers.
const ROWS = [
  row("Coffee", "entertainment"),
  row("Fuel", "car", "car_fuel"),
  row("coffee ", "entertainment"),
  row("Electricity bill", "utilities"),
  row("Coffee beans"),
  row("Fuel", "car", "car_fuel"),
  row("Coffee", "other"),
  row("Cola"),
  row("Fuel", "transport"),
];

describe("distinctDescriptions", () => {
  it("keeps each description once, newest first, spelled as last used, with its uses", () => {
    expect(distinctDescriptions(ROWS).map(({ description, uses }) => [description, uses])).toEqual([
      ["Coffee", 3], ["Fuel", 3], ["Electricity bill", 1], ["Coffee beans", 1], ["Cola", 1],
    ]);
  });

  it("gives each one its most used category and subtype", () => {
    const [coffee, fuel] = distinctDescriptions(ROWS);
    expect(coffee).toMatchObject({ category: "entertainment", subtype: null });
    expect(fuel).toMatchObject({ category: "car", subtype: "car_fuel" });
  });

  it("takes the newest classification on a tie", () => {
    expect(distinctDescriptions([row("Lidl", "shopping"), row("Lidl", "groceries")])[0].category).toBe("shopping");
  });

  it("remembers at most 200 descriptions, still counting later uses of those", () => {
    const many = Array.from({ length: SUGGESTION_DESCRIPTIONS + 5 }, (_, index) => row(`Shop ${index}`));
    const known = distinctDescriptions([...many, row("Shop 0")]);
    expect(known).toHaveLength(SUGGESTION_DESCRIPTIONS);
    expect(known[0]).toMatchObject({ description: "Shop 0", uses: 2 });
    expect(known.some((suggestion) => suggestion.description === `Shop ${SUGGESTION_DESCRIPTIONS}`)).toBe(false);
  });
});

describe("matchSuggestions", () => {
  const known = distinctDescriptions(ROWS);

  it("ranks the descriptions that start with the query first, the most used first", () => {
    expect(matchSuggestions(known, "co").map((suggestion) => suggestion.description)).toEqual(["Coffee", "Coffee beans", "Cola"]);
  });

  it("then the ones where every word of the query starts a word", () => {
    expect(matchSuggestions(known, "bill").map((suggestion) => suggestion.description)).toEqual(["Electricity bill"]);
    expect(matchSuggestions(known, "bill elec").map((suggestion) => suggestion.description)).toEqual(["Electricity bill"]);
    expect(matchSuggestions(known, "beans").map((suggestion) => suggestion.description)).toEqual(["Coffee beans"]);
  });

  it("ignores case and spaces, matches nothing for an empty query, and stops at the limit", () => {
    expect(matchSuggestions(known, "  COFFEE ").map((suggestion) => suggestion.description)).toEqual(["Coffee", "Coffee beans"]);
    expect(matchSuggestions(known, "   ")).toEqual([]);
    expect(matchSuggestions(known, "c", 2)).toHaveLength(2);
  });
});

describe("guessClassification", () => {
  const known = distinctDescriptions(ROWS);

  it("guesses a known description's most used category and subtype", () => {
    expect(guessClassification(known, "fuel")).toEqual({ category: "car", subtype: "car_fuel" });
  });

  it("prefers the exact description over a longer one that starts the same", () => {
    expect(guessClassification(known, "Coffee")).toEqual({ category: "entertainment", subtype: null });
  });

  it("guesses from a similar description", () => {
    expect(guessClassification(known, "electricity")).toEqual({ category: "utilities", subtype: null });
  });

  it("guesses nothing for an unknown description", () => {
    expect(guessClassification(known, "Dentist")).toBeNull();
    expect(guessClassification(known, "")).toBeNull();
  });
});

describe("suggestExpenses", () => {
  it("answers the matches and the guess together", () => {
    expect(suggestExpenses(ROWS, "fu")).toEqual({
      suggestions: [{ description: "Fuel", uses: 3, category: "car", subtype: "car_fuel" }],
      guess: { category: "car", subtype: "car_fuel" },
    });
  });
});
