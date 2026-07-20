import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { getAuthUser, requireSchoolId } from "../../middleware/auth.js";
import { handleControllerError } from "../auth/auth.controller.js";
import { param } from "../../lib/params.js";
const TIME_HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;
function parseOptionalTime(value, fieldName) {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    const raw = String(value).trim();
    if (!TIME_HH_MM.test(raw)) {
        throw badRequest(`${fieldName} must be HH:mm (24-hour)`);
    }
    return raw;
}
function minutesFromHhMm(value) {
    const [h = 0, m = 0] = value.split(":").map(Number);
    return h * 60 + m;
}
const staffInclude = {
    user: {
        select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
            isActive: true,
        },
    },
    classAssignments: {
        include: { class: true },
    },
    school: {
        select: { ownerId: true },
    },
};
function isProtectedAdminAccount(staff) {
    return (staff.staffType === "ADMIN" ||
        staff.user.role === "ADMIN" ||
        staff.user.role === "SUPER_ADMIN" ||
        staff.school.ownerId === staff.userId);
}
export async function listStaff(req, res) {
    try {
        const schoolId = requireSchoolId(req);
        const staffType = typeof req.query.staffType === "string" ? req.query.staffType : undefined;
        const staff = await prisma.staffProfile.findMany({
            where: {
                schoolId,
                ...(staffType ? { staffType: staffType } : {}),
            },
            include: staffInclude,
            orderBy: { createdAt: "desc" },
        });
        res.json({ staff });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to list staff");
    }
}
export async function createStaff(req, res) {
    try {
        const schoolId = requireSchoolId(req);
        const { email, password, name, phone, staffType, employeeCode, designation, department, joiningDate, leavingDate, isCurrentlyWorking, expectedPunchInTime, expectedPunchOutTime, } = req.body;
        if (!email || !password || !name || !staffType || !employeeCode) {
            throw badRequest("email, password, name, staffType, and employeeCode are required");
        }
        if (staffType !== "TEACHER" && staffType !== "EMPLOYEE") {
            throw badRequest("staffType must be TEACHER or EMPLOYEE");
        }
        if (password.length < 8) {
            throw badRequest("Password must be at least 8 characters");
        }
        const currentlyWorking = typeof isCurrentlyWorking === "boolean" ? isCurrentlyWorking : true;
        const punchInTime = parseOptionalTime(expectedPunchInTime, "expectedPunchInTime");
        const punchOutTime = parseOptionalTime(expectedPunchOutTime, "expectedPunchOutTime");
        if (punchInTime &&
            punchOutTime &&
            minutesFromHhMm(punchOutTime) <= minutesFromHhMm(punchInTime)) {
            throw badRequest("expectedPunchOutTime must be after expectedPunchInTime");
        }
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            throw conflict("Email already registered");
        }
        const role = staffType;
        const hashedPassword = await bcrypt.hash(password, 12);
        const result = await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    email,
                    password: hashedPassword,
                    name,
                    phone: phone ?? null,
                    role,
                    schoolId,
                    isActive: true,
                },
            });
            const profile = await tx.staffProfile.create({
                data: {
                    userId: user.id,
                    schoolId,
                    staffType,
                    employeeCode,
                    designation: designation ?? null,
                    department: department ?? null,
                    joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
                    isCurrentlyWorking: currentlyWorking,
                    leavingDate: currentlyWorking || !leavingDate ? null : new Date(leavingDate),
                    expectedPunchInTime: punchInTime,
                    expectedPunchOutTime: punchOutTime,
                },
            });
            return { user, profile };
        });
        const { password: _p, ...safeUser } = result.user;
        res.status(201).json({
            staff: {
                ...result.profile,
                user: safeUser,
            },
        });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to create staff");
    }
}
export async function getStaff(req, res) {
    try {
        const schoolId = requireSchoolId(req);
        const id = param(req, "id");
        const staff = await prisma.staffProfile.findFirst({
            where: { id, schoolId },
            include: staffInclude,
        });
        if (!staff) {
            throw notFound("Staff not found");
        }
        res.json({ staff });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to fetch staff");
    }
}
export async function updateStaff(req, res) {
    try {
        const schoolId = requireSchoolId(req);
        const auth = getAuthUser(req);
        const id = param(req, "id");
        const { email, password, adminPassword, name, phone, staffType, employeeCode, designation, department, joiningDate, leavingDate, isCurrentlyWorking, expectedPunchInTime, expectedPunchOutTime, isActive, } = req.body;
        const existing = await prisma.staffProfile.findFirst({
            where: { id, schoolId },
            include: {
                user: true,
                school: { select: { ownerId: true } },
            },
        });
        if (!existing) {
            throw notFound("Staff not found");
        }
        if (isProtectedAdminAccount(existing)) {
            if (!adminPassword) {
                throw badRequest("Admin password is required to edit an admin account");
            }
            const admin = await prisma.user.findUnique({
                where: { id: auth.userId },
            });
            if (!admin || admin.schoolId !== schoolId) {
                throw forbidden("Admin not found for this school");
            }
            const valid = await bcrypt.compare(adminPassword, admin.password);
            if (!valid) {
                throw forbidden("Incorrect admin password");
            }
        }
        if (isActive === false &&
            isProtectedAdminAccount(existing)) {
            throw forbidden("Admin accounts cannot be deactivated");
        }
        if (password != null && password !== "" && password.length < 8) {
            throw badRequest("Password must be at least 8 characters");
        }
        if (staffType !== undefined &&
            staffType !== "TEACHER" &&
            staffType !== "EMPLOYEE") {
            throw badRequest("staffType must be TEACHER or EMPLOYEE");
        }
        if (email && email !== existing.user.email) {
            const taken = await prisma.user.findUnique({ where: { email } });
            if (taken) {
                throw conflict("Email already registered");
            }
        }
        if (employeeCode && employeeCode !== existing.employeeCode) {
            const takenCode = await prisma.staffProfile.findFirst({
                where: {
                    schoolId,
                    employeeCode,
                    NOT: { id },
                },
            });
            if (takenCode) {
                throw conflict("Employee code already in use");
            }
        }
        const punchInTime = expectedPunchInTime !== undefined
            ? parseOptionalTime(expectedPunchInTime, "expectedPunchInTime")
            : undefined;
        const punchOutTime = expectedPunchOutTime !== undefined
            ? parseOptionalTime(expectedPunchOutTime, "expectedPunchOutTime")
            : undefined;
        const nextPunchIn = punchInTime !== undefined
            ? punchInTime
            : existing.expectedPunchInTime;
        const nextPunchOut = punchOutTime !== undefined
            ? punchOutTime
            : existing.expectedPunchOutTime;
        if (nextPunchIn &&
            nextPunchOut &&
            minutesFromHhMm(nextPunchOut) <= minutesFromHhMm(nextPunchIn)) {
            throw badRequest("expectedPunchOutTime must be after expectedPunchInTime");
        }
        const currentlyWorking = typeof isCurrentlyWorking === "boolean"
            ? isCurrentlyWorking
            : undefined;
        const hashedPassword = password && password.length >= 8
            ? await bcrypt.hash(password, 12)
            : undefined;
        const role = staffType === "TEACHER" || staffType === "EMPLOYEE"
            ? staffType
            : undefined;
        const result = await prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: existing.userId },
                data: {
                    ...(typeof name === "string" ? { name } : {}),
                    ...(typeof email === "string" ? { email } : {}),
                    ...(phone !== undefined ? { phone: phone || null } : {}),
                    ...(role ? { role } : {}),
                    ...(typeof isActive === "boolean" ? { isActive } : {}),
                    ...(hashedPassword ? { password: hashedPassword } : {}),
                },
            });
            return tx.staffProfile.update({
                where: { id },
                data: {
                    ...(staffType ? { staffType } : {}),
                    ...(typeof employeeCode === "string" ? { employeeCode } : {}),
                    ...(designation !== undefined
                        ? { designation: designation || null }
                        : {}),
                    ...(department !== undefined
                        ? { department: department || null }
                        : {}),
                    ...(joiningDate !== undefined
                        ? { joiningDate: joiningDate ? new Date(joiningDate) : null }
                        : {}),
                    ...(currentlyWorking !== undefined
                        ? {
                            isCurrentlyWorking: currentlyWorking,
                            ...(currentlyWorking ? { leavingDate: null } : {}),
                        }
                        : {}),
                    ...(leavingDate !== undefined && currentlyWorking !== true
                        ? { leavingDate: leavingDate ? new Date(leavingDate) : null }
                        : {}),
                    ...(punchInTime !== undefined
                        ? { expectedPunchInTime: punchInTime }
                        : {}),
                    ...(punchOutTime !== undefined
                        ? { expectedPunchOutTime: punchOutTime }
                        : {}),
                },
                include: staffInclude,
            });
        });
        res.json({ staff: result });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to update staff");
    }
}
export async function deleteStaff(req, res) {
    try {
        const schoolId = requireSchoolId(req);
        const id = param(req, "id");
        const existing = await prisma.staffProfile.findFirst({
            where: { id, schoolId },
            include: {
                user: { select: { id: true, role: true } },
                school: { select: { ownerId: true } },
            },
        });
        if (!existing) {
            throw notFound("Staff not found");
        }
        if (isProtectedAdminAccount(existing)) {
            throw forbidden("Admin accounts cannot be deactivated");
        }
        await prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: existing.userId },
                data: { isActive: false },
            });
            await tx.staffProfile.update({
                where: { id },
                data: {
                    isCurrentlyWorking: false,
                    leavingDate: existing.leavingDate ?? new Date(),
                },
            });
        });
        res.json({ ok: true });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to delete staff");
    }
}
/** Permanently delete staff after verifying the admin's own password. */
export async function purgeStaff(req, res) {
    try {
        const schoolId = requireSchoolId(req);
        const auth = getAuthUser(req);
        const id = param(req, "id");
        const { password } = req.body;
        if (!password) {
            throw badRequest("Admin password is required to permanently delete staff");
        }
        const existing = await prisma.staffProfile.findFirst({
            where: { id, schoolId },
            include: {
                user: { select: { id: true, role: true } },
                school: { select: { ownerId: true } },
            },
        });
        if (!existing) {
            throw notFound("Staff not found");
        }
        if (isProtectedAdminAccount(existing)) {
            throw forbidden("Admin accounts cannot be permanently deleted");
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
            await tx.classTeacher.deleteMany({
                where: { staffProfileId: id },
            });
            await tx.class.updateMany({
                where: { schoolId, classTeacherId: userId },
                data: { classTeacherId: null },
            });
            await tx.staffAttendance.deleteMany({
                where: { staffProfileId: id },
            });
            await tx.staffAttendance.updateMany({
                where: { markedById: userId },
                data: { markedById: null },
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
            await tx.staffProfile.delete({ where: { id } });
            await tx.user.delete({ where: { id: userId } });
        });
        res.json({ ok: true, permanent: true });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to permanently delete staff");
    }
}
export async function getMyStaffProfile(req, res) {
    try {
        const auth = getAuthUser(req);
        const profile = await prisma.staffProfile.findUnique({
            where: { userId: auth.userId },
            include: staffInclude,
        });
        if (!profile) {
            throw notFound("Staff profile not found");
        }
        res.json({ staff: profile });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to fetch staff profile");
    }
}
//# sourceMappingURL=staff.controller.js.map