/** Normalize a date string or Date to UTC midnight for attendance calendar days. */
export declare function toUtcDay(input: string | Date): Date;
export declare function addDays(date: Date, days: number): Date;
/** Month is 1-12. Returns [start, end] as UTC midnights inclusive. */
export declare function utcMonthRange(year: number, month: number): {
    start: Date;
    end: Date;
    daysInMonth: number;
};
export declare function utcDayKey(date: Date): string;
//# sourceMappingURL=dates.d.ts.map