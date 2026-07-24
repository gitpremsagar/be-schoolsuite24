import { prisma } from "../../lib/prisma.js";
import { classLevelSortIndex, formatClassLabel, } from "../../lib/class-levels.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { getAuthUser, requireSchoolId } from "../../middleware/auth.js";
import { handleControllerError } from "../auth/auth.controller.js";
/** Inclusive calendar months between two dates (UTC). */
export function monthsInRange(start, end) {
    const months = [];
    let y = start.getUTCFullYear();
    let m = start.getUTCMonth() + 1; // 1-12
    const endY = end.getUTCFullYear();
    const endM = end.getUTCMonth() + 1;
    while (y < endY || (y === endY && m <= endM)) {
        const key = `${y}-${String(m).padStart(2, "0")}`;
        const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-IN", {
            month: "short",
            year: "numeric",
            timeZone: "UTC",
        });
        months.push({ year: y, month: m, key, label });
        m += 1;
        if (m > 12) {
            m = 1;
            y += 1;
        }
    }
    return months;
}
function monthOrdinal(year, month) {
    return year * 12 + month;
}
/**
 * Fee liability starts in the admission month (inclusive).
 * Months strictly before joiningDate are not applicable.
 * Missing joiningDate keeps all months applicable (legacy behavior).
 */
export function isFeeMonthApplicable(joiningDate, year, month) {
    if (!joiningDate)
        return true;
    const joinY = joiningDate.getUTCFullYear();
    const joinM = joiningDate.getUTCMonth() + 1;
    return monthOrdinal(year, month) >= monthOrdinal(joinY, joinM);
}
async function resolveAcademicYear(schoolId, academicYearId) {
    if (academicYearId) {
        const year = await prisma.academicYear.findFirst({
            where: { id: academicYearId, schoolId },
        });
        if (!year)
            throw notFound("Academic year not found");
        return year;
    }
    const current = await prisma.academicYear.findFirst({
        where: { schoolId, isCurrent: true },
    });
    if (!current)
        throw badRequest("No current academic year set");
    return current;
}
/**
 * amountDue is the remaining balance; amountPaid is what was paid.
 * Legacy rows stored the full fee in amountDue — normalize those on read.
 */
export function normalizeFeeAmounts(input) {
    const paid = Math.max(0, input.amountPaid || 0);
    let due = Math.max(0, input.amountDue || 0);
    const hint = typeof input.feeHint === "number" && !Number.isNaN(input.feeHint)
        ? Math.max(0, input.feeHint)
        : null;
    // Legacy PAID/WAIVED: amountDue held the fee and matched amountPaid.
    if ((input.status === "PAID" || input.status === "WAIVED") &&
        due > 0 &&
        paid >= due - 0.001) {
        return {
            status: input.status,
            amountDue: 0,
            amountPaid: paid,
            feeAmount: due,
        };
    }
    // Legacy PAID with only a partial payment stored against fee in amountDue.
    if (input.status === "PAID" && due > 0 && paid > 0 && paid < due - 0.001) {
        const remaining = Math.max(0, due - paid);
        return {
            status: remaining <= 0 ? "PAID" : "PARTIAL",
            amountDue: remaining,
            amountPaid: paid,
            feeAmount: due,
        };
    }
    // Legacy PARTIAL/UNPAID: amountDue held the fee (>= paid).
    if ((input.status === "PARTIAL" || input.status === "UNPAID") &&
        hint != null &&
        Math.abs(due - hint) < 0.01 &&
        paid < due - 0.001) {
        const remaining = Math.max(0, due - paid);
        return {
            status: paid <= 0 ? "UNPAID" : remaining <= 0 ? "PAID" : "PARTIAL",
            amountDue: remaining,
            amountPaid: paid,
            feeAmount: due,
        };
    }
    const feeAmount = hint != null ? hint : paid + due;
    return {
        status: input.status,
        amountDue: input.status === "PAID" || input.status === "WAIVED" ? 0 : due,
        amountPaid: paid,
        feeAmount,
    };
}
/** Derive remaining due + status from fee and paid amounts. */
export function resolvePaymentTotals(input) {
    const feeAmount = Math.max(0, input.feeAmount);
    let amountPaid = Math.max(0, input.amountPaid);
    if (input.status === "WAIVED") {
        return {
            status: "WAIVED",
            feeAmount,
            amountPaid,
            amountDue: 0,
        };
    }
    if (input.status === "UNPAID") {
        return {
            status: "UNPAID",
            feeAmount,
            amountPaid: 0,
            amountDue: feeAmount,
        };
    }
    // Explicit PAID with no/zero paid amount means pay in full.
    if (input.status === "PAID" && amountPaid <= 0) {
        return {
            status: "PAID",
            feeAmount,
            amountPaid: feeAmount,
            amountDue: 0,
        };
    }
    // Otherwise derive from amounts so partial payments persist correctly.
    const amountDue = Math.max(0, feeAmount - amountPaid);
    if (amountPaid <= 0) {
        return {
            status: "UNPAID",
            feeAmount,
            amountPaid: 0,
            amountDue: feeAmount,
        };
    }
    if (amountDue <= 0) {
        return {
            status: "PAID",
            feeAmount,
            amountPaid: feeAmount > 0 ? feeAmount : amountPaid,
            amountDue: 0,
        };
    }
    return {
        status: "PARTIAL",
        feeAmount,
        amountPaid,
        amountDue,
    };
}
export async function getFeeRegister(req, res) {
    try {
        const schoolId = requireSchoolId(req);
        const academicYearIdParam = typeof req.query.academicYearId === "string"
            ? req.query.academicYearId
            : undefined;
        const year = await resolveAcademicYear(schoolId, academicYearIdParam);
        const months = monthsInRange(year.startDate, year.endDate);
        const [enrollments, payments] = await Promise.all([
            prisma.enrollment.findMany({
                where: {
                    schoolId,
                    academicYearId: year.id,
                    isActive: true,
                },
                include: {
                    class: {
                        select: {
                            id: true,
                            classLevel: true,
                            section: true,
                            monthlyFee: true,
                        },
                    },
                    studentProfile: {
                        select: {
                            id: true,
                            admissionNumber: true,
                            rollNumber: true,
                            joiningDate: true,
                            user: { select: { id: true, name: true, email: true } },
                        },
                    },
                },
            }),
            prisma.studentFeePayment.findMany({
                where: { schoolId, academicYearId: year.id },
                include: {
                    createdBy: { select: { id: true, name: true, email: true } },
                    updatedBy: { select: { id: true, name: true, email: true } },
                },
            }),
        ]);
        const paymentByKey = new Map(payments.map((p) => [
            `${p.studentProfileId}:${p.year}-${String(p.month).padStart(2, "0")}`,
            p,
        ]));
        const sorted = [...enrollments].sort((a, b) => {
            const byLevel = classLevelSortIndex(a.class.classLevel) -
                classLevelSortIndex(b.class.classLevel);
            if (byLevel !== 0)
                return byLevel;
            const bySection = (a.class.section ?? "").localeCompare(b.class.section ?? "");
            if (bySection !== 0)
                return bySection;
            return (a.rollNumber ?? "").localeCompare(b.rollNumber ?? "");
        });
        res.json({
            academicYear: year,
            months,
            students: sorted.map((e) => {
                const monthlyFee = e.class.monthlyFee;
                const joiningDate = e.studentProfile.joiningDate;
                const monthMap = {};
                for (const mo of months) {
                    const applicable = isFeeMonthApplicable(joiningDate, mo.year, mo.month);
                    const hit = paymentByKey.get(`${e.studentProfileId}:${mo.year}-${String(mo.month).padStart(2, "0")}`);
                    if (!applicable) {
                        // Pre-admission: never treat as unpaid, even if a legacy row exists.
                        monthMap[mo.key] = {
                            status: "UNPAID",
                            amountDue: null,
                            amountPaid: 0,
                            feeAmount: null,
                            paidAt: null,
                            notes: null,
                            paymentId: null,
                            isApplicable: false,
                            createdBy: null,
                            updatedBy: null,
                            createdAt: null,
                            updatedAt: null,
                        };
                    }
                    else if (hit) {
                        const normalized = normalizeFeeAmounts({
                            status: hit.status,
                            amountDue: hit.amountDue,
                            amountPaid: hit.amountPaid,
                            feeHint: monthlyFee,
                        });
                        monthMap[mo.key] = {
                            status: normalized.status,
                            amountDue: normalized.amountDue,
                            amountPaid: normalized.amountPaid,
                            feeAmount: normalized.feeAmount,
                            paidAt: hit.paidAt ? hit.paidAt.toISOString() : null,
                            notes: hit.notes,
                            paymentId: hit.id,
                            isApplicable: true,
                            createdBy: hit.createdBy,
                            updatedBy: hit.updatedBy,
                            createdAt: hit.createdAt.toISOString(),
                            updatedAt: hit.updatedAt.toISOString(),
                        };
                    }
                    else {
                        monthMap[mo.key] = {
                            status: "UNPAID",
                            amountDue: monthlyFee ?? null,
                            amountPaid: 0,
                            feeAmount: monthlyFee ?? null,
                            paidAt: null,
                            notes: null,
                            paymentId: null,
                            isApplicable: true,
                            createdBy: null,
                            updatedBy: null,
                            createdAt: null,
                            updatedAt: null,
                        };
                    }
                }
                return {
                    enrollmentId: e.id,
                    studentProfileId: e.studentProfileId,
                    admissionNumber: e.studentProfile.admissionNumber,
                    rollNumber: e.rollNumber ?? e.studentProfile.rollNumber,
                    joiningDate: joiningDate ? joiningDate.toISOString() : null,
                    name: e.studentProfile.user.name,
                    email: e.studentProfile.user.email,
                    classId: e.classId,
                    classLevel: e.class.classLevel,
                    section: e.class.section,
                    className: formatClassLabel(e.class.classLevel, e.class.section),
                    monthlyFee: monthlyFee ?? null,
                    months: monthMap,
                };
            }),
        });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to load fee register");
    }
}
export async function listGradeFees(req, res) {
    try {
        const schoolId = requireSchoolId(req);
        const academicYearIdParam = typeof req.query.academicYearId === "string"
            ? req.query.academicYearId
            : undefined;
        const year = await resolveAcademicYear(schoolId, academicYearIdParam);
        const [gradeFees, classes] = await Promise.all([
            prisma.gradeFee.findMany({
                where: { schoolId, academicYearId: year.id },
                orderBy: { gradeLevel: "asc" },
            }),
            prisma.class.findMany({
                where: { schoolId, academicYearId: year.id },
                select: { classLevel: true },
            }),
        ]);
        const gradeLevels = [
            ...new Set(classes.map((c) => c.classLevel).filter(Boolean)),
        ].sort((a, b) => a.localeCompare(b));
        const feeByGrade = new Map(gradeFees.map((g) => [g.gradeLevel, g]));
        res.json({
            academicYearId: year.id,
            grades: gradeLevels.map((gradeLevel) => {
                const fee = feeByGrade.get(gradeLevel);
                return {
                    gradeLevel,
                    amount: fee?.amount ?? null,
                    currency: fee?.currency ?? "INR",
                    id: fee?.id ?? null,
                };
            }),
            gradeFees,
        });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to list grade fees");
    }
}
export async function upsertGradeFees(req, res) {
    try {
        const schoolId = requireSchoolId(req);
        const { academicYearId, rates } = req.body;
        if (!academicYearId || !Array.isArray(rates) || rates.length === 0) {
            throw badRequest("academicYearId and non-empty rates are required");
        }
        const year = await resolveAcademicYear(schoolId, academicYearId);
        for (const rate of rates) {
            if (!rate.gradeLevel || typeof rate.gradeLevel !== "string") {
                throw badRequest("Each rate needs gradeLevel");
            }
            if (typeof rate.amount !== "number" || Number.isNaN(rate.amount) || rate.amount < 0) {
                throw badRequest("Each rate needs a non-negative amount");
            }
        }
        const saved = await prisma.$transaction(rates.map((rate) => prisma.gradeFee.upsert({
            where: {
                schoolId_academicYearId_gradeLevel: {
                    schoolId,
                    academicYearId: year.id,
                    gradeLevel: rate.gradeLevel.trim(),
                },
            },
            create: {
                schoolId,
                academicYearId: year.id,
                gradeLevel: rate.gradeLevel.trim(),
                amount: rate.amount,
                currency: rate.currency ?? "INR",
            },
            update: {
                amount: rate.amount,
                ...(rate.currency ? { currency: rate.currency } : {}),
            },
        })));
        res.json({ count: saved.length, gradeFees: saved });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to save grade fees");
    }
}
export async function upsertStudentFeePayment(req, res) {
    try {
        const auth = getAuthUser(req);
        const schoolId = requireSchoolId(req);
        const { studentProfileId, academicYearId, year, month, status, amountDue: amountDueRaw, amountPaid, feeAmount: feeAmountRaw, paidAt, notes, } = req.body;
        if (!studentProfileId || !academicYearId) {
            throw badRequest("studentProfileId and academicYearId are required");
        }
        if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
            throw badRequest("year and month (1-12) are required");
        }
        if (status !== "PAID" &&
            status !== "PARTIAL" &&
            status !== "UNPAID" &&
            status !== "WAIVED") {
            throw badRequest("status must be PAID, PARTIAL, UNPAID, or WAIVED");
        }
        const academicYear = await resolveAcademicYear(schoolId, academicYearId);
        const enrollment = await prisma.enrollment.findFirst({
            where: {
                schoolId,
                studentProfileId,
                academicYearId: academicYear.id,
                isActive: true,
            },
            include: {
                class: true,
                studentProfile: { select: { joiningDate: true } },
            },
        });
        if (!enrollment) {
            throw notFound("Active enrollment not found for this student/year");
        }
        const joiningDate = enrollment.studentProfile.joiningDate;
        if (!isFeeMonthApplicable(joiningDate, year, month)) {
            throw badRequest("Fee is not applicable before the student's date of admission");
        }
        const classMonthlyFee = enrollment.class.monthlyFee ?? 0;
        const feeAmount = typeof feeAmountRaw === "number" && !Number.isNaN(feeAmountRaw) && feeAmountRaw >= 0
            ? feeAmountRaw
            : typeof amountDueRaw === "number" &&
                typeof amountPaid === "number" &&
                !Number.isNaN(amountDueRaw) &&
                !Number.isNaN(amountPaid) &&
                amountDueRaw >= 0 &&
                amountPaid >= 0 &&
                (status === "PARTIAL" || status === "UNPAID")
                ? amountDueRaw + amountPaid
                : classMonthlyFee;
        if (Number.isNaN(feeAmount) || feeAmount < 0) {
            throw badRequest("feeAmount must be a non-negative number");
        }
        const paidAmount = typeof amountPaid === "number" ? amountPaid : 0;
        if (Number.isNaN(paidAmount) || paidAmount < 0) {
            throw badRequest("amountPaid must be a non-negative number");
        }
        const resolved = resolvePaymentTotals({
            feeAmount,
            amountPaid: paidAmount,
            status,
        });
        let paidAtDate = paidAt ? new Date(paidAt) : null;
        if (paidAtDate && Number.isNaN(paidAtDate.getTime())) {
            throw badRequest("Invalid paidAt date");
        }
        if (resolved.status === "PAID" || resolved.status === "PARTIAL") {
            if (!paidAtDate) {
                throw badRequest("paidAt is required for PAID or PARTIAL status");
            }
        }
        if (resolved.status === "UNPAID") {
            paidAtDate = null;
        }
        // WAIVED: keep paidAt if provided as waiver date, else null
        const yearMonths = monthsInRange(academicYear.startDate, academicYear.endDate);
        const targetOrdinal = year * 12 + month;
        const targetInRange = yearMonths.some((m) => m.year === year && m.month === month);
        if (!targetInRange) {
            throw badRequest("Month is outside the academic year");
        }
        // PAID: also mark all earlier months in the year as paid.
        // UNPAID: also mark all later months in the year as unpaid.
        // Never cascade into months before the student's admission date.
        const monthsToUpsert = (resolved.status === "PAID"
            ? yearMonths.filter((m) => m.year * 12 + m.month <= targetOrdinal)
            : resolved.status === "UNPAID"
                ? yearMonths.filter((m) => m.year * 12 + m.month >= targetOrdinal)
                : yearMonths.filter((m) => m.year === year && m.month === month)).filter((m) => isFeeMonthApplicable(joiningDate, m.year, m.month));
        const auditInclude = {
            createdBy: { select: { id: true, name: true, email: true } },
            updatedBy: { select: { id: true, name: true, email: true } },
        };
        // Prefetch only for cascade fee hints; persistence always uses upsert.
        const existingPayments = await prisma.studentFeePayment.findMany({
            where: {
                studentProfileId,
                academicYearId: academicYear.id,
                OR: monthsToUpsert.map((m) => ({ year: m.year, month: m.month })),
            },
        });
        const existingByKey = new Map(existingPayments.map((p) => [`${p.year}-${p.month}`, p]));
        const payments = await prisma.$transaction(monthsToUpsert.map((m) => {
            const isTarget = m.year === year && m.month === month;
            const existing = existingByKey.get(`${m.year}-${m.month}`);
            const monthFee = isTarget
                ? resolved.feeAmount
                : existing
                    ? normalizeFeeAmounts({
                        status: existing.status,
                        amountDue: existing.amountDue,
                        amountPaid: existing.amountPaid,
                        feeHint: classMonthlyFee,
                    }).feeAmount
                    : classMonthlyFee;
            let monthResolved = resolved;
            if (!isTarget && resolved.status === "PAID") {
                monthResolved = resolvePaymentTotals({
                    feeAmount: monthFee,
                    amountPaid: monthFee,
                    status: "PAID",
                });
            }
            else if (!isTarget && resolved.status === "UNPAID") {
                monthResolved = resolvePaymentTotals({
                    feeAmount: monthFee,
                    amountPaid: 0,
                    status: "UNPAID",
                });
            }
            const monthPaidAt = monthResolved.status === "UNPAID" ? null : paidAtDate;
            const monthNotes = isTarget ? (notes ?? null) : null;
            return prisma.studentFeePayment.upsert({
                where: {
                    studentProfileId_academicYearId_year_month: {
                        studentProfileId,
                        academicYearId: academicYear.id,
                        year: m.year,
                        month: m.month,
                    },
                },
                create: {
                    schoolId,
                    academicYearId: academicYear.id,
                    studentProfileId,
                    classId: enrollment.classId,
                    year: m.year,
                    month: m.month,
                    status: monthResolved.status,
                    amountDue: monthResolved.amountDue,
                    amountPaid: monthResolved.amountPaid,
                    paidAt: monthPaidAt,
                    notes: monthNotes,
                    createdById: auth.userId,
                    updatedById: auth.userId,
                },
                update: {
                    classId: enrollment.classId,
                    status: monthResolved.status,
                    amountDue: monthResolved.amountDue,
                    amountPaid: monthResolved.amountPaid,
                    paidAt: monthPaidAt,
                    ...(isTarget ? { notes: monthNotes } : {}),
                    updatedById: auth.userId,
                },
                include: auditInclude,
            });
        }));
        const payment = payments.find((p) => p.year === year && p.month === month) ?? payments[0];
        res.json({
            payment: {
                ...payment,
                feeAmount: resolved.feeAmount,
            },
            cascadedCount: payments.length,
        });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to save fee payment");
    }
}
//# sourceMappingURL=fee.controller.js.map