import { describe, expect, it } from "vitest";

import { defaultExecutedAt, executedAtInstant, orderInput } from "@/components/investments/order-fields";

// Audit D9: order times are on the application's clock (Europe/Bucharest), wherever the device is.
describe("order times", () => {
  it("fills the field from Bucharest's clock", () => {
    expect(defaultExecutedAt(new Date("2026-10-12T21:30:00Z"))).toBe("2026-10-13T00:30");
    expect(defaultExecutedAt(new Date("2026-12-12T21:30:00Z"))).toBe("2026-12-12T23:30");
  });

  it("reads a typed time as Bucharest time, summer and winter", () => {
    expect(executedAtInstant("2026-10-12T09:30")).toBe("2026-10-12T06:30:00.000Z");
    expect(executedAtInstant("2026-12-12T09:30")).toBe("2026-12-12T07:30:00.000Z");
  });

  it("sends what it cannot read as typed, for the server to refuse", () => {
    expect(executedAtInstant("")).toBe("");
    expect(executedAtInstant("soon")).toBe("soon");
  });

  it("builds the order from the form's fields", () => {
    const form = new FormData();
    form.set("amount", "1300.00");
    form.set("quantity", "10");
    form.set("unitPrice", "130.00");
    form.set("executedAt", "2026-10-12T09:30");
    expect(orderInput({ brokerId: "xtb", instrument: "VWCE.DE", currency: "EUR", side: "sell" }, form)).toEqual({
      brokerId: "xtb", instrument: "VWCE.DE", currency: "EUR", side: "sell",
      amount: "1300.00", quantity: "10", unitPrice: "130.00", executedAt: "2026-10-12T06:30:00.000Z",
    });
  });
});
