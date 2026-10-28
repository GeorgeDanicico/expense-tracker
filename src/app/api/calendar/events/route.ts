import { createEvent, listEvents } from "@/lib/family-calendar/service";
import { requireFamilyFeature } from "@/lib/family/feature";
import { json, parseBody, parseInput, withUser } from "@/lib/http/route";
import { calendarEventSchema, calendarRangeQuerySchema } from "@/lib/validation/calendar-event";

export const GET = withUser(async (request) => {
  requireFamilyFeature();
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const { from, to, member } = parseInput(query, calendarRangeQuerySchema, "Check the calendar's range and try again.");
  return json({ events: await listEvents({ from, to, memberId: member }) });
}, { failure: "Unable to load the calendar." });

export const POST = withUser(async (request) => {
  requireFamilyFeature();
  const input = await parseBody(request, calendarEventSchema, "Check the highlighted details and try again.");
  return json({ events: await createEvent(input) }, 201);
}, { failure: "Unable to save the event." });
