import { describe, expect, it } from "vitest";

import { toCsv } from "@/lib/account/export";

describe("toCsv", () => {
  it("writes a header with every column, in the order they first appear", () => {
    expect(toCsv([{ a: 1 }, { b: "two", a: 3 }])).toBe("a,b\r\n1,\r\n3,two\r\n");
  });

  it("is empty with no rows", () => {
    expect(toCsv([])).toBe("");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(toCsv([{ text: 'Lunch, "big"\nday' }])).toBe('text\r\n"Lunch, ""big""\nday"\r\n');
  });

  it("writes lists and objects as JSON, and null as an empty cell", () => {
    expect(toCsv([{ list: ["groceries", "car"], nested: { level: "edit" }, none: null, yes: true }])).toBe(
      'list,nested,none,yes\r\n"[""groceries"",""car""]","{""level"":""edit""}",,true\r\n',
    );
  });

  it("keeps text that starts like a formula from running as one, but not numbers", () => {
    expect(toCsv([{ text: "=HYPERLINK(1)", plus: "+1", at: "@me", amount: -12.5 }])).toBe(
      "text,plus,at,amount\r\n'=HYPERLINK(1),'+1,'@me,-12.5\r\n",
    );
  });
});
