import { describe, expect, it } from "vitest";

import {
  getInvestmentGainPresentation,
  getInvestmentValuePresentation,
} from "@/lib/investments/presentation";
import { formatInvestmentAmount } from "@/lib/utils/currency";

describe("investment value presentation", () => {
  it("shows a positive unrealized gain with a green plus sign", () => {
    const presentation = getInvestmentValuePresentation("180", "30", "EUR");

    expect(presentation.value).toBe(formatInvestmentAmount("180", "EUR"));
    expect(presentation.change).toBe(`+${formatInvestmentAmount("30", "EUR")}`);
    expect(presentation.changeColor).toBe("green.700");
    expect(presentation.changeLabel).toBe("Gain");
  });

  it("shows a negative unrealized gain with a red minus sign", () => {
    const presentation = getInvestmentValuePresentation("120", "-30", "EUR");

    expect(presentation.change).toBe(formatInvestmentAmount("-30", "EUR"));
    expect(presentation.changeColor).toBe("red.700");
    expect(presentation.changeLabel).toBe("Loss");
  });

  it("keeps unavailable values neutral", () => {
    const presentation = getInvestmentValuePresentation(null, null, "EUR");

    expect(presentation.value).toBe("Value unavailable");
    expect(presentation.change).toBeNull();
    expect(presentation.changeColor).toBe("gray.500");

    expect(getInvestmentGainPresentation("0", "EUR")).toMatchObject({
      color: "gray.700",
      label: "No change",
      isAvailable: true,
    });
  });
});
