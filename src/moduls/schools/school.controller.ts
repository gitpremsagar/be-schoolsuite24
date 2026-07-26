import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { getAuthUser, requireSchoolId } from "../../middleware/auth.js";
import { handleControllerError } from "../auth/auth.controller.js";

export async function getMySchool(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      include: {
        subscription: { include: { plan: true } },
        _count: {
          select: {
            studentProfiles: true,
            staffProfiles: true,
            classes: true,
          },
        },
      },
    });
    if (!school) {
      throw notFound("School not found");
    }
    res.json({ school });
  } catch (error) {
    handleControllerError(res, error, "Failed to fetch school");
  }
}

export async function updateMySchool(req: Request, res: Response) {
  try {
    const auth = getAuthUser(req);
    if (auth.role !== "ADMIN" && auth.role !== "SUPER_ADMIN") {
      throw forbidden();
    }
    const schoolId = requireSchoolId(req);
    const body = req.body as Record<string, unknown>;
    const adminPassword =
      typeof body.adminPassword === "string" ? body.adminPassword : "";

    if (!adminPassword) {
      throw badRequest("Admin password is required to update school settings");
    }

    const admin = await prisma.user.findUnique({
      where: { id: auth.userId },
    });
    if (!admin || (admin.schoolId && admin.schoolId !== schoolId)) {
      throw forbidden("Admin not found for this school");
    }

    const valid = await bcrypt.compare(adminPassword, admin.password);
    if (!valid) {
      throw forbidden("Incorrect admin password");
    }

    const school = await prisma.school.update({
      where: { id: schoolId },
      data: {
        ...(typeof body.name === "string" ? { name: body.name } : {}),
        ...(typeof body.code === "string" || body.code === null
          ? { code: body.code as string | null }
          : {}),
        ...(typeof body.email === "string" || body.email === null
          ? { email: body.email as string | null }
          : {}),
        ...(typeof body.phone === "string" || body.phone === null
          ? { phone: body.phone as string | null }
          : {}),
        ...(typeof body.addressLine1 === "string" || body.addressLine1 === null
          ? { addressLine1: body.addressLine1 as string | null }
          : {}),
        ...(typeof body.addressLine2 === "string" || body.addressLine2 === null
          ? { addressLine2: body.addressLine2 as string | null }
          : {}),
        ...(typeof body.city === "string" || body.city === null
          ? { city: body.city as string | null }
          : {}),
        ...(typeof body.state === "string" || body.state === null
          ? { state: body.state as string | null }
          : {}),
        ...(typeof body.country === "string" || body.country === null
          ? { country: body.country as string | null }
          : {}),
        ...(typeof body.postalCode === "string" || body.postalCode === null
          ? { postalCode: body.postalCode as string | null }
          : {}),
        ...(typeof body.logoUrl === "string" || body.logoUrl === null
          ? { logoUrl: body.logoUrl as string | null }
          : {}),
        ...(typeof body.establishedYear === "number" ||
        body.establishedYear === null
          ? { establishedYear: body.establishedYear as number | null }
          : {}),
        ...(typeof body.saturdayIsWorkingDay === "boolean"
          ? { saturdayIsWorkingDay: body.saturdayIsWorkingDay }
          : {}),
      },
    });

    res.json({ school });
  } catch (error) {
    handleControllerError(res, error, "Failed to update school");
  }
}

export async function getSchoolDashboard(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const [
      students,
      staff,
      classes,
      studentAttendanceToday,
      staffAttendanceToday,
      subscription,
    ] = await Promise.all([
      prisma.studentProfile.count({ where: { schoolId } }),
      prisma.staffProfile.count({ where: { schoolId } }),
      prisma.class.count({ where: { schoolId } }),
      prisma.studentAttendance.count({
        where: { schoolId, date: todayStart },
      }),
      prisma.staffAttendance.count({
        where: { schoolId, date: todayStart },
      }),
      prisma.schoolSubscription.findUnique({
        where: { schoolId },
        include: { plan: true },
      }),
    ]);

    const activeEnrollments = await prisma.enrollment.count({
      where: { schoolId, isActive: true },
    });

    res.json({
      students,
      staff,
      classes,
      studentAttendanceToday,
      staffAttendanceToday,
      activeEnrollments,
      subscription,
      dueAmount: (subscription?.pricePerStudent ?? 0) * activeEnrollments,
    });
  } catch (error) {
    handleControllerError(res, error, "Failed to load dashboard");
  }
}

void badRequest;
