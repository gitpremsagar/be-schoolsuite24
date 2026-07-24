import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { getAuthUser, requireSchoolId } from "../../middleware/auth.js";
import { handleControllerError } from "../auth/auth.controller.js";
import { param } from "../../lib/params.js";
import { normalizeClassLevel } from "../../lib/class-levels.js";

type StudentCreateInput = {
  email?: string;
  password?: string;
  name?: string;
  phone?: string;
  admissionNumber?: string;
  rollNumber?: string;
  dateOfBirth?: string;
  gender?: string;
  fatherName?: string;
  motherName?: string;
  guardianName?: string;
  guardianPhone?: string;
  guardianEmail?: string;
  permanentAddress?: string;
  currentAddress?: string;
  address?: string;
  bloodGroup?: string;
  joiningDate?: string;
  leavingDate?: string | null;
  isCurrentlyStudying?: boolean | string;
  classId?: string;
  academicYearId?: string;
  academicYear?: string;
  classLevel?: string;
  section?: string;
};

function parseStudyingFlag(value: boolean | string | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "false" || v === "0" || v === "no") return false;
    if (v === "true" || v === "1" || v === "yes") return true;
  }
  return true;
}

async function createOneStudent(schoolId: string, input: StudentCreateInput) {
  const {
    email,
    password,
    name,
    phone,
    admissionNumber,
    rollNumber,
    dateOfBirth,
    gender,
    fatherName,
    motherName,
    guardianName,
    guardianPhone,
    guardianEmail,
    permanentAddress,
    currentAddress,
    address,
    bloodGroup,
    joiningDate,
    leavingDate,
    isCurrentlyStudying,
    classId: classIdInput,
    academicYearId: academicYearIdInput,
    academicYear,
    classLevel,
    section,
  } = input;

  if (!email?.trim() || !password || !name?.trim() || !admissionNumber?.trim()) {
    throw badRequest(
      "email, password, name, and admissionNumber are required",
    );
  }
  if (password.length < 8) {
    throw badRequest("Password must be at least 8 characters");
  }

  const studying = parseStudyingFlag(isCurrentlyStudying);

  const enrollHints = [academicYear, classLevel, section].map((v) =>
    typeof v === "string" ? v.trim() : "",
  );
  const enrollHintCount = enrollHints.filter(Boolean).length;
  if (enrollHintCount > 0 && enrollHintCount < 3) {
    throw badRequest(
      "academicYear, classLevel, and section must be provided together",
    );
  }

  let classId = classIdInput?.trim() || undefined;
  let academicYearId = academicYearIdInput?.trim() || undefined;

  if (enrollHintCount === 3) {
    const year = await prisma.academicYear.findFirst({
      where: { schoolId, name: academicYear!.trim() },
    });
    if (!year) {
      throw badRequest(`Academic year not found: ${academicYear}`);
    }
    const level = normalizeClassLevel(classLevel);
    if (!level) {
      throw badRequest(`Invalid classLevel: ${classLevel}`);
    }
    const sectionValue = section!.trim();
    const klass = await prisma.class.findFirst({
      where: {
        schoolId,
        academicYearId: year.id,
        classLevel: level,
        section: sectionValue,
      },
    });
    if (!klass) {
      throw badRequest(
        `Class not found: ${level} - ${sectionValue} (${year.name})`,
      );
    }
    classId = klass.id;
    academicYearId = year.id;
  }

  if ((classId && !academicYearId) || (!classId && academicYearId)) {
    throw badRequest("classId and academicYearId must be provided together");
  }

  if (classId && academicYearId) {
    const klass = await prisma.class.findFirst({
      where: { id: classId, schoolId, academicYearId },
    });
    if (!klass) {
      throw badRequest("Invalid class or academic year");
    }
  }

  const existing = await prisma.user.findUnique({ where: { email: email.trim() } });
  if (existing) {
    throw conflict("Email already registered");
  }

  const takenAdmission = await prisma.studentProfile.findFirst({
    where: { schoolId, admissionNumber: admissionNumber.trim() },
  });
  if (takenAdmission) {
    throw conflict("Admission number already in use");
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: email.trim(),
        password: hashedPassword,
        name: name.trim(),
        phone: phone?.trim() ? phone.trim() : null,
        role: "STUDENT",
        schoolId,
        isActive: true,
      },
    });

    const profile = await tx.studentProfile.create({
      data: {
        userId: user.id,
        schoolId,
        admissionNumber: admissionNumber.trim(),
        rollNumber: rollNumber?.trim() ? rollNumber.trim() : null,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        gender: gender ?? null,
        fatherName: fatherName?.trim() ? fatherName.trim() : null,
        motherName: motherName?.trim() ? motherName.trim() : null,
        guardianName: guardianName ?? null,
        guardianPhone: guardianPhone ?? null,
        guardianEmail: guardianEmail ?? null,
        permanentAddress: permanentAddress?.trim()
          ? permanentAddress.trim()
          : null,
        currentAddress: currentAddress?.trim()
          ? currentAddress.trim()
          : null,
        address: address ?? null,
        bloodGroup: bloodGroup?.trim() ? bloodGroup.trim() : null,
        joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
        isCurrentlyStudying: studying,
        leavingDate: studying || !leavingDate ? null : new Date(leavingDate),
      },
    });

    let enrollment = null;
    if (classId && academicYearId) {
      enrollment = await tx.enrollment.create({
        data: {
          schoolId,
          studentProfileId: profile.id,
          classId,
          academicYearId,
          rollNumber: rollNumber?.trim() ? rollNumber.trim() : null,
          isActive: true,
        },
      });
    }

    return { user, profile, enrollment };
  });
}

export async function listStudents(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const wantAll =
      req.query.all === "1" ||
      req.query.all === "true";
    let academicYearId =
      typeof req.query.academicYearId === "string" && req.query.academicYearId.trim()
        ? req.query.academicYearId
        : undefined;

    if (!wantAll && !academicYearId) {
      const current = await prisma.academicYear.findFirst({
        where: { schoolId, isCurrent: true },
      });
      academicYearId = current?.id;
    }

    const students = await prisma.studentProfile.findMany({
      where: {
        schoolId,
        ...(!wantAll && academicYearId
          ? {
              // Enrolled in this year, or not assigned to any class for this year yet.
              OR: [
                {
                  enrollments: {
                    some: { academicYearId, isActive: true },
                  },
                },
                {
                  enrollments: {
                    none: { academicYearId },
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            isActive: true,
          },
        },
        enrollments: {
          where: {
            isActive: true,
            ...(!wantAll && academicYearId ? { academicYearId } : {}),
          },
          include: {
            class: true,
            academicYear: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({
      students,
      academicYearId: wantAll ? null : academicYearId ?? null,
    });
  } catch (error) {
    handleControllerError(res, error, "Failed to list students");
  }
}

export async function createStudent(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const result = await createOneStudent(
      schoolId,
      req.body as StudentCreateInput,
    );

    const { password: _p, ...safeUser } = result.user;
    res.status(201).json({
      student: {
        ...result.profile,
        user: safeUser,
        enrollment: result.enrollment,
      },
    });
  } catch (error) {
    handleControllerError(res, error, "Failed to create student");
  }
}

export async function bulkCreateStudents(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const { students, rowOffset } = req.body as {
      students?: unknown;
      rowOffset?: number;
    };

    if (!Array.isArray(students)) {
      throw badRequest("students must be an array");
    }
    if (students.length === 0) {
      throw badRequest("students array is empty");
    }
    if (students.length > 200) {
      throw badRequest("Cannot import more than 200 students at once");
    }

    const baseRow =
      typeof rowOffset === "number" &&
      Number.isInteger(rowOffset) &&
      rowOffset >= 0
        ? rowOffset
        : 2;

    let created = 0;
    const failed: Array<{ row: number; email?: string; error: string }> = [];

    for (let i = 0; i < students.length; i++) {
      const row = students[i];
      const rowNum = baseRow + i;
      const input =
        row && typeof row === "object"
          ? (row as StudentCreateInput)
          : ({} as StudentCreateInput);
      const email =
        typeof input.email === "string" ? input.email.trim() : undefined;

      try {
        await createOneStudent(schoolId, input);
        created += 1;
      } catch (error) {
        const message =
          error instanceof AppError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Failed to create student";
        failed.push({
          row: rowNum,
          ...(email ? { email } : {}),
          error: message,
        });
      }
    }

    res.status(201).json({ created, failed });
  } catch (error) {
    handleControllerError(res, error, "Failed to bulk create students");
  }
}

export async function enrollStudent(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const id = param(req, "id");
    const { classId, academicYearId, rollNumber } = req.body as {
      classId?: string;
      academicYearId?: string;
      rollNumber?: string;
    };

    if (!id || !classId || !academicYearId) {
      throw badRequest("student id, classId, and academicYearId are required");
    }

    const profile = await prisma.studentProfile.findFirst({
      where: { id, schoolId },
    });
    if (!profile) {
      throw notFound("Student not found");
    }

    const klass = await prisma.class.findFirst({
      where: { id: classId, schoolId, academicYearId },
    });
    if (!klass) {
      throw notFound("Class not found for academic year");
    }

    const enrollment = await prisma.enrollment.upsert({
      where: {
        studentProfileId_academicYearId: {
          studentProfileId: id,
          academicYearId,
        },
      },
      create: {
        schoolId,
        studentProfileId: id,
        classId,
        academicYearId,
        rollNumber: rollNumber ?? null,
        isActive: true,
      },
      update: {
        classId,
        rollNumber: rollNumber ?? null,
        isActive: true,
        leftOn: null,
      },
      include: { class: true, academicYear: true },
    });

    res.status(201).json({ enrollment });
  } catch (error) {
    handleControllerError(res, error, "Failed to enroll student");
  }
}

export async function getStudent(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const id = param(req, "id");

    const student = await prisma.studentProfile.findFirst({
      where: { id, schoolId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            isActive: true,
          },
        },
        enrollments: {
          include: { class: true, academicYear: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!student) {
      throw notFound("Student not found");
    }

    res.json({ student });
  } catch (error) {
    handleControllerError(res, error, "Failed to fetch student");
  }
}

export async function updateStudent(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const id = param(req, "id");
    const {
      email,
      password,
      name,
      phone,
      admissionNumber,
      rollNumber,
      fatherName,
      motherName,
      guardianName,
      guardianPhone,
      guardianEmail,
      permanentAddress,
      currentAddress,
      address,
      gender,
      bloodGroup,
      dateOfBirth,
      joiningDate,
      leavingDate,
      isCurrentlyStudying,
      classId,
      academicYearId,
      isActive,
    } = req.body as {
      email?: string;
      password?: string;
      name?: string;
      phone?: string | null;
      admissionNumber?: string;
      rollNumber?: string | null;
      fatherName?: string;
      motherName?: string;
      guardianName?: string | null;
      guardianPhone?: string | null;
      guardianEmail?: string | null;
      permanentAddress?: string | null;
      currentAddress?: string | null;
      address?: string | null;
      gender?: string | null;
      bloodGroup?: string | null;
      dateOfBirth?: string | null;
      joiningDate?: string | null;
      leavingDate?: string | null;
      isCurrentlyStudying?: boolean;
      classId?: string;
      academicYearId?: string;
      isActive?: boolean;
    };

    const existing = await prisma.studentProfile.findFirst({
      where: { id, schoolId },
      include: { user: true },
    });
    if (!existing) {
      throw notFound("Student not found");
    }

    if (password != null && password !== "" && password.length < 8) {
      throw badRequest("Password must be at least 8 characters");
    }

    if (email && email !== existing.user.email) {
      const taken = await prisma.user.findUnique({ where: { email } });
      if (taken) {
        throw conflict("Email already registered");
      }
    }

    if (admissionNumber && admissionNumber !== existing.admissionNumber) {
      const takenAdmission = await prisma.studentProfile.findFirst({
        where: {
          schoolId,
          admissionNumber,
          NOT: { id },
        },
      });
      if (takenAdmission) {
        throw conflict("Admission number already in use");
      }
    }

    if ((classId && !academicYearId) || (!classId && academicYearId)) {
      throw badRequest("classId and academicYearId must be provided together");
    }

    if (classId && academicYearId) {
      const klass = await prisma.class.findFirst({
        where: { id: classId, schoolId, academicYearId },
      });
      if (!klass) {
        throw notFound("Class not found for academic year");
      }
    }

    const hashedPassword =
      password && password.length >= 8
        ? await bcrypt.hash(password, 12)
        : undefined;

    const result = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: existing.userId },
        data: {
          ...(typeof name === "string" ? { name } : {}),
          ...(typeof email === "string" ? { email } : {}),
          ...(phone !== undefined ? { phone: phone || null } : {}),
          ...(typeof isActive === "boolean" ? { isActive } : {}),
          ...(hashedPassword ? { password: hashedPassword } : {}),
        },
      });

      const profile = await tx.studentProfile.update({
        where: { id },
        data: {
          ...(typeof admissionNumber === "string"
            ? { admissionNumber }
            : {}),
          ...(rollNumber !== undefined ? { rollNumber: rollNumber || null } : {}),
          ...(fatherName !== undefined
            ? { fatherName: String(fatherName).trim() || null }
            : {}),
          ...(motherName !== undefined
            ? { motherName: String(motherName).trim() || null }
            : {}),
          ...(guardianName !== undefined
            ? { guardianName: guardianName || null }
            : {}),
          ...(guardianPhone !== undefined
            ? { guardianPhone: guardianPhone || null }
            : {}),
          ...(guardianEmail !== undefined
            ? { guardianEmail: guardianEmail || null }
            : {}),
          ...(permanentAddress !== undefined
            ? { permanentAddress: permanentAddress || null }
            : {}),
          ...(currentAddress !== undefined
            ? { currentAddress: currentAddress || null }
            : {}),
          ...(address !== undefined ? { address: address || null } : {}),
          ...(gender !== undefined ? { gender: gender || null } : {}),
          ...(bloodGroup !== undefined
            ? { bloodGroup: bloodGroup || null }
            : {}),
          ...(dateOfBirth !== undefined
            ? {
                dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
              }
            : {}),
          ...(joiningDate !== undefined
            ? {
                joiningDate: joiningDate ? new Date(joiningDate) : null,
              }
            : {}),
          ...(leavingDate !== undefined
            ? {
                leavingDate: leavingDate ? new Date(leavingDate) : null,
              }
            : {}),
          ...(typeof isCurrentlyStudying === "boolean"
            ? {
                isCurrentlyStudying,
                ...(isCurrentlyStudying ? { leavingDate: null } : {}),
              }
            : {}),
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              isActive: true,
            },
          },
        },
      });

      let enrollment = null;
      if (classId && academicYearId) {
        enrollment = await tx.enrollment.upsert({
          where: {
            studentProfileId_academicYearId: {
              studentProfileId: id,
              academicYearId,
            },
          },
          create: {
            schoolId,
            studentProfileId: id,
            classId,
            academicYearId,
            rollNumber: rollNumber ?? profile.rollNumber ?? null,
            isActive: true,
          },
          update: {
            classId,
            ...(rollNumber !== undefined
              ? { rollNumber: rollNumber || null }
              : {}),
            isActive: true,
            leftOn: null,
          },
          include: { class: true, academicYear: true },
        });
      }

      const enrollments = await tx.enrollment.findMany({
        where: { studentProfileId: id },
        include: { class: true, academicYear: true },
        orderBy: { createdAt: "desc" },
      });

      return { profile, enrollment, enrollments };
    });

    res.json({
      student: {
        ...result.profile,
        enrollments: result.enrollments,
        enrollment: result.enrollment,
      },
    });
  } catch (error) {
    handleControllerError(res, error, "Failed to update student");
  }
}

export async function getMyStudentProfile(req: Request, res: Response) {
  try {
    const auth = getAuthUser(req);
    const profile = await prisma.studentProfile.findUnique({
      where: { userId: auth.userId },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true },
        },
        enrollments: {
          where: { isActive: true },
          include: { class: true, academicYear: true },
        },
      },
    });
    if (!profile) {
      throw notFound("Student profile not found");
    }
    res.json({ student: profile });
  } catch (error) {
    handleControllerError(res, error, "Failed to fetch student profile");
  }
}

/** Permanently delete a student after verifying the admin's own password. */
export async function purgeStudent(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const auth = getAuthUser(req);
    const id = param(req, "id");
    const { password } = req.body as { password?: string };

    if (!password) {
      throw badRequest(
        "Admin password is required to permanently delete a student",
      );
    }

    const existing = await prisma.studentProfile.findFirst({
      where: { id, schoolId },
      include: {
        user: { select: { id: true, role: true } },
      },
    });
    if (!existing) {
      throw notFound("Student not found");
    }

    if (existing.userId === auth.userId) {
      throw forbidden("You cannot permanently delete your own account");
    }

    const admin = await prisma.user.findUnique({
      where: { id: auth.userId },
    });
    if (!admin || admin.schoolId !== schoolId) {
      throw forbidden("Admin not found for this school");
    }

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) {
      throw forbidden("Incorrect admin password");
    }

    const userId = existing.userId;

    await prisma.$transaction(async (tx) => {
      await tx.studentFeePayment.deleteMany({
        where: { studentProfileId: id },
      });
      await tx.studentAttendance.deleteMany({
        where: { studentProfileId: id },
      });
      await tx.enrollment.deleteMany({
        where: { studentProfileId: id },
      });
      await tx.studentAttendance.updateMany({
        where: { markedById: userId },
        data: { markedById: auth.userId },
      });
      await tx.studentFeePayment.updateMany({
        where: { createdById: userId },
        data: { createdById: auth.userId },
      });
      await tx.studentFeePayment.updateMany({
        where: { updatedById: userId },
        data: { updatedById: auth.userId },
      });

      await tx.studentProfile.delete({ where: { id } });
      await tx.user.delete({ where: { id: userId } });
    });

    res.json({ ok: true, permanent: true });
  } catch (error) {
    handleControllerError(res, error, "Failed to permanently delete student");
  }
}
