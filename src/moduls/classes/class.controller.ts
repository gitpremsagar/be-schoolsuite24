import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import {
  CLASS_LEVELS,
  classLevelSortIndex,
  isClassLevel,
} from "../../lib/class-levels.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { getAuthUser, requireSchoolId } from "../../middleware/auth.js";
import { handleControllerError } from "../auth/auth.controller.js";
import { param } from "../../lib/params.js";

const classSubjectsInclude = {
  classSubjects: {
    include: {
      subject: true,
      staffProfile: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  },
} as const;

type ClassSubjectInput = {
  subjectId: string;
  staffProfileId?: string | null;
};

type ResolvedClassSubject = {
  schoolId: string;
  subjectId: string;
  staffProfileId: string | null;
};

function sortClasses<T extends { classLevel: string; section: string | null }>(
  classes: T[],
): T[] {
  return [...classes].sort((a, b) => {
    const byLevel =
      classLevelSortIndex(a.classLevel) - classLevelSortIndex(b.classLevel);
    if (byLevel !== 0) return byLevel;
    return (a.section ?? "").localeCompare(b.section ?? "");
  });
}

async function resolveClassSubjects(
  schoolId: string,
  subjects: unknown,
): Promise<ResolvedClassSubject[]> {
  if (subjects === undefined || subjects === null) {
    return [];
  }
  if (!Array.isArray(subjects)) {
    throw badRequest("subjects must be an array");
  }

  const bySubjectId = new Map<string, string | null>();
  for (const item of subjects) {
    if (!item || typeof item !== "object") {
      throw badRequest("each subject entry must be an object");
    }
    const entry = item as ClassSubjectInput;
    if (typeof entry.subjectId !== "string" || !entry.subjectId) {
      throw badRequest("subjectId is required for each subject entry");
    }
    const teacherId =
      typeof entry.staffProfileId === "string" && entry.staffProfileId
        ? entry.staffProfileId
        : null;
    bySubjectId.set(entry.subjectId, teacherId);
  }

  const subjectIds = [...bySubjectId.keys()];
  if (subjectIds.length === 0) {
    return [];
  }

  const foundSubjects = await prisma.subject.findMany({
    where: { schoolId, id: { in: subjectIds } },
    select: { id: true },
  });
  if (foundSubjects.length !== subjectIds.length) {
    throw badRequest("One or more subjects were not found for this school");
  }

  const teacherIds = [
    ...new Set(
      [...bySubjectId.values()].filter((id): id is string => id != null),
    ),
  ];
  if (teacherIds.length > 0) {
    const foundTeachers = await prisma.staffProfile.findMany({
      where: {
        schoolId,
        staffType: "TEACHER",
        id: { in: teacherIds },
      },
      select: { id: true },
    });
    if (foundTeachers.length !== teacherIds.length) {
      throw badRequest("One or more teachers were not found for this school");
    }
  }

  return subjectIds.map((subjectId) => ({
    schoolId,
    subjectId,
    staffProfileId: bySubjectId.get(subjectId) ?? null,
  }));
}

export async function listClasses(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const academicYearId =
      typeof req.query.academicYearId === "string"
        ? req.query.academicYearId
        : undefined;

    const classes = await prisma.class.findMany({
      where: {
        schoolId,
        ...(academicYearId ? { academicYearId } : {}),
      },
      include: {
        academicYear: true,
        classTeacher: {
          select: { id: true, name: true, email: true },
        },
        teachers: {
          include: {
            staffProfile: {
              include: {
                user: { select: { id: true, name: true, email: true } },
              },
            },
          },
        },
        ...classSubjectsInclude,
        _count: { select: { enrollments: true } },
      },
    });

    res.json({ classes: sortClasses(classes), classLevels: CLASS_LEVELS });
  } catch (error) {
    handleControllerError(res, error, "Failed to list classes");
  }
}

export async function getClass(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const id = param(req, "id");

    const klass = await prisma.class.findFirst({
      where: { id, schoolId },
      include: {
        academicYear: true,
        classTeacher: {
          select: { id: true, name: true, email: true },
        },
        teachers: {
          include: {
            staffProfile: {
              include: {
                user: { select: { id: true, name: true, email: true } },
              },
            },
          },
        },
        ...classSubjectsInclude,
        enrollments: {
          where: { isActive: true },
          include: {
            studentProfile: {
              include: {
                user: { select: { id: true, name: true, email: true } },
              },
            },
          },
          orderBy: { rollNumber: "asc" },
        },
        _count: { select: { enrollments: true } },
      },
    });

    if (!klass) {
      throw notFound("Class not found");
    }

    res.json({ class: klass });
  } catch (error) {
    handleControllerError(res, error, "Failed to get class");
  }
}

export async function createClass(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const {
      academicYearId,
      classLevel,
      section,
      monthlyFee,
      classTeacherId,
      subjects,
    } = req.body as {
      academicYearId?: string;
      classLevel?: string;
      section?: string;
      monthlyFee?: number | null;
      classTeacherId?: string;
      subjects?: ClassSubjectInput[];
    };

    if (!academicYearId || !classLevel) {
      throw badRequest("academicYearId and classLevel are required");
    }
    if (!isClassLevel(classLevel)) {
      throw badRequest(`classLevel must be one of: ${CLASS_LEVELS.join(", ")}`);
    }
    if (
      monthlyFee != null &&
      (typeof monthlyFee !== "number" ||
        Number.isNaN(monthlyFee) ||
        monthlyFee < 0)
    ) {
      throw badRequest("monthlyFee must be a non-negative number");
    }

    const year = await prisma.academicYear.findFirst({
      where: { id: academicYearId, schoolId },
    });
    if (!year) {
      throw notFound("Academic year not found");
    }

    const resolvedSubjects = await resolveClassSubjects(schoolId, subjects);

    const created = await prisma.class.create({
      data: {
        schoolId,
        academicYearId,
        classLevel,
        section: section?.trim() ? section.trim() : null,
        monthlyFee: monthlyFee ?? null,
        classTeacherId: classTeacherId ?? null,
        ...(resolvedSubjects.length > 0
          ? {
              classSubjects: {
                create: resolvedSubjects,
              },
            }
          : {}),
      },
      include: classSubjectsInclude,
    });

    res.status(201).json({ class: created });
  } catch (error) {
    handleControllerError(res, error, "Failed to create class");
  }
}

export async function updateClass(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const id = param(req, "id");

    const existing = await prisma.class.findFirst({
      where: { id, schoolId },
    });
    if (!existing) {
      throw notFound("Class not found");
    }

    const body = req.body as Record<string, unknown>;

    if (typeof body.classLevel === "string") {
      if (!isClassLevel(body.classLevel)) {
        throw badRequest(
          `classLevel must be one of: ${CLASS_LEVELS.join(", ")}`,
        );
      }
    }

    if (
      body.monthlyFee !== undefined &&
      body.monthlyFee !== null &&
      (typeof body.monthlyFee !== "number" ||
        Number.isNaN(body.monthlyFee) ||
        (body.monthlyFee as number) < 0)
    ) {
      throw badRequest("monthlyFee must be a non-negative number");
    }

    let periodCount: number | undefined;
    if (body.periodCount !== undefined) {
      if (
        typeof body.periodCount !== "number" ||
        !Number.isInteger(body.periodCount) ||
        body.periodCount < 1 ||
        body.periodCount > 12
      ) {
        throw badRequest("periodCount must be an integer between 1 and 12");
      }
      periodCount = body.periodCount;
    }

    const nextPeriodCount = periodCount ?? existing.periodCount;
    let recessAfter: number[] | undefined;
    if (body.recessAfter !== undefined) {
      if (!Array.isArray(body.recessAfter)) {
        throw badRequest("recessAfter must be an array of integers");
      }
      const values = body.recessAfter.filter(
        (n): n is number => typeof n === "number" && Number.isInteger(n),
      );
      if (values.length !== body.recessAfter.length) {
        throw badRequest("recessAfter must be an array of integers");
      }
      const unique = [
        ...new Set(
          values.filter((n) => n >= 1 && n < nextPeriodCount),
        ),
      ].sort((a, b) => a - b);
      for (const n of values) {
        if (n < 1 || n >= nextPeriodCount) {
          throw badRequest(
            `recessAfter values must be between 1 and ${nextPeriodCount - 1}`,
          );
        }
      }
      recessAfter = unique;
    } else if (periodCount !== undefined) {
      // Shrink recesses that are no longer valid
      recessAfter = existing.recessAfter
        .filter((n) => n >= 1 && n < nextPeriodCount)
        .sort((a, b) => a - b);
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (periodCount !== undefined && periodCount < existing.periodCount) {
        await tx.classTimetableSlot.deleteMany({
          where: {
            classId: id,
            schoolId,
            periodIndex: { gt: periodCount },
          },
        });
      }

      return tx.class.update({
        where: { id },
        data: {
          ...(typeof body.classLevel === "string"
            ? { classLevel: body.classLevel }
            : {}),
          ...(typeof body.section === "string" || body.section === null
            ? {
                section:
                  typeof body.section === "string" && body.section.trim()
                    ? body.section.trim()
                    : null,
              }
            : {}),
          ...(body.monthlyFee === null || typeof body.monthlyFee === "number"
            ? { monthlyFee: body.monthlyFee as number | null }
            : {}),
          ...(typeof body.classTeacherId === "string" ||
          body.classTeacherId === null
            ? { classTeacherId: body.classTeacherId as string | null }
            : {}),
          ...(periodCount !== undefined ? { periodCount } : {}),
          ...(recessAfter !== undefined ? { recessAfter } : {}),
        },
        include: classSubjectsInclude,
      });
    });

    res.json({ class: updated });
  } catch (error) {
    handleControllerError(res, error, "Failed to update class");
  }
}

export async function setClassSubjects(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const id = param(req, "id");
    const { subjects } = req.body as { subjects?: ClassSubjectInput[] };

    const existing = await prisma.class.findFirst({
      where: { id, schoolId },
    });
    if (!existing) {
      throw notFound("Class not found");
    }

    const resolvedSubjects = await resolveClassSubjects(
      schoolId,
      subjects ?? [],
    );

    const updated = await prisma.$transaction(async (tx) => {
      await tx.classSubject.deleteMany({ where: { classId: id, schoolId } });
      if (resolvedSubjects.length > 0) {
        await tx.classSubject.createMany({
          data: resolvedSubjects.map((row) => ({
            ...row,
            classId: id,
          })),
        });
      }
      return tx.class.findFirst({
        where: { id, schoolId },
        include: classSubjectsInclude,
      });
    });

    res.json({ class: updated });
  } catch (error) {
    handleControllerError(res, error, "Failed to update class subjects");
  }
}

export async function getClassTimetable(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const id = param(req, "id");

    const [klass, school] = await Promise.all([
      prisma.class.findFirst({
        where: { id, schoolId },
        include: {
          ...classSubjectsInclude,
          timetableSlots: {
            include: { subject: true },
            orderBy: [{ dayOfWeek: "asc" }, { periodIndex: "asc" }],
          },
        },
      }),
      prisma.school.findUnique({
        where: { id: schoolId },
        select: { saturdayIsWorkingDay: true },
      }),
    ]);

    if (!klass) {
      throw notFound("Class not found");
    }

    const teacherBySubjectId = new Map(
      klass.classSubjects.map((cs) => [
        cs.subjectId,
        cs.staffProfile
          ? {
              id: cs.staffProfile.id,
              name: cs.staffProfile.user.name,
              email: cs.staffProfile.user.email,
            }
          : null,
      ]),
    );

    const slots = klass.timetableSlots.map((slot) => ({
      id: slot.id,
      dayOfWeek: slot.dayOfWeek,
      periodIndex: slot.periodIndex,
      subjectId: slot.subjectId,
      subject: slot.subject,
      teacher: teacherBySubjectId.get(slot.subjectId) ?? null,
    }));

    res.json({
      periodCount: klass.periodCount,
      recessAfter: klass.recessAfter,
      saturdayIsWorkingDay: school?.saturdayIsWorkingDay !== false,
      slots,
    });
  } catch (error) {
    handleControllerError(res, error, "Failed to get class timetable");
  }
}

export async function setClassTimetable(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const id = param(req, "id");
    const { slots } = req.body as {
      slots?: Array<{
        dayOfWeek?: number;
        periodIndex?: number;
        subjectId?: string;
      }>;
    };

    const [klass, school] = await Promise.all([
      prisma.class.findFirst({
        where: { id, schoolId },
        include: { classSubjects: { select: { subjectId: true } } },
      }),
      prisma.school.findUnique({
        where: { id: schoolId },
        select: { saturdayIsWorkingDay: true },
      }),
    ]);

    if (!klass) {
      throw notFound("Class not found");
    }

    if (!Array.isArray(slots)) {
      throw badRequest("slots must be an array");
    }

    const maxDay = school?.saturdayIsWorkingDay === false ? 5 : 6;
    const allowedSubjectIds = new Set(
      klass.classSubjects.map((cs) => cs.subjectId),
    );
    const seen = new Set<string>();
    const normalized: Array<{
      schoolId: string;
      classId: string;
      dayOfWeek: number;
      periodIndex: number;
      subjectId: string;
    }> = [];

    for (const slot of slots) {
      if (
        typeof slot.dayOfWeek !== "number" ||
        !Number.isInteger(slot.dayOfWeek) ||
        slot.dayOfWeek < 1 ||
        slot.dayOfWeek > maxDay
      ) {
        throw badRequest(
          `dayOfWeek must be an integer between 1 and ${maxDay}`,
        );
      }
      if (
        typeof slot.periodIndex !== "number" ||
        !Number.isInteger(slot.periodIndex) ||
        slot.periodIndex < 1 ||
        slot.periodIndex > klass.periodCount
      ) {
        throw badRequest(
          `periodIndex must be an integer between 1 and ${klass.periodCount}`,
        );
      }
      if (typeof slot.subjectId !== "string" || !slot.subjectId) {
        throw badRequest("subjectId is required for each slot");
      }
      if (!allowedSubjectIds.has(slot.subjectId)) {
        throw badRequest(
          "One or more subjects are not assigned to this class",
        );
      }
      const key = `${slot.dayOfWeek}:${slot.periodIndex}`;
      if (seen.has(key)) {
        throw badRequest(
          `Duplicate slot for day ${slot.dayOfWeek} period ${slot.periodIndex}`,
        );
      }
      seen.add(key);
      normalized.push({
        schoolId,
        classId: id,
        dayOfWeek: slot.dayOfWeek,
        periodIndex: slot.periodIndex,
        subjectId: slot.subjectId,
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.classTimetableSlot.deleteMany({
        where: { classId: id, schoolId },
      });
      if (normalized.length > 0) {
        await tx.classTimetableSlot.createMany({ data: normalized });
      }
    });

    const refreshed = await prisma.class.findFirst({
      where: { id, schoolId },
      include: {
        ...classSubjectsInclude,
        timetableSlots: {
          include: { subject: true },
          orderBy: [{ dayOfWeek: "asc" }, { periodIndex: "asc" }],
        },
      },
    });

    const teacherBySubjectId = new Map(
      (refreshed?.classSubjects ?? []).map((cs) => [
        cs.subjectId,
        cs.staffProfile
          ? {
              id: cs.staffProfile.id,
              name: cs.staffProfile.user.name,
              email: cs.staffProfile.user.email,
            }
          : null,
      ]),
    );

    res.json({
      periodCount: refreshed!.periodCount,
      recessAfter: refreshed!.recessAfter,
      saturdayIsWorkingDay: school?.saturdayIsWorkingDay !== false,
      slots: (refreshed?.timetableSlots ?? []).map((slot) => ({
        id: slot.id,
        dayOfWeek: slot.dayOfWeek,
        periodIndex: slot.periodIndex,
        subjectId: slot.subjectId,
        subject: slot.subject,
        teacher: teacherBySubjectId.get(slot.subjectId) ?? null,
      })),
    });
  } catch (error) {
    handleControllerError(res, error, "Failed to update class timetable");
  }
}

export async function assignTeacher(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const id = param(req, "id");
    const { staffProfileId, isPrimary } = req.body as {
      staffProfileId?: string;
      isPrimary?: boolean;
    };

    if (!id || !staffProfileId) {
      throw badRequest("class id and staffProfileId are required");
    }

    const [klass, staff] = await Promise.all([
      prisma.class.findFirst({ where: { id, schoolId } }),
      prisma.staffProfile.findFirst({
        where: { id: staffProfileId, schoolId, staffType: "TEACHER" },
      }),
    ]);

    if (!klass) {
      throw notFound("Class not found");
    }
    if (!staff) {
      throw notFound("Teacher staff profile not found");
    }

    const assignment = await prisma.classTeacher.upsert({
      where: {
        classId_staffProfileId: {
          classId: id,
          staffProfileId,
        },
      },
      create: {
        schoolId,
        classId: id,
        staffProfileId,
        isPrimary: Boolean(isPrimary),
      },
      update: {
        isPrimary: Boolean(isPrimary),
      },
    });

    if (isPrimary) {
      await prisma.class.update({
        where: { id },
        data: { classTeacherId: staff.userId },
      });
    }

    res.status(201).json({ assignment });
  } catch (error) {
    handleControllerError(res, error, "Failed to assign teacher");
  }
}

export async function listMyClasses(req: Request, res: Response) {
  try {
    const auth = getAuthUser(req);
    const schoolId = requireSchoolId(req);

    if (auth.role === "TEACHER") {
      const staff = await prisma.staffProfile.findUnique({
        where: { userId: auth.userId },
      });
      if (!staff) {
        res.json({ classes: [] });
        return;
      }

      const classInclude = {
        academicYear: true,
        ...classSubjectsInclude,
        _count: { select: { enrollments: true } },
      } as const;

      const [homeroomAssignments, subjectLinks] = await Promise.all([
        prisma.classTeacher.findMany({
          where: { schoolId, staffProfileId: staff.id },
          include: { class: { include: classInclude } },
        }),
        prisma.classSubject.findMany({
          where: { schoolId, staffProfileId: staff.id },
          select: { classId: true },
        }),
      ]);

      const primaryByClassId = new Map(
        homeroomAssignments.map((a) => [a.classId, a.isPrimary]),
      );
      const classesById = new Map(
        homeroomAssignments.map((a) => [a.class.id, a.class]),
      );

      const missingClassIds = [
        ...new Set(
          subjectLinks
            .map((link) => link.classId)
            .filter((classId) => !classesById.has(classId)),
        ),
      ];

      if (missingClassIds.length > 0) {
        const subjectClasses = await prisma.class.findMany({
          where: { schoolId, id: { in: missingClassIds } },
          include: classInclude,
        });
        for (const klass of subjectClasses) {
          classesById.set(klass.id, klass);
        }
      }

      res.json({
        classes: sortClasses(
          [...classesById.values()].map((klass) => ({
            ...klass,
            isPrimary: primaryByClassId.get(klass.id) ?? false,
          })),
        ),
      });
      return;
    }

    const classes = await prisma.class.findMany({
      where: { schoolId },
      include: {
        academicYear: true,
        ...classSubjectsInclude,
        _count: { select: { enrollments: true } },
      },
    });
    res.json({ classes: sortClasses(classes) });
  } catch (error) {
    handleControllerError(res, error, "Failed to list classes");
  }
}
