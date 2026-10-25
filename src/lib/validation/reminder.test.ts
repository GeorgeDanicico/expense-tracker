import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { completeReminderSchema, expenseTemplateSchema, reminderSchema, snoozeSchema } from "@/lib/validation/reminder";

describe("reminderSchema", () => {
  it("trims text and fills defaults", () => {
    expect(reminderSchema.parse({ title: "  Pay rent ", notes: " flat 3 \n", startsOn: "2026-11-30" })).toEqual({
      title: "Pay rent",
      notes: "flat 3",
      startsOn: "2026-11-30",
      timeOfDay: "09:00",
      repeatUnit: "none",
      repeatInterval: 1,
      leadMinutes: [0],
      notificationsMuted: false,
      expenseTemplate: null,
    });
  });

  it("accepts a full repeating reminder and sorts its lead times", () => {
    expect(reminderSchema.parse({
      title: "Pay rent",
      startsOn: "2026-01-31",
      timeOfDay: "18:30",
      repeatUnit: "month",
      repeatInterval: 12,
      leadMinutes: [4320, 0, 1440],
      notificationsMuted: true,
    })).toMatchObject({ repeatUnit: "month", repeatInterval: 12, leadMinutes: [0, 1440, 4320], notificationsMuted: true });
  });

  it("sets a one-off's interval to 1", () => {
    expect(reminderSchema.parse({ title: "Once", startsOn: "2026-11-30", repeatInterval: 5 }).repeatInterval).toBe(1);
  });

  it("accepts the limits", () => {
    expect(reminderSchema.safeParse({
      title: "x".repeat(200), notes: "y".repeat(2000), startsOn: "2028-02-29", timeOfDay: "23:59", leadMinutes: [],
    }).success).toBe(true);
    expect(reminderSchema.safeParse({ title: "Ok", startsOn: "2026-11-30", leadMinutes: [60, 10080, 0] }).success)
      .toBe(true);
  });

  it.each([
    {},
    { startsOn: "2026-11-30" },
    { title: "   ", startsOn: "2026-11-30" },
    { title: "x".repeat(201), startsOn: "2026-11-30" },
    { title: "Ok", notes: "y".repeat(2001), startsOn: "2026-11-30" },
    { title: "Ok" },
    { title: "Ok", startsOn: "2026-02-30" },
    { title: "Ok", startsOn: "30/11/2026" },
    { title: "Ok", startsOn: "2026-11-30", timeOfDay: "24:00" },
    { title: "Ok", startsOn: "2026-11-30", timeOfDay: "9:00" },
    { title: "Ok", startsOn: "2026-11-30", timeOfDay: "09:00:00" },
    { title: "Ok", startsOn: "2026-11-30", repeatUnit: "day" },
    { title: "Ok", startsOn: "2026-11-30", repeatUnit: "month", repeatInterval: 0 },
    { title: "Ok", startsOn: "2026-11-30", repeatUnit: "month", repeatInterval: 13 },
    { title: "Ok", startsOn: "2026-11-30", repeatUnit: "week", repeatInterval: 1.5 },
    { title: "Ok", startsOn: "2026-11-30", leadMinutes: [0, 60, 1440, 4320] },
    { title: "Ok", startsOn: "2026-11-30", leadMinutes: [0, 0] },
    { title: "Ok", startsOn: "2026-11-30", leadMinutes: [30] },
    { title: "Ok", startsOn: "2026-11-30", notificationsMuted: "yes" },
  ])("rejects %j", (input) => {
    expect(reminderSchema.safeParse(input).success).toBe(false);
  });
});

describe("snoozeSchema", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-30T08:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts an hour and tomorrow", () => {
    expect(snoozeSchema.parse({ kind: "hour" })).toEqual({ kind: "hour" });
    expect(snoozeSchema.parse({ kind: "tomorrow" })).toEqual({ kind: "tomorrow" });
  });

  it("accepts a future instant and normalizes it to UTC", () => {
    expect(snoozeSchema.parse({ kind: "until", until: "2026-11-30T12:00:00+02:00" }))
      .toEqual({ kind: "until", until: "2026-11-30T10:00:00.000Z" });
  });

  it.each([
    {},
    { kind: "week" },
    { kind: "until" },
    { kind: "until", until: "tomorrow" },
    { kind: "until", until: "2026-11-30T08:00:00Z" },
    { kind: "until", until: "2026-11-29T12:00:00Z" },
  ])("rejects %j", (input) => {
    expect(snoozeSchema.safeParse(input).success).toBe(false);
  });
});

describe("expenseTemplateSchema", () => {
  const rent = { amount: 650, currency: "EUR", category: "housing", subtype: null };

  it("accepts a template, coercing the amount and uppercasing the currency", () => {
    expect(expenseTemplateSchema.parse({ ...rent, amount: "650.50", currency: "eur" }))
      .toEqual({ amount: 650.5, currency: "EUR", category: "housing", subtype: null });
    expect(expenseTemplateSchema.parse({ amount: 40, currency: "RON", category: "car", subtype: "car_fuel" }))
      .toMatchObject({ category: "car", subtype: "car_fuel" });
  });

  it("defaults the subtype to none", () => {
    expect(expenseTemplateSchema.parse({ amount: 1, currency: "EUR", category: "other" }).subtype).toBeNull();
  });

  it.each([
    [{ ...rent, amount: 0 }, "amount"],
    [{ ...rent, amount: -5 }, "amount"],
    [{ ...rent, amount: 10_000_000_000 }, "amount"],
    [{ ...rent, currency: "XYZ" }, "currency"],
    [{ ...rent, category: "rent" }, "category"],
    [{ ...rent, subtype: "car_fuel" }, "subtype"],
  ])("rejects %j with the expense schema's rule on %s", (template, field) => {
    const parsed = expenseTemplateSchema.safeParse(template);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path[0])).toContain(field);
  });

  it("is optional on a reminder, and validated there", () => {
    const base = { title: "Pay rent", startsOn: "2026-11-30" };
    expect(reminderSchema.parse(base).expenseTemplate).toBeNull();
    expect(reminderSchema.parse({ ...base, expenseTemplate: null }).expenseTemplate).toBeNull();
    expect(reminderSchema.parse({ ...base, expenseTemplate: rent }).expenseTemplate).toEqual(rent);
    const invalid = reminderSchema.safeParse({ ...base, expenseTemplate: { ...rent, amount: 0 } });
    expect(invalid.error?.flatten().fieldErrors).toEqual({ expenseTemplate: ["Amount must be greater than zero."] });
  });
});

describe("completeReminderSchema", () => {
  it("defaults to only marking done", () => {
    expect(completeReminderSchema.parse({})).toEqual({ logExpense: false });
  });

  it("takes the occurrence and an amount", () => {
    expect(completeReminderSchema.parse({ logExpense: true, occurrenceOn: "2026-11-01", amount: "12.5" }))
      .toEqual({ logExpense: true, occurrenceOn: "2026-11-01", amount: 12.5 });
  });

  it.each([{ logExpense: "yes" }, { occurrenceOn: "2026-02-30" }, { amount: 0 }])("rejects %j", (body) => {
    expect(completeReminderSchema.safeParse(body).success).toBe(false);
  });
});
