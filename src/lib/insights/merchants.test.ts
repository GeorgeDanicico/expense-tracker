import { describe, expect, it } from "vitest";

import { merchantOf } from "@/lib/insights/merchants";

const key = (description: string) => merchantOf(description)?.key ?? null;

describe("merchantOf", () => {
  it("groups a brand's stores, cities and purchase notes under the brand", () => {
    for (const description of ["Kaufland", "Kaufland Satu Mare", "Kaufland Cluj-Manastur", "Kaufland meal-ticket purchase", "KAUFLAND groceries"]) {
      expect(merchantOf(description)).toEqual({ key: "kaufland", label: "Kaufland" });
    }
  });

  it("finds a brand anywhere in the description, as whole words", () => {
    expect(merchantOf("Abonament chatgpt")?.label).toBe("ChatGPT");
    expect(merchantOf("Abonament chat gpt")?.label).toBe("ChatGPT");
    expect(merchantOf("Carrefour meal-ticket purchase")?.label).toBe("Carrefour");
    expect(merchantOf("Bolt Services RO")?.label).toBe("Bolt");
    expect(merchantOf("Bolt Tallinn")?.label).toBe("Bolt");
    expect(merchantOf("Apple.com/bill")?.label).toBe("Apple");
    expect(merchantOf("NETFLIX.COM Amsterdam")?.label).toBe("Netflix");
    expect(merchantOf("Answear.ro")?.label).toBe("Answear");
    expect(merchantOf("OMV 1642 Satu Mare")?.label).toBe("OMV");
    expect(merchantOf("Bolton Street Cafe")?.label).toBe("Bolton Street Cafe");
  });

  it("prefers the longer brand name", () => {
    expect(merchantOf("Mega Image 0042")?.label).toBe("Mega Image");
    expect(merchantOf("HBO Max")?.label).toBe("HBO Max");
  });

  it("drops a city, a store number or a company form after an unknown merchant", () => {
    expect(merchantOf("Corner Bakery 219 Satu Mare")).toEqual({ key: "corner bakery", label: "Corner Bakery" });
    expect(key("Corner Bakery 226 Satu Mare")).toBe("corner bakery");
    expect(key("Dersidan SRL")).toBe("dersidan");
    expect(key("Dersidan Satu Mare")).toBe("dersidan");
    expect(key("Street Food Cluj-Napoca")).toBe("street food");
    expect(key("Delivery Solutions SA")).toBe("delivery solutions");
  });

  it("keeps the merchant's own spelling in the label", () => {
    expect(merchantOf("Kt iRat Medica Satu Mare")?.label).toBe("Kt iRat Medica");
  });

  it("ignores case, spaces and diacritics in the key", () => {
    expect(key("  abonament   SALĂ ")).toBe(key("Abonament sala"));
  });

  it("names no merchant for a generic description", () => {
    for (const description of ["Groceries", "Transport", "Public transport", "Ride", "Meal", "Fuel", "Retail purchase", "Personal care purchase", "Bank service fee", "ATM cash withdrawal", "Personal transfer", "Cadou", "", "   ", "123"]) {
      expect(merchantOf(description)).toBeNull();
    }
  });

  it("names a merchant when a generic word comes with a specific one", () => {
    expect(key("Abonament sala")).toBe("abonament sala");
    expect(key("Bank Premium Club subscription")).toBe("bank premium club subscription");
  });

  it("never strips the whole name", () => {
    expect(key("Satu Mare")).toBe("satu mare");
  });
});
