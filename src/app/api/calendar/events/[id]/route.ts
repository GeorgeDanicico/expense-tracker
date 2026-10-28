import { deleteEvent, getEvent, updateEvent } from "@/lib/family-calendar/service";
import { requireFamilyFeature } from "@/lib/family/feature";
import { json, parseBody, parseId, parseInput, withUser } from "@/lib/http/route";
import { calendarEventEditSchema, calendarScopeQuerySchema } from "@/lib/validation/calendar-event";

type EventRouteContext = { params: Promise<{ id: string }> };

const INVALID_ID_MESSAGE = "Invalid event identifier.";

export const GET = withUser(async (_request, _user, context: EventRouteContext) => {
  requireFamilyFeature();
  const id = parseId((await context.params).id, INVALID_ID_MESSAGE);
  return json({ event: await getEvent(id) });
}, { failure: "Unable to load the event." });

export const PATCH = withUser(async (request, _user, context: EventRouteContext) => {
  requireFamilyFeature();
  const id = parseId((await context.params).id, INVALID_ID_MESSAGE);
  const edit = await parseBody(request, calendarEventEditSchema, "Check the highlighted details and try again.");
  return json({ events: await updateEvent(id, edit) });
}, { failure: "Unable to save the event." });

export const DELETE = withUser(async (request, _user, context: EventRouteContext) => {
  requireFamilyFeature();
  const id = parseId((await context.params).id, INVALID_ID_MESSAGE);
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const { scope } = parseInput(query, calendarScopeQuerySchema, "Check which events to delete and try again.");
  return json({ deletedIds: await deleteEvent(id, scope) });
}, { failure: "Unable to delete the event." });
