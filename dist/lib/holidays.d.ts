export declare function isUtcSunday(date: Date): boolean;
/** List Sunday date keys (YYYY-MM-DD) in a calendar month. */
export declare function listSundaysInMonth(year: number, month: number): string[];
export declare function listDeclaredHolidayKeys(schoolId: string, year: number, month: number): Promise<Map<string, {
    id: string;
    name: string | null;
}>>;
/** Sundays ∪ declared holiday date keys for a month. */
export declare function listHolidayKeysForMonth(schoolId: string, year: number, month: number): Promise<string[]>;
export declare function isSchoolHolidayDate(schoolId: string, dateInput: string | Date): Promise<boolean>;
//# sourceMappingURL=holidays.d.ts.map