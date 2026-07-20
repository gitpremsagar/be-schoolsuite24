import { prisma } from "../../lib/prisma.js";
import { CLASS_LEVELS, classLevelSortIndex, isClassLevel, } from "../../lib/class-levels.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { getAuthUser, requireSchoolId } from "../../middleware/auth.js";
import { handleControllerError } from "../auth/auth.controller.js";
import { param } from "../../lib/params.js";
function sortClasses(classes) {
    return [...classes].sort((a, b) => {
        const byLevel = classLevelSortIndex(a.classLevel) - classLevelSortIndex(b.classLevel);
        if (byLevel !== 0)
            return byLevel;
        return (a.section ?? "").localeCompare(b.section ?? "");
    });
}
export async function listClasses(req, res) {
    try {
        const schoolId = requireSchoolId(req);
        const academicYearId = typeof req.query.academicYearId === "string"
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
                _count: { select: { enrollments: true } },
            },
        });
        res.json({ classes: sortClasses(classes), classLevels: CLASS_LEVELS });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to list classes");
    }
}
export async function createClass(req, res) {
    try {
        const schoolId = requireSchoolId(req);
        const { academicYearId, classLevel, section, monthlyFee, classTeacherId, } = req.body;
        if (!academicYearId || !classLevel) {
            throw badRequest("academicYearId and classLevel are required");
        }
        if (!isClassLevel(classLevel)) {
            throw badRequest(`classLevel must be one of: ${CLASS_LEVELS.join(", ")}`);
        }
        if (monthlyFee != null &&
            (typeof monthlyFee !== "number" ||
                Number.isNaN(monthlyFee) ||
                monthlyFee < 0)) {
            throw badRequest("monthlyFee must be a non-negative number");
        }
        const year = await prisma.academicYear.findFirst({
            where: { id: academicYearId, schoolId },
        });
        if (!year) {
            throw notFound("Academic year not found");
        }
        const created = await prisma.class.create({
            data: {
                schoolId,
                academicYearId,
                classLevel,
                section: section?.trim() ? section.trim() : null,
                monthlyFee: monthlyFee ?? null,
                classTeacherId: classTeacherId ?? null,
            },
        });
        res.status(201).json({ class: created });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to create class");
    }
}
export async function updateClass(req, res) {
    try {
        const schoolId = requireSchoolId(req);
        const id = param(req, "id");
        const existing = await prisma.class.findFirst({
            where: { id, schoolId },
        });
        if (!existing) {
            throw notFound("Class not found");
        }
        const body = req.body;
        if (typeof body.classLevel === "string") {
            if (!isClassLevel(body.classLevel)) {
                throw badRequest(`classLevel must be one of: ${CLASS_LEVELS.join(", ")}`);
            }
        }
        if (body.monthlyFee !== undefined &&
            body.monthlyFee !== null &&
            (typeof body.monthlyFee !== "number" ||
                Number.isNaN(body.monthlyFee) ||
                body.monthlyFee < 0)) {
            throw badRequest("monthlyFee must be a non-negative number");
        }
        const updated = await prisma.class.update({
            where: { id },
            data: {
                ...(typeof body.classLevel === "string"
                    ? { classLevel: body.classLevel }
                    : {}),
                ...(typeof body.section === "string" || body.section === null
                    ? {
                        section: typeof body.section === "string" && body.section.trim()
                            ? body.section.trim()
                            : null,
                    }
                    : {}),
                ...(body.monthlyFee === null || typeof body.monthlyFee === "number"
                    ? { monthlyFee: body.monthlyFee }
                    : {}),
                ...(typeof body.classTeacherId === "string" ||
                    body.classTeacherId === null
                    ? { classTeacherId: body.classTeacherId }
                    : {}),
            },
        });
        res.json({ class: updated });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to update class");
    }
}
export async function assignTeacher(req, res) {
    try {
        const schoolId = requireSchoolId(req);
        const id = param(req, "id");
        const { staffProfileId, isPrimary } = req.body;
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
    }
    catch (error) {
        handleControllerError(res, error, "Failed to assign teacher");
    }
}
export async function listMyClasses(req, res) {
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
            const assignments = await prisma.classTeacher.findMany({
                where: { schoolId, staffProfileId: staff.id },
                include: {
                    class: {
                        include: {
                            academicYear: true,
                            _count: { select: { enrollments: true } },
                        },
                    },
                },
            });
            res.json({
                classes: sortClasses(assignments.map((a) => ({
                    ...a.class,
                    isPrimary: a.isPrimary,
                }))),
            });
            return;
        }
        const classes = await prisma.class.findMany({
            where: { schoolId },
            include: {
                academicYear: true,
                _count: { select: { enrollments: true } },
            },
        });
        res.json({ classes: sortClasses(classes) });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to list classes");
    }
}
//# sourceMappingURL=class.controller.js.map