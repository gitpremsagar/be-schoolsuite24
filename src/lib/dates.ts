/** Normalize a date string or Date to UTC midnight for attendance calendar days. */
export function toUtcDay(input: string | Date): Date {
  const d = typeof input === "string" ? new Date(input) : new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid date");
  }
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** Month is 1-12. Returns [start, end] as UTC midnights inclusive. */
export function utcMonthRange(year: number, month: number): {
  start: Date;
  end: Date;
  daysInMonth: number;
} {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Invalid year or month");
  }
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0)); // last day of month
  return {
    start,
    end,
    daysInMonth: end.getUTCDate(),
  };
}

export function utcDayKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
