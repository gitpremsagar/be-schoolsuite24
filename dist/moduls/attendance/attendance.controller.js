import { prisma } from "../../lib/prisma.js";
import { toUtcDay, utcDayKey, utcMonthRange } from "../../lib/dates.js";
import { listHolidayKeysForMonth } from "../../lib/holidays.js";
import { formatClassLabel } from "../../lib/class-levels.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { getAuthUser, requireSchoolId } from "../../middleware/auth.js";
import { handleControllerError } from "../auth/auth.controller.js";
function parseYearMonth(req) {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (!Number.isInteger(year) || !Number.isInteger(month)) {
        throw badRequest("year and month are required (month is 1-12)");
    }
    if (month < 1 || month > 12) {
        throw badRequest("month must be between 1 and 12");
    }
    return { year, month };
}
export async function getClassAttendance(req, res) {
    try {
        const schoolId = requireSchoolId(req);
        const classId = typeof req.query.classId === "string" ? req.query.classId : undefined;
        const dateStr = typeof req.query.date === "string" ? req.query.date : undefined;
        if (!classId || !dateStr) {
            throw badRequest("classId and date are required");
        }
        const date = toUtcDay(dateStr);
        const klass = await prisma.class.findFirst({
            where: { id: classId, schoolId },
        });
        if (!klass) {
            throw notFound("Class not found");
        }
        const enrollments = await prisma.enrollment.findMany({
            where: {
                schoolId,
                classId,
                isActive: true,
                academicYearId: klass.academicYearId,
            },
            include: {
                studentProfile: {
                    include: {
                        user: { select: { id: true, name: true, email: true } },
                    },
                },
            },
            orderBy: { rollNumber: "asc" },
        });
        const existing = await prisma.studentAttendance.findMany({
            where: { schoolId, classId, date },
        });
        const byStudent = new Map(existing.map((row) => [row.studentProfileId, row]));
        res.json({
            classId,
            date,
            academicYearId: klass.academicYearId,
            records: enrollments.map((e) => ({
                enrollmentId: e.id,
                studentProfileId: e.studentProfileId,
                rollNumber: e.rollNumber,
                student: e.studentProfile,
                attendance: byStudent.get(e.studentProfileId) ?? null,
            })),
            summary: {
                present: existing.filter((r) => r.status === "PRESENT").length,
                absent: existing.filter((r) => r.status === "ABSENT").length,
                unmarked: enrollments.length - existing.length,
            },
        });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to load class attendance");
    }
}
/** Full-month student attendance register for a class, or all classes. */
export async function getClassMonthlyAttendance(req, res) {
    try {
        const schoolId = requireSchoolId(req);
        const classId = typeof req.query.classId === "string" && req.query.classId.trim()
            ? req.query.classId
            : undefined;
        const { year, month } = parseYearMonth(req);
        const { start, end, daysInMonth } = utcMonthRange(year, month);
        const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
        let enrollments;
        if (classId) {
            const klass = await prisma.class.findFirst({
                where: { id: classId, schoolId },
            });
            if (!klass) {
                throw notFound("Class not found");
            }
            enrollments = await prisma.enrollment.findMany({
                where: {
                    schoolId,
                    classId,
                    isActive: true,
                    academicYearId: klass.academicYearId,
                },
                include: {
                    class: { select: { id: true, classLevel: true, section: true } },
                    studentProfile: {
                        include: {
                            user: { select: { id: true, name: true, email: true } },
                        },
                    },
                },
                orderBy: { rollNumber: "asc" },
            });
        }
        else {
            const currentYear = await prisma.academicYear.findFirst({
                where: { schoolId, isCurrent: true },
            });
            enrollments = await prisma.enrollment.findMany({
                where: {
                    schoolId,
                    isActive: true,
                    ...(currentYear ? { academicYearId: currentYear.id } : {}),
                },
                include: {
                    class: { select: { id: true, classLevel: true, section: true } },
                    studentProfile: {
                        include: {
                            user: { select: { id: true, name: true, email: true } },
                        },
                    },
                },
                orderBy: [{ class: { classLevel: "asc" } }, { rollNumber: "asc" }],
            });
        }
        const existing = await prisma.studentAttendance.findMany({
            where: {
                schoolId,
                date: { gte: start, lte: end },
                ...(classId ? { classId } : {}),
            },
        });
        const byStudentDay = new Map();
        for (const row of existing) {
            byStudentDay.set(`${row.studentProfileId}:${utcDayKey(row.date)}`, row.status);
        }
        const holidays = await listHolidayKeysForMonth(schoolId, year, month);
        res.json({
            classId: classId ?? null,
            year,
            month,
            daysInMonth,
            days,
            holidays,
            students: enrollments.map((e) => {
                const dayMarks = {};
                for (const day of days) {
                    const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    dayMarks[String(day)] =
                        byStudentDay.get(`${e.studentProfileId}:${key}`) ?? null;
                }
                return {
                    enrollmentId: e.id,
                    studentProfileId: e.studentProfileId,
                    classId: e.classId,
                    classLevel: e.class.classLevel,
                    className: formatClassLabel(e.class.classLevel, e.class.section),
                    section: e.class.section,
                    rollNumber: e.rollNumber,
                    name: e.studentProfile.user.name,
                    email: e.studentProfile.user.email,
                    days: dayMarks,
                };
            }),
        });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to load monthly attendance");
    }
}
/** Bulk save student attendance marks across multiple days. */
export async function upsertStudentMonthlyAttendance(req, res) {
    try {
        const auth = getAuthUser(req);
        const schoolId = requireSchoolId(req);
        const { classId: bodyClassId, records } = req.body;
        if (!Array.isArray(records) || records.length === 0) {
            throw badRequest("non-empty records are required");
        }
        for (const record of records) {
            if (!record.studentProfileId ||
                !record.date ||
                (record.status !== "PRESENT" && record.status !== "ABSENT")) {
                throw badRequest("Each record needs studentProfileId, date, and status PRESENT|ABSENT");
            }
            if (!bodyClassId && !record.classId) {
                throw badRequest("classId is required on the body or each record");
            }
        }
        const classIds = [
            ...new Set(records.map((r) => r.classId ?? bodyClassId).filter(Boolean)),
        ];
        const classes = await prisma.class.findMany({
            where: { schoolId, id: { in: classIds } },
        });
        if (classes.length !== classIds.length) {
            throw notFound("One or more classes were not found");
        }
        const classById = new Map(classes.map((c) => [c.id, c]));
        if (auth.role === "TEACHER") {
            const staff = await prisma.staffProfile.findUnique({
                where: { userId: auth.userId },
            });
            if (!staff) {
                throw forbidden();
            }
            for (const cid of classIds) {
                const klass = classById.get(cid);
                const assigned = await prisma.classTeacher.findFirst({
                    where: { classId: cid, staffProfileId: staff.id },
                });
                const isHomeroom = klass.classTeacherId === auth.userId;
                if (!assigned && !isHomeroom) {
                    throw forbidden("You are not assigned to one of these classes");
                }
            }
        }
        const uniqueMonths = new Map();
        for (const record of records) {
            const d = toUtcDay(record.date);
            const y = d.getUTCFullYear();
            const m = d.getUTCMonth() + 1;
            uniqueMonths.set(`${y}-${m}`, { year: y, month: m });
        }
        const holidayKeySet = new Set();
        for (const { year, month } of uniqueMonths.values()) {
            const monthHolidays = await listHolidayKeysForMonth(schoolId, year, month);
            for (const h of monthHolidays)
                holidayKeySet.add(h);
        }
        const writableRecords = records.filter((r) => !holidayKeySet.has(utcDayKey(toUtcDay(r.date))));
        if (writableRecords.length === 0) {
            res.json({ count: 0, records: [], skippedHolidays: records.length });
            return;
        }
        const saved = await prisma.$transaction(writableRecords.map((record) => {
            const cid = record.classId ?? bodyClassId;
            const klass = classById.get(cid);
            const date = toUtcDay(record.date);
            return prisma.studentAttendance.upsert({
                where: {
                    studentProfileId_date: {
                        studentProfileId: record.studentProfileId,
                        date,
                    },
                },
                create: {
                    schoolId,
                    academicYearId: klass.academicYearId,
                    classId: cid,
                    studentProfileId: record.studentProfileId,
                    date,
                    status: record.status,
                    markedById: auth.userId,
                },
                update: {
                    status: record.status,
                    markedById: auth.userId,
                    classId: cid,
                    academicYearId: klass.academicYearId,
                },
            });
        }));
        res.json({
            count: saved.length,
            records: saved,
            skippedHolidays: records.length - writableRecords.length,
        });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to save monthly attendance");
    }
}
export async function upsertStudentAttendance(req, res) {
    try {
        const auth = getAuthUser(req);
        const schoolId = requireSchoolId(req);
        const { classId, date: dateStr, records } = req.body;
        if (!classId || !dateStr || !Array.isArray(records)) {
            throw badRequest("classId, date, and records are required");
        }
        const date = toUtcDay(dateStr);
        const klass = await prisma.class.findFirst({
            where: { id: classId, schoolId },
        });
        if (!klass) {
            throw notFound("Class not found");
        }
        if (auth.role === "TEACHER") {
            const staff = await prisma.staffProfile.findUnique({
                where: { userId: auth.userId },
            });
            if (!staff) {
                throw forbidden();
            }
            const assigned = await prisma.classTeacher.findFirst({
                where: { classId, staffProfileId: staff.id },
            });
            const isHomeroom = klass.classTeacherId === auth.userId;
            if (!assigned && !isHomeroom) {
                throw forbidden("You are not assigned to this class");
            }
        }
        const saved = await prisma.$transaction(records.map((record) => prisma.studentAttendance.upsert({
            where: {
                studentProfileId_date: {
                    studentProfileId: record.studentProfileId,
                    date,
                },
            },
            create: {
                schoolId,
                academicYearId: klass.academicYearId,
                classId,
                studentProfileId: record.studentProfileId,
                date,
                status: record.status,
                markedById: auth.userId,
                notes: record.notes ?? null,
            },
            update: {
                status: record.status,
                markedById: auth.userId,
                notes: record.notes ?? null,
                classId,
                academicYearId: klass.academicYearId,
            },
        })));
        res.json({ records: saved });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to save student attendance");
    }
}
export async function punchIn(req, res) {
    try {
        const auth = getAuthUser(req);
        const schoolId = requireSchoolId(req);
        const staff = await prisma.staffProfile.findUnique({
            where: { userId: auth.userId },
        });
        if (!staff) {
            throw notFound("Staff profile not found");
        }
        const date = toUtcDay(new Date());
        const existing = await prisma.staffAttendance.findUnique({
            where: {
                staffProfileId_date: {
                    staffProfileId: staff.id,
                    date,
                },
            },
        });
        if (existing) {
            throw badRequest("Already punched in today");
        }
        const record = await prisma.staffAttendance.create({
            data: {
                schoolId,
                staffProfileId: staff.id,
                date,
                status: "PRESENT",
                punchInAt: new Date(),
            },
        });
        res.status(201).json({ attendance: record });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to punch in");
    }
}
export async function punchOut(req, res) {
    try {
        const auth = getAuthUser(req);
        const staff = await prisma.staffProfile.findUnique({
            where: { userId: auth.userId },
        });
        if (!staff) {
            throw notFound("Staff profile not found");
        }
        const date = toUtcDay(new Date());
        const existing = await prisma.staffAttendance.findUnique({
            where: {
                staffProfileId_date: {
                    staffProfileId: staff.id,
                    date,
                },
            },
        });
        if (!existing) {
            throw badRequest("Punch in first");
        }
        if (!existing.punchInAt || existing.status === "ABSENT") {
            throw badRequest("Cannot punch out without a present punch-in");
        }
        if (existing.punchOutAt) {
            throw badRequest("Already punched out today");
        }
        const record = await prisma.staffAttendance.update({
            where: { id: existing.id },
            data: { punchOutAt: new Date() },
        });
        res.json({ attendance: record });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to punch out");
    }
}
export async function getMyStaffAttendanceToday(req, res) {
    try {
        const auth = getAuthUser(req);
        const staff = await prisma.staffProfile.findUnique({
            where: { userId: auth.userId },
        });
        if (!staff) {
            throw notFound("Staff profile not found");
        }
        const date = toUtcDay(new Date());
        const attendance = await prisma.staffAttendance.findUnique({
            where: {
                staffProfileId_date: {
                    staffProfileId: staff.id,
                    date,
                },
            },
        });
        res.json({ attendance, date });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to fetch attendance");
    }
}
/** Own staff attendance month register (teacher/employee self-service). */
export async function getMyStaffMonthlyAttendance(req, res) {
    try {
        const auth = getAuthUser(req);
        const schoolId = requireSchoolId(req);
        const { year, month } = parseYearMonth(req);
        const { start, end, daysInMonth } = utcMonthRange(year, month);
        const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
        const staff = await prisma.staffProfile.findUnique({
            where: { userId: auth.userId },
            include: {
                user: { select: { id: true, name: true, email: true, role: true } },
            },
        });
        if (!staff || staff.schoolId !== schoolId) {
            throw notFound("Staff profile not found");
        }
        const records = await prisma.staffAttendance.findMany({
            where: {
                schoolId,
                staffProfileId: staff.id,
                date: { gte: start, lte: end },
            },
        });
        const byDay = new Map();
        for (const row of records) {
            byDay.set(utcDayKey(row.date), {
                status: row.status ?? "PRESENT",
                punchInAt: row.punchInAt,
                punchOutAt: row.punchOutAt,
            });
        }
        const dayMarks = {};
        for (const day of days) {
            const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const hit = byDay.get(key);
            dayMarks[String(day)] = hit
                ? {
                    status: hit.status,
                    punchInAt: hit.punchInAt ? hit.punchInAt.toISOString() : null,
                    punchOutAt: hit.punchOutAt ? hit.punchOutAt.toISOString() : null,
                }
                : null;
        }
        res.json({
            year,
            month,
            daysInMonth,
            days,
            holidays: await listHolidayKeysForMonth(schoolId, year, month),
            staff: {
                staffProfileId: staff.id,
                employeeCode: staff.employeeCode,
                staffType: staff.staffType,
                name: staff.user.name,
                email: staff.user.email,
                role: staff.user.role,
                days: dayMarks,
            },
        });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to load your monthly attendance");
    }
}
export async function listStaffAttendance(req, res) {
    try {
        const schoolId = requireSchoolId(req);
        const from = typeof req.query.from === "string"
            ? toUtcDay(req.query.from)
            : toUtcDay(new Date());
        const to = typeof req.query.to === "string" ? toUtcDay(req.query.to) : from;
        const records = await prisma.staffAttendance.findMany({
            where: {
                schoolId,
                date: { gte: from, lte: to },
            },
            include: {
                staffProfile: {
                    include: {
                        user: { select: { id: true, name: true, email: true, role: true } },
                    },
                },
            },
            orderBy: [{ date: "desc" }, { punchInAt: "desc" }],
        });
        res.json({ records });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to list staff attendance");
    }
}
/** Full-month staff attendance register for the school. */
export async function getStaffMonthlyAttendance(req, res) {
    try {
        const schoolId = requireSchoolId(req);
        const { year, month } = parseYearMonth(req);
        const { start, end, daysInMonth } = utcMonthRange(year, month);
        const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
        const staff = await prisma.staffProfile.findMany({
            where: { schoolId },
            include: {
                user: { select: { id: true, name: true, email: true, role: true } },
            },
            orderBy: { employeeCode: "asc" },
        });
        const records = await prisma.staffAttendance.findMany({
            where: {
                schoolId,
                date: { gte: start, lte: end },
            },
        });
        const byStaffDay = new Map();
        for (const row of records) {
            byStaffDay.set(`${row.staffProfileId}:${utcDayKey(row.date)}`, {
                status: row.status ?? "PRESENT",
                punchInAt: row.punchInAt,
                punchOutAt: row.punchOutAt,
            });
        }
        res.json({
            year,
            month,
            daysInMonth,
            days,
            holidays: await listHolidayKeysForMonth(schoolId, year, month),
            staff: staff.map((s) => {
                const dayMarks = {};
                for (const day of days) {
                    const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                    const hit = byStaffDay.get(`${s.id}:${key}`);
                    dayMarks[String(day)] = hit
                        ? {
                            status: hit.status,
                            punchInAt: hit.punchInAt ? hit.punchInAt.toISOString() : null,
                            punchOutAt: hit.punchOutAt
                                ? hit.punchOutAt.toISOString()
                                : null,
                        }
                        : null;
                }
                return {
                    staffProfileId: s.id,
                    employeeCode: s.employeeCode,
                    staffType: s.staffType,
                    name: s.user.name,
                    email: s.user.email,
                    role: s.user.role,
                    days: dayMarks,
                };
            }),
        });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to load staff monthly attendance");
    }
}
/** Bulk save staff attendance marks across multiple days. */
export async function upsertStaffMonthlyAttendance(req, res) {
    try {
        const auth = getAuthUser(req);
        const schoolId = requireSchoolId(req);
        const { records } = req.body;
        if (!Array.isArray(records) || records.length === 0) {
            throw badRequest("non-empty records are required");
        }
        const staffIds = [...new Set(records.map((r) => r.staffProfileId))];
        const staffCount = await prisma.staffProfile.count({
            where: { schoolId, id: { in: staffIds } },
        });
        if (staffCount !== staffIds.length) {
            throw badRequest("One or more staff profiles are invalid for this school");
        }
        for (const record of records) {
            if (!record.staffProfileId || !record.date) {
                throw badRequest("Each record needs staffProfileId and date");
            }
            if (record.status != null &&
                record.status !== "PRESENT" &&
                record.status !== "ABSENT") {
                throw badRequest("status must be PRESENT, ABSENT, or null to clear");
            }
            if (record.status === "PRESENT") {
                if (!record.punchInAt) {
                    throw badRequest("punchInAt is required when status is PRESENT");
                }
                const punchIn = new Date(record.punchInAt);
                if (Number.isNaN(punchIn.getTime())) {
                    throw badRequest("Invalid punchInAt");
                }
                if (record.punchOutAt) {
                    const punchOut = new Date(record.punchOutAt);
                    if (Number.isNaN(punchOut.getTime())) {
                        throw badRequest("Invalid punchOutAt");
                    }
                    if (punchOut.getTime() < punchIn.getTime()) {
                        throw badRequest("punchOutAt must be after punchInAt");
                    }
                }
            }
        }
        const uniqueMonths = new Map();
        for (const record of records) {
            const d = toUtcDay(record.date);
            const y = d.getUTCFullYear();
            const m = d.getUTCMonth() + 1;
            uniqueMonths.set(`${y}-${m}`, { year: y, month: m });
        }
        const holidayKeySet = new Set();
        for (const { year, month } of uniqueMonths.values()) {
            const monthHolidays = await listHolidayKeysForMonth(schoolId, year, month);
            for (const h of monthHolidays)
                holidayKeySet.add(h);
        }
        const writableRecords = records.filter((r) => !holidayKeySet.has(utcDayKey(toUtcDay(r.date))));
        if (writableRecords.length === 0) {
            res.json({ count: 0, records: [], skippedHolidays: records.length });
            return;
        }
        const saved = await prisma.$transaction(async (tx) => {
            const results = [];
            for (const record of writableRecords) {
                const date = toUtcDay(record.date);
                if (record.status == null) {
                    await tx.staffAttendance.deleteMany({
                        where: { staffProfileId: record.staffProfileId, date },
                    });
                    continue;
                }
                if (record.status === "ABSENT") {
                    const row = await tx.staffAttendance.upsert({
                        where: {
                            staffProfileId_date: {
                                staffProfileId: record.staffProfileId,
                                date,
                            },
                        },
                        create: {
                            schoolId,
                            staffProfileId: record.staffProfileId,
                            date,
                            status: "ABSENT",
                            punchInAt: null,
                            punchOutAt: null,
                            markedById: auth.userId,
                        },
                        update: {
                            status: "ABSENT",
                            punchInAt: null,
                            punchOutAt: null,
                            markedById: auth.userId,
                        },
                    });
                    results.push(row);
                    continue;
                }
                const punchInAt = new Date(record.punchInAt);
                const punchOutAt = record.punchOutAt
                    ? new Date(record.punchOutAt)
                    : null;
                const row = await tx.staffAttendance.upsert({
                    where: {
                        staffProfileId_date: {
                            staffProfileId: record.staffProfileId,
                            date,
                        },
                    },
                    create: {
                        schoolId,
                        staffProfileId: record.staffProfileId,
                        date,
                        status: "PRESENT",
                        punchInAt,
                        punchOutAt,
                        markedById: auth.userId,
                    },
                    update: {
                        status: "PRESENT",
                        punchInAt,
                        punchOutAt,
                        markedById: auth.userId,
                    },
                });
                results.push(row);
            }
            return results;
        });
        res.json({
            count: saved.length,
            records: saved,
            skippedHolidays: records.length - writableRecords.length,
        });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to save staff monthly attendance");
    }
}
export async function getMyStudentAttendance(req, res) {
    try {
        const auth = getAuthUser(req);
        const profile = await prisma.studentProfile.findUnique({
            where: { userId: auth.userId },
        });
        if (!profile) {
            throw notFound("Student profile not found");
        }
        const records = await prisma.studentAttendance.findMany({
            where: { studentProfileId: profile.id },
            include: { class: true },
            orderBy: { date: "desc" },
            take: 90,
        });
        res.json({ records });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to fetch attendance");
    }
}
export async function upsertStaffDayAttendance(req, res) {
    try {
        const auth = getAuthUser(req);
        const schoolId = requireSchoolId(req);
        const { staffProfileId, date: dateStr, status, punchInAt, punchOutAt, notes, } = req.body;
        if (!staffProfileId || !dateStr) {
            throw badRequest("staffProfileId and date are required");
        }
        if (status !== undefined &&
            status !== null &&
            status !== "PRESENT" &&
            status !== "ABSENT") {
            throw badRequest("status must be PRESENT, ABSENT, or null to clear");
        }
        const staff = await prisma.staffProfile.findFirst({
            where: { id: staffProfileId, schoolId },
        });
        if (!staff) {
            throw notFound("Staff not found");
        }
        const date = toUtcDay(dateStr);
        if (status == null) {
            await prisma.staffAttendance.deleteMany({
                where: { staffProfileId, date },
            });
            res.json({ deleted: true, staffProfileId, date: dateStr });
            return;
        }
        if (status === "ABSENT") {
            const record = await prisma.staffAttendance.upsert({
                where: {
                    staffProfileId_date: { staffProfileId, date },
                },
                create: {
                    schoolId,
                    staffProfileId,
                    date,
                    status: "ABSENT",
                    punchInAt: null,
                    punchOutAt: null,
                    markedById: auth.userId,
                    notes: notes ?? null,
                },
                update: {
                    status: "ABSENT",
                    punchInAt: null,
                    punchOutAt: null,
                    markedById: auth.userId,
                    notes: notes ?? null,
                },
            });
            res.json({ attendance: record });
            return;
        }
        if (!punchInAt) {
            throw badRequest("punchInAt is required when status is PRESENT");
        }
        const punchIn = new Date(punchInAt);
        if (Number.isNaN(punchIn.getTime())) {
            throw badRequest("Invalid punchInAt");
        }
        let punchOut = null;
        if (punchOutAt) {
            punchOut = new Date(punchOutAt);
            if (Number.isNaN(punchOut.getTime())) {
                throw badRequest("Invalid punchOutAt");
            }
            if (punchOut.getTime() < punchIn.getTime()) {
                throw badRequest("punchOutAt must be after punchInAt");
            }
        }
        const record = await prisma.staffAttendance.upsert({
            where: {
                staffProfileId_date: { staffProfileId, date },
            },
            create: {
                schoolId,
                staffProfileId,
                date,
                status: "PRESENT",
                punchInAt: punchIn,
                punchOutAt: punchOut,
                markedById: auth.userId,
                notes: notes ?? null,
            },
            update: {
                status: "PRESENT",
                punchInAt: punchIn,
                punchOutAt: punchOut,
                markedById: auth.userId,
                notes: notes ?? null,
            },
        });
        res.json({ attendance: record });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to save staff attendance");
    }
}
/** @deprecated Prefer upsertStaffDayAttendance */
export async function correctStaffAttendance(req, res) {
    if (req.body && typeof req.body === "object" && !("status" in req.body)) {
        req.body.status = "PRESENT";
    }
    return upsertStaffDayAttendance(req, res);
}
//# sourceMappingURL=attendance.controller.js.map