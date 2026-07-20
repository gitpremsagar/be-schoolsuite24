import type { Request, Response } from "express";
import type { FeeStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import {
  classLevelSortIndex,
  formatClassLabel,
} from "../../lib/class-levels.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { getAuthUser, requireSchoolId } from "../../middleware/auth.js";
import { handleControllerError } from "../auth/auth.controller.js";

/** Inclusive calendar months between two dates (UTC). */
export function monthsInRange(
  start: Date,
  end: Date,
): Array<{ year: number; month: number; key: string; label: string }> {
  const months: Array<{
    year: number;
    month: number;
    key: string;
    label: string;
  }> = [];
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

async function resolveAcademicYear(schoolId: string, academicYearId?: string) {
  if (academicYearId) {
    const year = await prisma.academicYear.findFirst({
      where: { id: academicYearId, schoolId },
    });
    if (!year) throw notFound("Academic year not found");
    return year;
  }
  const current = await prisma.academicYear.findFirst({
    where: { schoolId, isCurrent: true },
  });
  if (!current) throw badRequest("No current academic year set");
  return current;
}

export async function getFeeRegister(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const academicYearIdParam =
      typeof req.query.academicYearId === "string"
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
            include: {
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

    const paymentByKey = new Map(
      payments.map((p) => [
        `${p.studentProfileId}:${p.year}-${String(p.month).padStart(2, "0")}`,
        p,
      ]),
    );

    const sorted = [...enrollments].sort((a, b) => {
      const byLevel =
        classLevelSortIndex(a.class.classLevel) -
        classLevelSortIndex(b.class.classLevel);
      if (byLevel !== 0) return byLevel;
      const bySection = (a.class.section ?? "").localeCompare(
        b.class.section ?? "",
      );
      if (bySection !== 0) return bySection;
      return (a.rollNumber ?? "").localeCompare(b.rollNumber ?? "");
    });

    res.json({
      academicYear: year,
      months,
      students: sorted.map((e) => {
        const monthlyFee = e.class.monthlyFee;
        const monthMap: Record<
          string,
          {
            status: FeeStatus;
            amountDue: number | null;
            amountPaid: number;
            paidAt: string | null;
            notes: string | null;
            paymentId: string | null;
            createdBy: { id: string; name: string; email: string } | null;
            updatedBy: { id: string; name: string; email: string } | null;
            createdAt: string | null;
            updatedAt: string | null;
          }
        > = {};

        for (const mo of months) {
          const hit = paymentByKey.get(
            `${e.studentProfileId}:${mo.year}-${String(mo.month).padStart(2, "0")}`,
          );
          if (hit) {
            monthMap[mo.key] = {
              status: hit.status,
              amountDue: hit.amountDue,
              amountPaid: hit.amountPaid,
              paidAt: hit.paidAt ? hit.paidAt.toISOString() : null,
              notes: hit.notes,
              paymentId: hit.id,
              createdBy: hit.createdBy,
              updatedBy: hit.updatedBy,
              createdAt: hit.createdAt.toISOString(),
              updatedAt: hit.updatedAt.toISOString(),
            };
          } else {
            monthMap[mo.key] = {
              status: "UNPAID",
              amountDue: monthlyFee ?? null,
              amountPaid: 0,
              paidAt: null,
              notes: null,
              paymentId: null,
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
  } catch (error) {
    handleControllerError(res, error, "Failed to load fee register");
  }
}

export async function listGradeFees(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const academicYearIdParam =
      typeof req.query.academicYearId === "string"
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
  } catch (error) {
    handleControllerError(res, error, "Failed to list grade fees");
  }
}

export async function upsertGradeFees(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const { academicYearId, rates } = req.body as {
      academicYearId?: string;
      rates?: Array<{ gradeLevel: string; amount: number; currency?: string }>;
    };

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

    const saved = await prisma.$transaction(
      rates.map((rate) =>
        prisma.gradeFee.upsert({
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
        }),
      ),
    );

    res.json({ count: saved.length, gradeFees: saved });
  } catch (error) {
    handleControllerError(res, error, "Failed to save grade fees");
  }
}

export async function upsertStudentFeePayment(req: Request, res: Response) {
  try {
    const auth = getAuthUser(req);
    const schoolId = requireSchoolId(req);
    const {
      studentProfileId,
      academicYearId,
      year,
      month,
      status,
      amountDue: amountDueRaw,
      amountPaid,
      paidAt,
      notes,
    } = req.body as {
      studentProfileId?: string;
      academicYearId?: string;
      year?: number;
      month?: number;
      status?: FeeStatus;
      amountDue?: number;
      amountPaid?: number;
      paidAt?: string | null;
      notes?: string | null;
    };

    if (!studentProfileId || !academicYearId) {
      throw badRequest("studentProfileId and academicYearId are required");
    }
    if (!Number.isInteger(year) || !Number.isInteger(month) || month! < 1 || month! > 12) {
      throw badRequest("year and month (1-12) are required");
    }
    if (
      status !== "PAID" &&
      status !== "PARTIAL" &&
      status !== "UNPAID" &&
      status !== "WAIVED"
    ) {
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
      include: { class: true },
    });
    if (!enrollment) {
      throw notFound("Active enrollment not found for this student/year");
    }

    const amountDue =
      typeof amountDueRaw === "number"
        ? amountDueRaw
        : (enrollment.class.monthlyFee ?? 0);
    if (typeof amountDue !== "number" || Number.isNaN(amountDue) || amountDue < 0) {
      throw badRequest("amountDue must be a non-negative number");
    }

    let paidAmount = typeof amountPaid === "number" ? amountPaid : 0;
    if (Number.isNaN(paidAmount) || paidAmount < 0) {
      throw badRequest("amountPaid must be a non-negative number");
    }

    let paidAtDate: Date | null = paidAt ? new Date(paidAt) : null;
    if (paidAtDate && Number.isNaN(paidAtDate.getTime())) {
      throw badRequest("Invalid paidAt date");
    }

    if (status === "PAID" || status === "PARTIAL") {
      if (!paidAtDate) {
        throw badRequest("paidAt is required for PAID or PARTIAL status");
      }
      if (status === "PAID" && amountDue > 0 && paidAmount <= 0) {
        paidAmount = amountDue;
      }
    }

    if (status === "UNPAID") {
      paidAtDate = null;
    }

    // WAIVED: keep paidAt if provided as waiver date, else null

    const existing = await prisma.studentFeePayment.findUnique({
      where: {
        studentProfileId_academicYearId_year_month: {
          studentProfileId,
          academicYearId: academicYear.id,
          year: year!,
          month: month!,
        },
      },
    });

    const auditInclude = {
      createdBy: { select: { id: true, name: true, email: true } },
      updatedBy: { select: { id: true, name: true, email: true } },
    } as const;

    const payment = existing
      ? await prisma.studentFeePayment.update({
          where: { id: existing.id },
          data: {
            classId: enrollment.classId,
            status,
            amountDue,
            amountPaid: paidAmount,
            paidAt: paidAtDate,
            notes: notes ?? null,
            updatedById: auth.userId,
          },
          include: auditInclude,
        })
      : await prisma.studentFeePayment.create({
          data: {
            schoolId,
            academicYearId: academicYear.id,
            studentProfileId,
            classId: enrollment.classId,
            year: year!,
            month: month!,
            status,
            amountDue,
            amountPaid: paidAmount,
            paidAt: paidAtDate,
            notes: notes ?? null,
            createdById: auth.userId,
            updatedById: auth.userId,
          },
          include: auditInclude,
        });

    res.json({ payment });
  } catch (error) {
    handleControllerError(res, error, "Failed to save fee payment");
  }
}
