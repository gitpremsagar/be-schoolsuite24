import type { Request, Response } from "express";
import type { EventFeeScope, FeeStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import {
  classLevelSortIndex,
  formatClassLabel,
} from "../../lib/class-levels.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { getAuthUser, requireSchoolId } from "../../middleware/auth.js";
import { handleControllerError } from "../auth/auth.controller.js";
import { resolvePaymentTotals } from "../fees/fee.controller.js";

const auditUserSelect = {
  id: true,
  name: true,
  email: true,
} as const;

const eventFeeInclude = {
  classes: {
    include: {
      class: {
        select: {
          id: true,
          classLevel: true,
          section: true,
        },
      },
    },
  },
  createdBy: { select: auditUserSelect },
  updatedBy: { select: auditUserSelect },
  academicYear: {
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      isCurrent: true,
    },
  },
} as const;

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

function parseOptionalDate(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    throw badRequest(`${field} must be a date string or null`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest(`Invalid ${field}`);
  return d;
}

function paramId(value: string | string[] | undefined, label = "id"): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || typeof id !== "string") {
    throw badRequest(`Event fee ${label} is required`);
  }
  return id;
}

function isStudentApplicableToEvent(input: {
  joiningDate: Date | null | undefined;
  eventDate: Date | null | undefined;
}): boolean {
  if (!input.eventDate || !input.joiningDate) return true;
  // Student who joined after the event date is not applicable.
  return input.joiningDate.getTime() <= input.eventDate.getTime();
}

async function loadEventFeeOrThrow(schoolId: string, id: string) {
  const event = await prisma.eventFee.findFirst({
    where: { id, schoolId },
    include: eventFeeInclude,
  });
  if (!event) throw notFound("Event fee not found");
  return event;
}

async function countApplicableStudents(
  schoolId: string,
  event: {
    id: string;
    academicYearId: string;
    scope: EventFeeScope;
    eventDate: Date | null;
    classes: Array<{ classId: string }>;
  },
) {
  const classIds =
    event.scope === "CLASSES" ? event.classes.map((c) => c.classId) : undefined;

  const enrollments = await prisma.enrollment.findMany({
    where: {
      schoolId,
      academicYearId: event.academicYearId,
      isActive: true,
      ...(classIds ? { classId: { in: classIds } } : {}),
      studentProfile: { isCurrentlyStudying: true },
    },
    select: {
      studentProfileId: true,
      studentProfile: { select: { joiningDate: true } },
    },
  });

  return enrollments.filter((e) =>
    isStudentApplicableToEvent({
      joiningDate: e.studentProfile.joiningDate,
      eventDate: event.eventDate,
    }),
  ).length;
}

function serializeEvent(
  event: Awaited<ReturnType<typeof loadEventFeeOrThrow>>,
  summary?: {
    totalApplicable: number;
    paid: number;
    partial: number;
    unpaid: number;
    waived: number;
  },
) {
  return {
    id: event.id,
    schoolId: event.schoolId,
    academicYearId: event.academicYearId,
    academicYear: event.academicYear,
    name: event.name,
    description: event.description,
    amount: event.amount,
    currency: event.currency,
    scope: event.scope,
    eventDate: event.eventDate?.toISOString() ?? null,
    dueDate: event.dueDate?.toISOString() ?? null,
    isActive: event.isActive,
    classes: event.classes.map((c) => ({
      id: c.id,
      classId: c.classId,
      classLevel: c.class.classLevel,
      section: c.class.section,
      label: formatClassLabel(c.class.classLevel, c.class.section),
    })),
    createdBy: event.createdBy,
    updatedBy: event.updatedBy,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
    ...(summary ? { summary } : {}),
  };
}

export async function listEventFees(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const academicYearIdParam =
      typeof req.query.academicYearId === "string"
        ? req.query.academicYearId
        : undefined;
    const includeInactive = req.query.includeInactive === "1";
    const year = await resolveAcademicYear(schoolId, academicYearIdParam);

    const events = await prisma.eventFee.findMany({
      where: {
        schoolId,
        academicYearId: year.id,
        ...(includeInactive ? {} : { isActive: true }),
      },
      include: eventFeeInclude,
      orderBy: [{ createdAt: "desc" }],
    });

    const paymentGroups = await prisma.eventFeePayment.groupBy({
      by: ["eventFeeId", "status"],
      where: {
        schoolId,
        eventFeeId: { in: events.map((e) => e.id) },
      },
      _count: { _all: true },
    });

    const statusCounts = new Map<string, Record<FeeStatus, number>>();
    for (const g of paymentGroups) {
      const map = statusCounts.get(g.eventFeeId) ?? {
        PAID: 0,
        PARTIAL: 0,
        UNPAID: 0,
        WAIVED: 0,
      };
      map[g.status] = g._count._all;
      statusCounts.set(g.eventFeeId, map);
    }

    const items = await Promise.all(
      events.map(async (event) => {
        const totalApplicable = await countApplicableStudents(schoolId, event);
        const counts = statusCounts.get(event.id) ?? {
          PAID: 0,
          PARTIAL: 0,
          UNPAID: 0,
          WAIVED: 0,
        };
        const accounted =
          counts.PAID + counts.PARTIAL + counts.UNPAID + counts.WAIVED;
        const unpaidSynthesized = Math.max(0, totalApplicable - accounted);
        return serializeEvent(event, {
          totalApplicable,
          paid: counts.PAID,
          partial: counts.PARTIAL,
          unpaid: counts.UNPAID + unpaidSynthesized,
          waived: counts.WAIVED,
        });
      }),
    );

    res.json({
      academicYear: year,
      eventFees: items,
    });
  } catch (error) {
    handleControllerError(res, error, "Failed to list event fees");
  }
}

export async function createEventFee(req: Request, res: Response) {
  try {
    const auth = getAuthUser(req);
    const schoolId = requireSchoolId(req);
    const {
      academicYearId,
      name,
      description,
      amount,
      currency,
      scope,
      classIds,
      eventDate,
      dueDate,
    } = req.body as {
      academicYearId?: string;
      name?: string;
      description?: string | null;
      amount?: number;
      currency?: string;
      scope?: EventFeeScope;
      classIds?: string[];
      eventDate?: string | null;
      dueDate?: string | null;
    };

    const trimmedName = typeof name === "string" ? name.trim() : "";
    if (!trimmedName) throw badRequest("name is required");
    if (typeof amount !== "number" || Number.isNaN(amount) || amount <= 0) {
      throw badRequest("amount must be a positive number");
    }
    if (scope !== "SCHOOL" && scope !== "CLASSES") {
      throw badRequest("scope must be SCHOOL or CLASSES");
    }

    const year = await resolveAcademicYear(schoolId, academicYearId);
    const parsedEventDate = parseOptionalDate(eventDate, "eventDate");
    const parsedDueDate = parseOptionalDate(dueDate, "dueDate");

    let uniqueClassIds: string[] = [];
    if (scope === "CLASSES") {
      if (!Array.isArray(classIds) || classIds.length === 0) {
        throw badRequest("classIds are required when scope is CLASSES");
      }
      uniqueClassIds = [...new Set(classIds.filter((id) => typeof id === "string"))];
      if (uniqueClassIds.length === 0) {
        throw badRequest("classIds are required when scope is CLASSES");
      }
      const classes = await prisma.class.findMany({
        where: {
          id: { in: uniqueClassIds },
          schoolId,
          academicYearId: year.id,
        },
        select: { id: true },
      });
      if (classes.length !== uniqueClassIds.length) {
        throw badRequest(
          "One or more classes are invalid for this school/academic year",
        );
      }
    }

    const created = await prisma.eventFee.create({
      data: {
        schoolId,
        academicYearId: year.id,
        name: trimmedName,
        description:
          typeof description === "string" && description.trim()
            ? description.trim()
            : null,
        amount,
        currency: currency?.trim() || "INR",
        scope,
        eventDate: parsedEventDate ?? null,
        dueDate: parsedDueDate ?? null,
        createdById: auth.userId,
        updatedById: auth.userId,
        ...(uniqueClassIds.length > 0
          ? {
              classes: {
                create: uniqueClassIds.map((classId) => ({ classId })),
              },
            }
          : {}),
      },
      include: eventFeeInclude,
    });

    const totalApplicable = await countApplicableStudents(schoolId, created);
    res.status(201).json({
      eventFee: serializeEvent(created, {
        totalApplicable,
        paid: 0,
        partial: 0,
        unpaid: totalApplicable,
        waived: 0,
      }),
    });
  } catch (error) {
    handleControllerError(res, error, "Failed to create event fee");
  }
}

export async function getEventFee(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const id = paramId(req.params.id);

    const event = await loadEventFeeOrThrow(schoolId, id);
    const totalApplicable = await countApplicableStudents(schoolId, event);

    const payments = await prisma.eventFeePayment.groupBy({
      by: ["status"],
      where: { schoolId, eventFeeId: event.id },
      _count: { _all: true },
    });
    const counts = { PAID: 0, PARTIAL: 0, UNPAID: 0, WAIVED: 0 };
    for (const p of payments) counts[p.status] = p._count._all;
    const accounted =
      counts.PAID + counts.PARTIAL + counts.UNPAID + counts.WAIVED;

    res.json({
      eventFee: serializeEvent(event, {
        totalApplicable,
        paid: counts.PAID,
        partial: counts.PARTIAL,
        unpaid: counts.UNPAID + Math.max(0, totalApplicable - accounted),
        waived: counts.WAIVED,
      }),
    });
  } catch (error) {
    handleControllerError(res, error, "Failed to get event fee");
  }
}

export async function updateEventFee(req: Request, res: Response) {
  try {
    const auth = getAuthUser(req);
    const schoolId = requireSchoolId(req);
    const id = paramId(req.params.id);

    const existing = await loadEventFeeOrThrow(schoolId, id);
    const {
      name,
      description,
      amount,
      currency,
      scope,
      classIds,
      eventDate,
      dueDate,
      isActive,
    } = req.body as {
      name?: string;
      description?: string | null;
      amount?: number;
      currency?: string;
      scope?: EventFeeScope;
      classIds?: string[];
      eventDate?: string | null;
      dueDate?: string | null;
      isActive?: boolean;
    };

    const scopeChanging =
      (scope !== undefined && scope !== existing.scope) ||
      (Array.isArray(classIds) && scope !== "SCHOOL");

    let nextScope = existing.scope;
    let nextClassIds: string[] | null = null;

    if (scope !== undefined || classIds !== undefined) {
      nextScope = scope ?? existing.scope;
      if (nextScope !== "SCHOOL" && nextScope !== "CLASSES") {
        throw badRequest("scope must be SCHOOL or CLASSES");
      }

      if (nextScope === "SCHOOL") {
        nextClassIds = [];
      } else {
        const incoming =
          classIds ?? existing.classes.map((c) => c.classId);
        nextClassIds = [
          ...new Set(incoming.filter((cid) => typeof cid === "string")),
        ];
        if (nextClassIds.length === 0) {
          throw badRequest("classIds are required when scope is CLASSES");
        }
      }

      const existingClassKey = existing.classes
        .map((c) => c.classId)
        .sort()
        .join(",");
      const nextClassKey = [...(nextClassIds ?? [])].sort().join(",");
      const classesChanging = existingClassKey !== nextClassKey;
      const reallyChanging =
        nextScope !== existing.scope || classesChanging;

      if (reallyChanging || scopeChanging) {
        const paymentCount = await prisma.eventFeePayment.count({
          where: { eventFeeId: existing.id },
        });
        if (paymentCount > 0) {
          throw badRequest(
            "Cannot change scope or classes after payments have been recorded",
          );
        }
      }

      if (nextScope === "CLASSES" && nextClassIds) {
        const classes = await prisma.class.findMany({
          where: {
            id: { in: nextClassIds },
            schoolId,
            academicYearId: existing.academicYearId,
          },
          select: { id: true },
        });
        if (classes.length !== nextClassIds.length) {
          throw badRequest(
            "One or more classes are invalid for this school/academic year",
          );
        }
      }
    }

    if (amount !== undefined) {
      if (typeof amount !== "number" || Number.isNaN(amount) || amount <= 0) {
        throw badRequest("amount must be a positive number");
      }
    }

    let nextName: string | undefined;
    if (name !== undefined) {
      nextName = name.trim();
      if (!nextName) throw badRequest("name is required");
    }

    const parsedEventDate = parseOptionalDate(eventDate, "eventDate");
    const parsedDueDate = parseOptionalDate(dueDate, "dueDate");

    const updated = await prisma.$transaction(async (tx) => {
      if (nextClassIds !== null) {
        await tx.eventFeeClass.deleteMany({ where: { eventFeeId: existing.id } });
        if (nextClassIds.length > 0) {
          await tx.eventFeeClass.createMany({
            data: nextClassIds.map((classId) => ({
              eventFeeId: existing.id,
              classId,
            })),
          });
        }
      }

      return tx.eventFee.update({
        where: { id: existing.id },
        data: {
          ...(nextName !== undefined ? { name: nextName } : {}),
          ...(description !== undefined
            ? {
                description:
                  typeof description === "string" && description.trim()
                    ? description.trim()
                    : null,
              }
            : {}),
          ...(amount !== undefined ? { amount } : {}),
          ...(currency !== undefined
            ? { currency: currency.trim() || "INR" }
            : {}),
          ...(nextClassIds !== null ? { scope: nextScope } : {}),
          ...(parsedEventDate !== undefined ? { eventDate: parsedEventDate } : {}),
          ...(parsedDueDate !== undefined ? { dueDate: parsedDueDate } : {}),
          ...(typeof isActive === "boolean" ? { isActive } : {}),
          updatedById: auth.userId,
        },
        include: eventFeeInclude,
      });
    });

    const totalApplicable = await countApplicableStudents(schoolId, updated);
    const payments = await prisma.eventFeePayment.groupBy({
      by: ["status"],
      where: { schoolId, eventFeeId: updated.id },
      _count: { _all: true },
    });
    const counts = { PAID: 0, PARTIAL: 0, UNPAID: 0, WAIVED: 0 };
    for (const p of payments) counts[p.status] = p._count._all;
    const accounted =
      counts.PAID + counts.PARTIAL + counts.UNPAID + counts.WAIVED;

    res.json({
      eventFee: serializeEvent(updated, {
        totalApplicable,
        paid: counts.PAID,
        partial: counts.PARTIAL,
        unpaid: counts.UNPAID + Math.max(0, totalApplicable - accounted),
        waived: counts.WAIVED,
      }),
    });
  } catch (error) {
    handleControllerError(res, error, "Failed to update event fee");
  }
}

export async function deactivateEventFee(req: Request, res: Response) {
  try {
    const auth = getAuthUser(req);
    const schoolId = requireSchoolId(req);
    const id = paramId(req.params.id);

    const existing = await loadEventFeeOrThrow(schoolId, id);
    const updated = await prisma.eventFee.update({
      where: { id: existing.id },
      data: { isActive: false, updatedById: auth.userId },
      include: eventFeeInclude,
    });

    res.json({ eventFee: serializeEvent(updated) });
  } catch (error) {
    handleControllerError(res, error, "Failed to deactivate event fee");
  }
}

export async function getEventFeeRegister(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const id = paramId(req.params.id);

    const event = await loadEventFeeOrThrow(schoolId, id);
    const classIds =
      event.scope === "CLASSES"
        ? event.classes.map((c) => c.classId)
        : undefined;

    const [enrollments, payments] = await Promise.all([
      prisma.enrollment.findMany({
        where: {
          schoolId,
          academicYearId: event.academicYearId,
          isActive: true,
          ...(classIds ? { classId: { in: classIds } } : {}),
          studentProfile: { isCurrentlyStudying: true },
        },
        include: {
          class: {
            select: { id: true, classLevel: true, section: true },
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
      prisma.eventFeePayment.findMany({
        where: { schoolId, eventFeeId: event.id },
        include: {
          createdBy: { select: auditUserSelect },
          updatedBy: { select: auditUserSelect },
        },
      }),
    ]);

    const paymentByStudent = new Map(
      payments.map((p) => [p.studentProfileId, p]),
    );

    const students = enrollments
      .filter((e) =>
        isStudentApplicableToEvent({
          joiningDate: e.studentProfile.joiningDate,
          eventDate: event.eventDate,
        }),
      )
      .sort((a, b) => {
        const byLevel =
          classLevelSortIndex(a.class.classLevel) -
          classLevelSortIndex(b.class.classLevel);
        if (byLevel !== 0) return byLevel;
        const bySection = (a.class.section ?? "").localeCompare(
          b.class.section ?? "",
        );
        if (bySection !== 0) return bySection;
        return (a.studentProfile.user.name ?? "").localeCompare(
          b.studentProfile.user.name ?? "",
        );
      })
      .map((e) => {
        const hit = paymentByStudent.get(e.studentProfileId);
        const payment = hit
          ? {
              status: hit.status,
              amountDue: hit.amountDue,
              amountPaid: hit.amountPaid,
              feeAmount: event.amount,
              paidAt: hit.paidAt?.toISOString() ?? null,
              notes: hit.notes,
              paymentId: hit.id,
              createdBy: hit.createdBy,
              updatedBy: hit.updatedBy,
              createdAt: hit.createdAt.toISOString(),
              updatedAt: hit.updatedAt.toISOString(),
            }
          : {
              status: "UNPAID" as FeeStatus,
              amountDue: event.amount,
              amountPaid: 0,
              feeAmount: event.amount,
              paidAt: null,
              notes: null,
              paymentId: null,
              createdBy: null,
              updatedBy: null,
              createdAt: null,
              updatedAt: null,
            };

        return {
          studentProfileId: e.studentProfileId,
          admissionNumber: e.studentProfile.admissionNumber,
          rollNumber: e.studentProfile.rollNumber ?? e.rollNumber,
          name: e.studentProfile.user.name,
          email: e.studentProfile.user.email,
          classId: e.classId,
          classLabel: formatClassLabel(e.class.classLevel, e.class.section),
          classLevel: e.class.classLevel,
          section: e.class.section,
          payment,
        };
      });

    const summary = {
      totalApplicable: students.length,
      paid: students.filter((s) => s.payment.status === "PAID").length,
      partial: students.filter((s) => s.payment.status === "PARTIAL").length,
      unpaid: students.filter((s) => s.payment.status === "UNPAID").length,
      waived: students.filter((s) => s.payment.status === "WAIVED").length,
    };

    res.json({
      event: serializeEvent(event, summary),
      students,
    });
  } catch (error) {
    handleControllerError(res, error, "Failed to load event fee register");
  }
}

export async function upsertEventFeePayment(req: Request, res: Response) {
  try {
    const auth = getAuthUser(req);
    const schoolId = requireSchoolId(req);
    const id = paramId(req.params.id);

    const {
      studentProfileId,
      status,
      amountPaid,
      paidAt,
      notes,
    } = req.body as {
      studentProfileId?: string;
      status?: FeeStatus;
      amountPaid?: number;
      paidAt?: string | null;
      notes?: string | null;
    };

    if (!studentProfileId) throw badRequest("studentProfileId is required");
    if (
      status !== "PAID" &&
      status !== "PARTIAL" &&
      status !== "UNPAID" &&
      status !== "WAIVED"
    ) {
      throw badRequest("status must be PAID, PARTIAL, UNPAID, or WAIVED");
    }

    const event = await loadEventFeeOrThrow(schoolId, id);
    if (!event.isActive) {
      throw badRequest("Cannot record payments for an inactive event fee");
    }

    const classIds =
      event.scope === "CLASSES"
        ? event.classes.map((c) => c.classId)
        : undefined;

    const enrollment = await prisma.enrollment.findFirst({
      where: {
        schoolId,
        studentProfileId,
        academicYearId: event.academicYearId,
        isActive: true,
        ...(classIds ? { classId: { in: classIds } } : {}),
        studentProfile: { isCurrentlyStudying: true },
      },
      include: {
        studentProfile: { select: { joiningDate: true } },
      },
    });
    if (!enrollment) {
      throw badRequest("Student is not applicable for this event fee");
    }
    if (
      !isStudentApplicableToEvent({
        joiningDate: enrollment.studentProfile.joiningDate,
        eventDate: event.eventDate,
      })
    ) {
      throw badRequest("Student joined after this event and is not applicable");
    }

    const paidAmount = typeof amountPaid === "number" ? amountPaid : 0;
    if (Number.isNaN(paidAmount) || paidAmount < 0) {
      throw badRequest("amountPaid must be a non-negative number");
    }

    const resolved = resolvePaymentTotals({
      feeAmount: event.amount,
      amountPaid: paidAmount,
      status,
    });

    let paidAtDate: Date | null = paidAt ? new Date(paidAt) : null;
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

    const payment = await prisma.eventFeePayment.upsert({
      where: {
        eventFeeId_studentProfileId: {
          eventFeeId: event.id,
          studentProfileId,
        },
      },
      create: {
        schoolId,
        eventFeeId: event.id,
        studentProfileId,
        classId: enrollment.classId,
        status: resolved.status,
        amountDue: resolved.amountDue,
        amountPaid: resolved.amountPaid,
        paidAt: paidAtDate,
        notes: notes ?? null,
        createdById: auth.userId,
        updatedById: auth.userId,
      },
      update: {
        classId: enrollment.classId,
        status: resolved.status,
        amountDue: resolved.amountDue,
        amountPaid: resolved.amountPaid,
        paidAt: paidAtDate,
        notes: notes ?? null,
        updatedById: auth.userId,
      },
      include: {
        createdBy: { select: auditUserSelect },
        updatedBy: { select: auditUserSelect },
      },
    });

    res.json({
      payment: {
        ...payment,
        feeAmount: resolved.feeAmount,
        paidAt: payment.paidAt?.toISOString() ?? null,
        createdAt: payment.createdAt.toISOString(),
        updatedAt: payment.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    handleControllerError(res, error, "Failed to save event fee payment");
  }
}
