/** Normalize a date string or Date to UTC midnight for attendance calendar days. */
export function toUtcDay(input) {
    const d = typeof input === "string" ? new Date(input) : new Date(input);
    if (Number.isNaN(d.getTime())) {
        throw new Error("Invalid date");
    }
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
export function addDays(date, days) {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}
/** Month is 1-12. Returns [start, end] as UTC midnights inclusive. */
export function utcMonthRange(year, month) {
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
export function utcDayKey(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}
//# sourceMappingURL=dates.js.map