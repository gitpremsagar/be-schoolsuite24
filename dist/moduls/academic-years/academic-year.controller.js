import { prisma } from "../../lib/prisma.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { requireSchoolId } from "../../middleware/auth.js";
import { handleControllerError } from "../auth/auth.controller.js";
import { param } from "../../lib/params.js";
export async function listAcademicYears(req, res) {
    try {
        const schoolId = requireSchoolId(req);
        const years = await prisma.academicYear.findMany({
            where: { schoolId },
            orderBy: { startDate: "desc" },
        });
        res.json({ academicYears: years });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to list academic years");
    }
}
export async function createAcademicYear(req, res) {
    try {
        const schoolId = requireSchoolId(req);
        const { name, startDate, endDate, isCurrent } = req.body;
        if (!name || !startDate || !endDate) {
            throw badRequest("name, startDate, and endDate are required");
        }
        const year = await prisma.$transaction(async (tx) => {
            if (isCurrent) {
                await tx.academicYear.updateMany({
                    where: { schoolId, isCurrent: true },
                    data: { isCurrent: false },
                });
            }
            return tx.academicYear.create({
                data: {
                    schoolId,
                    name,
                    startDate: new Date(startDate),
                    endDate: new Date(endDate),
                    isCurrent: Boolean(isCurrent),
                },
            });
        });
        res.status(201).json({ academicYear: year });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to create academic year");
    }
}
export async function updateAcademicYear(req, res) {
    try {
        const schoolId = requireSchoolId(req);
        const id = param(req, "id");
        const existing = await prisma.academicYear.findFirst({
            where: { id, schoolId },
        });
        if (!existing) {
            throw notFound("Academic year not found");
        }
        const body = req.body;
        const year = await prisma.$transaction(async (tx) => {
            if (body.isCurrent) {
                await tx.academicYear.updateMany({
                    where: { schoolId, isCurrent: true },
                    data: { isCurrent: false },
                });
            }
            return tx.academicYear.update({
                where: { id },
                data: {
                    ...(body.name ? { name: body.name } : {}),
                    ...(body.startDate ? { startDate: new Date(body.startDate) } : {}),
                    ...(body.endDate ? { endDate: new Date(body.endDate) } : {}),
                    ...(typeof body.isCurrent === "boolean"
                        ? { isCurrent: body.isCurrent }
                        : {}),
                },
            });
        });
        res.json({ academicYear: year });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to update academic year");
    }
}
//# sourceMappingURL=academic-year.controller.js.map