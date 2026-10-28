import { randomUUID } from "node:crypto";

import {
  attendeeOutsideFamilyError,
  calendarAttendees,
  eventGoneError,
  noFamilyError,
  type CalendarRepository,
  type CalendarRowEdit,
  type NewCalendarRow,
} from "@/lib/family-calendar/repository";
import type {
  CalendarFeed,
  CalendarFeedData,
  CalendarFeedRepository,
} from "@/lib/family-calendar/feed-repository";
import type { CalendarEvent } from "@/lib/family-calendar/types";

import type { FakeFamilyRepository } from "./family";

/**
 * An event as the fake stores it: a `CalendarEvent` with its family and the raw attendee ids in place
 * of the joined attendees and the counted series length, plus the notification bookkeeping the
 * service writes (`notifyAt`, `notifiedAt`), which the API's `CalendarEvent` doesn't carry.
 */
export type FakeCalendarRow = Omit<CalendarEvent, "attendees" | "seriesLength"> & {
  familyId: string;
  memberIds: string[];
  notifyAt: string | null;
  notifiedAt: string | null;
};

const bySeries = (a: FakeCalendarRow, b: FakeCalendarRow) =>
  a.seriesId.localeCompare(b.seriesId) || a.seriesIndex - b.seriesIndex;

/**
 * In-memory `CalendarRepository` acting as the caller of a `FakeFamilyRepository` (the same one the
 * test seeds): the caller's family is `family.membership.familyId`, the members an event may be for
 * and the display fields joined onto events are `family.family.members`, and `createdBy` is
 * `family.caller.userId`. Like the database, it keeps every method to the caller's family (another
 * family's event counts as missing), refuses an attendee outside the family (422), keeps
 * `(series, index)` unique, and makes `update` all or nothing (404 when any row is missing).
 *
 * Seed events with `seed({ title, startsAt, ... })` (the caller's family and attendee by default) or
 * push onto `rows` directly. `calls` records every method call.
 */
export class FakeCalendarRepository implements CalendarRepository {
  rows: FakeCalendarRow[] = [];
  readonly calls: (keyof CalendarRepository)[] = [];

  constructor(private readonly family: FakeFamilyRepository) {}

  /** Adds one event (to the caller's family, a series of its own, unless overridden) and returns it as stored. */
  seed(overrides: Partial<FakeCalendarRow> = {}): FakeCalendarRow {
    const now = new Date().toISOString();
    const row: FakeCalendarRow = {
      id: randomUUID(),
      familyId: this.family.membership?.familyId ?? "no-family",
      seriesId: randomUUID(),
      seriesIndex: 1,
      seriesRepeat: "none",
      title: "Swimming",
      notes: "",
      location: "",
      allDay: false,
      startsAt: "2026-11-03T07:00:00.000Z",
      endsAt: "2026-11-03T08:00:00.000Z",
      timezone: "Europe/Bucharest",
      memberIds: this.family.membership ? [this.family.membership.memberId] : [],
      createdBy: this.family.caller.userId,
      createdAt: now,
      updatedAt: now,
      notifyAt: null,
      notifiedAt: null,
      ...overrides,
    };
    this.rows.push(row);
    return row;
  }

  async listBetween(from: string, to: string) {
    this.calls.push("listBetween");
    const familyId = this.requireFamily();
    return this.rows
      .filter((row) => row.familyId === familyId && row.startsAt < to && row.endsAt > from)
      .toSorted((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id))
      .map((row) => this.toEvent(row));
  }

  async get(id: string) {
    this.calls.push("get");
    const row = this.find(id);
    return row ? this.toEvent(row) : null;
  }

  async listSeries(seriesId: string) {
    this.calls.push("listSeries");
    const familyId = this.family.membership?.familyId;
    return this.rows
      .filter((row) => row.familyId === familyId && row.seriesId === seriesId)
      .toSorted((a, b) => a.seriesIndex - b.seriesIndex)
      .map((row) => this.toEvent(row));
  }

  async create(rows: readonly NewCalendarRow[], memberIds: readonly string[]) {
    this.calls.push("create");
    const familyId = this.requireFamily();
    this.checkMembers(memberIds);
    if (rows.length < 1 || rows.length > 10) throw new Error("An event series has between 1 and 10 events.");

    const seriesId = randomUUID();
    const now = new Date().toISOString();
    const created = rows.map((row): FakeCalendarRow => ({
      id: randomUUID(),
      familyId,
      seriesId,
      seriesIndex: row.seriesIndex,
      seriesRepeat: row.seriesRepeat,
      title: row.title,
      notes: row.notes,
      location: row.location,
      allDay: row.allDay,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      timezone: row.timezone,
      memberIds: [...new Set(memberIds)],
      createdBy: this.family.caller.userId,
      createdAt: now,
      updatedAt: now,
      notifyAt: row.notifyAt,
      notifiedAt: null,
    }));
    this.rows.push(...created);
    return created.toSorted(bySeries).map((row) => this.toEvent(row));
  }

  async update(rows: readonly CalendarRowEdit[], memberIds?: readonly string[]) {
    this.calls.push("update");
    if (rows.length === 0) throw new Error("Choose the events to change.");
    if (memberIds !== undefined && memberIds.length === 0) throw new Error("Choose who the event is for.");
    const found = rows.map((edit) => this.find(edit.id));
    if (found.some((row) => row === undefined)) throw eventGoneError();
    if (memberIds !== undefined) this.checkMembers(memberIds);

    const now = new Date().toISOString();
    rows.forEach((edit, index) => {
      const row = found[index]!;
      const { notifyAt, notifiedAt, ...values } = { ...edit, id: undefined };
      const defined = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
      Object.assign(row, defined, {
        ...(notifyAt !== undefined ? { notifyAt } : {}),
        ...(notifiedAt !== undefined ? { notifiedAt } : {}),
        updatedAt: now,
      });
      if (memberIds !== undefined) row.memberIds = [...new Set(memberIds)];
    });
    return found.map((row) => row!).toSorted(bySeries).map((row) => this.toEvent(row));
  }

  async delete(ids: readonly string[]) {
    this.calls.push("delete");
    const deleted = ids.filter((id) => this.find(id));
    this.rows = this.rows.filter((row) => !deleted.includes(row.id));
    return deleted;
  }

  /** The caller's event with this id, or undefined (no family, another family's event, or none). */
  private find(id: string) {
    const familyId = this.family.membership?.familyId;
    return familyId === undefined ? undefined : this.rows.find((row) => row.id === id && row.familyId === familyId);
  }

  private requireFamily() {
    const familyId = this.family.membership?.familyId;
    if (familyId === undefined) throw noFamilyError();
    return familyId;
  }

  private members() {
    return this.family.family?.members ?? [];
  }

  /** Like the attendee guard: every attendee must be a member of the caller's family. */
  private checkMembers(memberIds: readonly string[]) {
    const known = this.members();
    if (memberIds.some((memberId) => !known.some((member) => member.memberId === memberId))) {
      throw attendeeOutsideFamilyError();
    }
  }

  private toEvent({ familyId, memberIds, notifyAt, notifiedAt, ...row }: FakeCalendarRow): CalendarEvent {
    void notifyAt;
    void notifiedAt;
    const seriesLength = this.rows.filter((other) => other.familyId === familyId && other.seriesId === row.seriesId).length;
    return { ...row, seriesLength, attendees: calendarAttendees(this.members(), memberIds) };
  }
}

/** A feed link as the fake stores it. */
export type FakeCalendarFeedRow = CalendarFeed & { tokenHash: string; revokedAt: string | null };

/**
 * In-memory `CalendarFeedRepository` for the signed-in caller. `feeds` holds every link (the caller's
 * only, as no test needs two users); `create` revokes the live one first, like `create_calendar_feed`.
 * `read` answers from `contents`, a feed's data by token hash, as the database would work it out from
 * the owner's events; an unknown or revoked hash is null.
 */
export class FakeCalendarFeedRepository implements CalendarFeedRepository {
  feeds: FakeCalendarFeedRow[] = [];
  contents = new Map<string, CalendarFeedData>();
  readonly calls: (keyof CalendarFeedRepository)[] = [];

  async get() {
    this.calls.push("get");
    const live = this.live();
    return live ? this.toFeed(live) : null;
  }

  async create(tokenHash: string) {
    this.calls.push("create");
    if (!/^[0-9a-f]{64}$/.test(tokenHash)) throw new Error("Unable to create your calendar link. Please try again.");
    this.revokeLive();
    const row: FakeCalendarFeedRow = {
      id: randomUUID(),
      tokenHash,
      createdAt: new Date().toISOString(),
      lastFetchedAt: null,
      revokedAt: null,
    };
    this.feeds.push(row);
    return this.toFeed(row);
  }

  async revoke() {
    this.calls.push("revoke");
    return this.revokeLive();
  }

  async read(tokenHash: string) {
    this.calls.push("read");
    const feed = this.feeds.find((row) => row.tokenHash === tokenHash && row.revokedAt === null);
    if (!feed) return null;
    feed.lastFetchedAt = new Date().toISOString();
    return this.contents.get(tokenHash) ?? { familyName: null, events: [] };
  }

  private live() {
    return this.feeds.find((row) => row.revokedAt === null);
  }

  private revokeLive() {
    const live = this.live();
    if (live) live.revokedAt = new Date().toISOString();
    return live !== undefined;
  }

  private toFeed({ id, createdAt, lastFetchedAt }: FakeCalendarFeedRow): CalendarFeed {
    return { id, createdAt, lastFetchedAt };
  }
}
