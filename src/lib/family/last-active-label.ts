import { APPLICATION_TIMEZONE, getBucharestToday } from "@/lib/calendar";

const dayFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: APPLICATION_TIMEZONE,
});
const dayWithYearFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: APPLICATION_TIMEZONE,
});

function plural(count: number, unit: string) {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

/**
 * When a member was last active, in words: "Never", "Just now", "3 hours ago" or "12 Oct".
 * Anything under a day old reads relative; older dates use the application calendar
 * (Europe/Bucharest), with the year only when it isn't the current one.
 */
export function lastActiveLabel(lastActiveAt: string | null | undefined, now = new Date()): string {
  if (!lastActiveAt) return "Never";
  const at = new Date(lastActiveAt);
  if (Number.isNaN(at.getTime())) return "Never";

  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 10) return "Just now";
  if (minutes < 60) return plural(minutes, "minute");
  if (minutes < 24 * 60) return plural(Math.floor(minutes / 60), "hour");

  const sameYear = getBucharestToday(at).slice(0, 4) === getBucharestToday(now).slice(0, 4);
  return (sameYear ? dayFormatter : dayWithYearFormatter).format(at);
}
