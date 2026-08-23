const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function isValidMonth(value: string) {
  return MONTH_PATTERN.test(value) && !Number.isNaN(new Date(`${value}-01T00:00:00`).valueOf());
}

export function isValidDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function getMonthRange(month: string) {
  const safeMonth = isValidMonth(month) ? month : getCurrentMonth();
  const [year, monthNumber] = safeMonth.split("-").map(Number);
  const next = new Date(year, monthNumber, 1);

  return {
    month: safeMonth,
    start: `${safeMonth}-01`,
    endExclusive: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`,
  };
}

export function shiftMonth(month: string, amount: number) {
  const { month: safeMonth } = getMonthRange(month);
  const [year, monthNumber] = safeMonth.split("-").map(Number);
  const shifted = new Date(year, monthNumber - 1 + amount, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

export function formatMonth(month: string, locale = "en-US") {
  const { month: safeMonth } = getMonthRange(month);
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(`${safeMonth}-01T12:00:00`),
  );
}

export function formatDate(date: string, locale = "en-US") {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}
