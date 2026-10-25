import { describe, expect, it } from "vitest";

import {
  planReminderNotification,
  reminderBody,
  reminderDedupeKey,
  reminderPayload,
  reminderUrl,
  type NotifiableReminder,
} from "@/lib/reminders/notification";

const BUCHAREST = "Europe/Bucharest";

function reminder(values: Partial<NotifiableReminder> = {}): NotifiableReminder {
  return {
    id: "r1",
    title: "Pay rent",
    startsOn: "2026-10-31",
    timeOfDay: "09:00",
    timezone: BUCHAREST,
    repeatUnit: "month",
    repeatInterval: 1,
    leadMinutes: [0],
    notificationsMuted: false,
    nextDueOn: "2026-10-31",
    snoozedUntil: null,
    ...values,
  };
}

describe("reminderBody", () => {
  it("says today, tomorrow, in N days or now, on the reminder's wall clock", () => {
    const due = reminder({ nextDueOn: "2026-10-31" });
    // 31 October 09:00 in Bucharest (EET, UTC+2) is 07:00 UTC.
    expect(reminderBody(due, new Date("2026-10-31T06:00:00Z"))).toBe("Due today at 09:00");
    expect(reminderBody(due, new Date("2026-10-30T07:00:00Z"))).toBe("Due tomorrow at 09:00");
    expect(reminderBody(due, new Date("2026-10-28T07:00:00Z"))).toBe("Due in 3 days, Sat 31 Oct");
    expect(reminderBody(due, new Date("2026-10-31T07:00:00Z"))).toBe("Due now");
    expect(reminderBody(due, new Date("2026-11-01T07:00:00Z"))).toBe("Due now");
  });

  it("counts days by the local date, not the UTC one", () => {
    // 22:30 UTC on 30 October is already 00:30 on the 31st in Bucharest.
    expect(reminderBody(reminder(), new Date("2026-10-30T22:30:00Z"))).toBe("Due today at 09:00");
  });

  it("words a lead time across the autumn DST change", () => {
    // Summer time ends at 04:00 on Sunday 25 October 2026. 09:00 the day before is 06:00 UTC (EEST).
    const sunday = reminder({ nextDueOn: "2026-10-25" });
    expect(reminderBody(sunday, new Date("2026-10-24T06:00:00Z"))).toBe("Due tomorrow at 09:00");
    const tuesday = reminder({ nextDueOn: "2026-10-27" });
    expect(reminderBody(tuesday, new Date("2026-10-24T06:00:00Z"))).toBe("Due in 3 days, Tue 27 Oct");
    const monday = reminder({ nextDueOn: "2026-10-26" });
    expect(reminderBody(monday, new Date("2026-10-25T07:00:00Z"))).toBe("Due tomorrow at 09:00");
  });

  it("words a lead time across the spring DST change, and a skipped time as it falls", () => {
    // Summer time starts at 03:00 on Sunday 28 March 2027; 03:30 that day doesn't exist and is 04:00.
    const skipped = reminder({ nextDueOn: "2027-03-28", timeOfDay: "03:30" });
    expect(reminderBody(skipped, new Date("2027-03-28T00:30:00Z"))).toBe("Due today at 04:00");
    const monday = reminder({ nextDueOn: "2027-03-29" });
    // 09:00 on Saturday 27 March is EET (07:00 UTC); the occurrence two days later is in EEST.
    expect(reminderBody(monday, new Date("2027-03-27T07:00:00Z"))).toBe("Due in 2 days, Mon 29 Mar");
    expect(reminderBody(monday, new Date("2027-03-28T06:00:00Z"))).toBe("Due tomorrow at 09:00");
  });

  it("adds the year to a date in another year", () => {
    const newYear = reminder({ nextDueOn: "2027-01-01" });
    expect(reminderBody(newYear, new Date("2026-12-25T07:00:00Z"))).toBe("Due in 7 days, Fri 1 Jan 2027");
  });
});

describe("reminderPayload", () => {
  it("has the title, body, a link to the reminder and a tag per reminder", () => {
    expect(reminderPayload(reminder({ id: "abc" }), new Date("2026-10-31T06:00:00Z"))).toEqual({
      title: "Pay rent",
      body: "Due today at 09:00",
      url: "/reminders?focus=abc",
      tag: "reminder:abc",
    });
    expect(reminderUrl("a b")).toBe("/reminders?focus=a%20b");
    expect(reminderDedupeKey("abc", new Date("2026-10-31T07:00:00Z"))).toBe("reminder:abc:2026-10-31T07:00:00.000Z");
  });
});

describe("planReminderNotification", () => {
  // Notify times: 28 October and 31 October, both 07:00 UTC.
  const monthly = reminder({ leadMinutes: [4320, 0] });
  const threeDaysBefore = new Date("2026-10-28T07:00:00Z");
  const atTheTime = new Date("2026-10-31T07:00:00Z");

  it("sends for the stored time and stores the next one", () => {
    const now = new Date("2026-10-28T07:00:20Z");
    expect(planReminderNotification(monthly, threeDaysBefore, now)).toEqual({
      notification: {
        notifyAt: threeDaysBefore,
        dedupeKey: "reminder:r1:2026-10-28T07:00:00.000Z",
        payload: { title: "Pay rent", body: "Due in 3 days, Sat 31 Oct", url: "/reminders?focus=r1", tag: "reminder:r1" },
      },
      nextNotifyAt: atTheTime,
    });
  });

  it("sends only the latest missed time, worded at the moment it's sent", () => {
    const now = new Date("2026-11-02T10:00:00Z");
    const plan = planReminderNotification(monthly, threeDaysBefore, now);
    expect(plan.notification?.notifyAt).toEqual(atTheTime);
    expect(plan.notification?.payload.body).toBe("Due now");
    expect(plan.nextNotifyAt).toBeNull();
  });

  it("queues nothing for a stored time still ahead, or a muted reminder", () => {
    const early = new Date("2026-10-28T06:59:59Z");
    expect(planReminderNotification(monthly, threeDaysBefore, early)).toEqual({ notification: null, nextNotifyAt: threeDaysBefore });
    const muted = { ...monthly, notificationsMuted: true };
    expect(planReminderNotification(muted, threeDaysBefore, atTheTime)).toEqual({ notification: null, nextNotifyAt: null });
  });
});
