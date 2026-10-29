import { describe, expect, it } from "vitest";

import { maskAccountNumbers } from "@/lib/imports/redact";

describe("maskAccountNumbers", () => {
  it("masks an IBAN written without spaces", () => {
    expect(maskAccountNumbers("Transfer to RO49AAAA1B31007593840000")).toBe("Transfer to …0000");
  });

  it("masks an IBAN written in groups of four", () => {
    expect(maskAccountNumbers("To RO49 AAAA 1B31 0075 9384 0000 rent")).toBe("To …0000 rent");
    expect(maskAccountNumbers("GB29 NWBK 6016 1331 9268 19")).toBe("…6819");
    expect(maskAccountNumbers("DE89 3704 0044 0532 0130 00 salary")).toBe("…3000 salary");
    expect(maskAccountNumbers("NO93 8601 1117 947")).toBe("…7947");
  });

  it("masks invented values with the same shape", () => {
    expect(maskAccountNumbers("RO00FAKE0000000000000000")).toBe("…0000");
    expect(maskAccountNumbers("RO00 FAKE 0000 0000 0000 0001")).toBe("…0001");
  });

  it("masks a lower-case IBAN", () => {
    expect(maskAccountNumbers("ro49aaaa1b31007593840000")).toBe("…0000");
  });

  it("masks several numbers in one text", () => {
    expect(maskAccountNumbers("From DE89370400440532013000 to GB29NWBK60161331926819 ref 4111111111111111"))
      .toBe("From …3000 to …6819 ref …1111");
  });

  it("masks a 16-digit card number, plain or grouped", () => {
    expect(maskAccountNumbers("Card 4111111111111111 payment")).toBe("Card …1111 payment");
    expect(maskAccountNumbers("Card 4111 1111 1111 1111")).toBe("Card …1111");
    expect(maskAccountNumbers("Card 4111-1111-1111-1111 ok")).toBe("Card …1111 ok");
  });

  it("masks any run of 12 or more digits, even inside a word", () => {
    expect(maskAccountNumbers("123456789012")).toBe("…9012");
    expect(maskAccountNumbers("Account 1234567890123456789")).toBe("Account …6789");
    expect(maskAccountNumbers("REF12345678901234")).toBe("REF…1234");
  });

  it("leaves 11 digits alone", () => {
    expect(maskAccountNumbers("12345678901")).toBe("12345678901");
  });

  it.each([
    "Invoice 2026-10 RO",
    "LIDL 12.10.2026 45,20 RON",
    "Card payment 2026-10-03 14:05:09",
    "Payment 1234.56 EUR",
    "Order 2026 1003 ref",
    "RO is a country, RO12 too",
    "Salary October 2026",
    "AUCHAN 0451 BUCURESTI",
    "Phone 0722 123 456",
    "Invoice number 2026100312",
    "",
  ])("does not change %j", (text) => {
    expect(maskAccountNumbers(text)).toBe(text);
  });

  it("is idempotent", () => {
    const once = maskAccountNumbers("RO49 AAAA 1B31 0075 9384 0000 and 4111111111111111");
    expect(once).toBe("…0000 and …1111");
    expect(maskAccountNumbers(once)).toBe(once);
  });

  it("does not need the last group to be full", () => {
    expect(maskAccountNumbers("BE68 5390 0754 7034 thanks")).toBe("…7034 thanks");
  });

  it("masks an IBAN made only of letters after its header, leaving trailing words that hold none", () => {
    expect(maskAccountNumbers("RO00 FAKE FAKE FAKE FAKE FAKE")).toBe("…FAKE FAKE FAKE");
  });

  it("does not swallow a word after an IBAN that ends in a short group of letters", () => {
    expect(maskAccountNumbers("NO93 8601 1117 947 REF")).toBe("…7947 REF");
  });
});
