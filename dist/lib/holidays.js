import { prisma } from "./prisma.js";
import { toUtcDay, utcDayKey, utcMonthRange, } from "./dates.js";
export function isUtcSunday(date) {
    return date.getUTCDay() === 0;
}
/** List Sunday date keys (YYYY-MM-DD) in a calendar month. */
export function listSundaysInMonth(year, month) {
    const { daysInMonth } = utcMonthRange(year, month);
    const sundays = [];
    for (let day = 1; day <= daysInMonth; day += 1) {
        const d = new Date(Date.UTC(year, month - 1, day));
        if (isUtcSunday(d))
            sundays.push(utcDayKey(d));
    }
    return sundays;
}
export async function listDeclaredHolidayKeys(schoolId, year, month) {
    const { start, end } = utcMonthRange(year, month);
    const rows = await prisma.schoolHoliday.findMany({
        where: {
            schoolId,
            date: { gte: start, lte: end },
        },
        orderBy: { date: "asc" },
    });
    const map = new Map();
    for (const row of rows) {
        map.set(utcDayKey(row.date), { id: row.id, name: row.name });
    }
    return map;
}
/** Sundays ∪ declared holiday date keys for a month. */
export async function listHolidayKeysForMonth(schoolId, year, month) {
    const sundays = listSundaysInMonth(year, month);
    const declared = await listDeclaredHolidayKeys(schoolId, year, month);
    const set = new Set([...sundays, ...declared.keys()]);
    return [...set].sort();
}
export async function isSchoolHolidayDate(schoolId, dateInput) {
    const date = toUtcDay(dateInput);
    if (isUtcSunday(date))
        return true;
    const hit = await prisma.schoolHoliday.findUnique({
        where: {
            schoolId_date: {
                schoolId,
                date,
            },
        },
        select: { id: true },
    });
    return hit != null;
}
//# sourceMappingURL=holidays.js.map