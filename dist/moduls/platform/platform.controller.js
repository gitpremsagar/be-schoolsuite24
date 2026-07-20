import { prisma } from "../../lib/prisma.js";
import { AppError, badRequest, notFound } from "../../lib/errors.js";
import { getAuthUser } from "../../middleware/auth.js";
import { handleControllerError } from "../auth/auth.controller.js";
import { param } from "../../lib/params.js";
export async function getPlatformOverview(req, res) {
    try {
        getAuthUser(req);
        const [totalSchools, trialSchools, activeSchools, expiredSchools, suspendedSchools, totalStudents, subscriptions,] = await Promise.all([
            prisma.school.count(),
            prisma.schoolSubscription.count({ where: { status: "TRIAL" } }),
            prisma.schoolSubscription.count({ where: { status: "ACTIVE" } }),
            prisma.schoolSubscription.count({ where: { status: "EXPIRED" } }),
            prisma.schoolSubscription.count({ where: { status: "SUSPENDED" } }),
            prisma.studentProfile.count(),
            prisma.schoolSubscription.findMany({
                where: { status: { in: ["TRIAL", "ACTIVE"] } },
                select: { pricePerStudent: true, schoolId: true },
            }),
        ]);
        const studentCounts = await prisma.enrollment.groupBy({
            by: ["schoolId"],
            where: { isActive: true },
            _count: { _all: true },
        });
        const countBySchool = new Map(studentCounts.map((row) => [row.schoolId, row._count._all]));
        let expectedMonthlyRevenue = 0;
        for (const sub of subscriptions) {
            const students = countBySchool.get(sub.schoolId) ?? 0;
            expectedMonthlyRevenue += students * sub.pricePerStudent;
        }
        res.json({
            totalSchools,
            trialSchools,
            activeSchools,
            expiredSchools,
            suspendedSchools,
            totalStudents,
            expectedMonthlyRevenue,
        });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to load platform overview");
    }
}
export async function listSchools(req, res) {
    try {
        getAuthUser(req);
        const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
        const status = typeof req.query.status === "string" ? req.query.status : undefined;
        const schools = await prisma.school.findMany({
            where: {
                ...(q
                    ? {
                        OR: [
                            { name: { contains: q } },
                            { email: { contains: q } },
                            { code: { contains: q } },
                        ],
                    }
                    : {}),
                ...(status
                    ? { subscription: { status: status } }
                    : {}),
            },
            include: {
                owner: {
                    select: { id: true, name: true, email: true, phone: true },
                },
                subscription: { include: { plan: true } },
                _count: {
                    select: {
                        studentProfiles: true,
                        staffProfiles: true,
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        });
        res.json({ schools });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to list schools");
    }
}
export async function getSchoolDetail(req, res) {
    try {
        getAuthUser(req);
        const id = param(req, "id");
        const school = await prisma.school.findUnique({
            where: { id },
            include: {
                owner: {
                    select: { id: true, name: true, email: true, phone: true },
                },
                subscription: { include: { plan: true, payments: { orderBy: { createdAt: "desc" } } } },
                _count: {
                    select: {
                        studentProfiles: true,
                        staffProfiles: true,
                        classes: true,
                        enrollments: true,
                    },
                },
            },
        });
        if (!school) {
            throw notFound("School not found");
        }
        const activeEnrollments = await prisma.enrollment.count({
            where: { schoolId: id, isActive: true },
        });
        res.json({
            school,
            activeEnrollments,
            dueAmount: (school.subscription?.pricePerStudent ?? 0) * activeEnrollments,
        });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to fetch school");
    }
}
export async function listPlans(_req, res) {
    try {
        const plans = await prisma.subscriptionPlan.findMany({
            orderBy: { sortOrder: "asc" },
        });
        res.json({ plans });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to list plans");
    }
}
export async function createPlan(req, res) {
    try {
        getAuthUser(req);
        const { name, description, defaultPricePerStudent, currency, interval, trialDays, isActive, sortOrder, } = req.body;
        if (!name || defaultPricePerStudent == null) {
            throw badRequest("name and defaultPricePerStudent are required");
        }
        const plan = await prisma.subscriptionPlan.create({
            data: {
                name,
                description: description ?? null,
                defaultPricePerStudent,
                currency: currency ?? "INR",
                interval: interval ?? "MONTHLY",
                trialDays: trialDays ?? 30,
                isActive: isActive ?? true,
                sortOrder: sortOrder ?? 0,
            },
        });
        res.status(201).json({ plan });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to create plan");
    }
}
export async function updatePlan(req, res) {
    try {
        getAuthUser(req);
        const id = param(req, "id");
        const body = req.body;
        const plan = await prisma.subscriptionPlan.update({
            where: { id },
            data: {
                ...(typeof body.name === "string" ? { name: body.name } : {}),
                ...(typeof body.description === "string" || body.description === null
                    ? { description: body.description }
                    : {}),
                ...(typeof body.defaultPricePerStudent === "number"
                    ? { defaultPricePerStudent: body.defaultPricePerStudent }
                    : {}),
                ...(typeof body.currency === "string" ? { currency: body.currency } : {}),
                ...(body.interval === "MONTHLY" || body.interval === "YEARLY"
                    ? { interval: body.interval }
                    : {}),
                ...(typeof body.trialDays === "number" ? { trialDays: body.trialDays } : {}),
                ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}),
                ...(typeof body.sortOrder === "number" ? { sortOrder: body.sortOrder } : {}),
            },
        });
        res.json({ plan });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to update plan");
    }
}
export async function updateSchoolSubscription(req, res) {
    try {
        const auth = getAuthUser(req);
        const schoolId = param(req, "schoolId");
        const body = req.body;
        const existing = await prisma.schoolSubscription.findUnique({
            where: { schoolId },
        });
        if (!existing) {
            throw notFound("Subscription not found");
        }
        const now = new Date();
        const subscription = await prisma.schoolSubscription.update({
            where: { schoolId },
            data: {
                ...(typeof body.pricePerStudent === "number"
                    ? { pricePerStudent: body.pricePerStudent }
                    : {}),
                ...(body.status
                    ? { status: body.status }
                    : {}),
                ...(typeof body.isAccessEnabled === "boolean"
                    ? {
                        isAccessEnabled: body.isAccessEnabled,
                        ...(body.isAccessEnabled
                            ? {
                                accessGrantedById: auth.userId,
                                accessGrantedAt: now,
                                accessRevokedAt: null,
                            }
                            : {
                                accessRevokedAt: now,
                            }),
                    }
                    : {}),
                ...(typeof body.accessNotes === "string"
                    ? { accessNotes: body.accessNotes }
                    : {}),
                ...(body.currentPeriodStart
                    ? { currentPeriodStart: new Date(body.currentPeriodStart) }
                    : {}),
                ...(body.currentPeriodEnd
                    ? { currentPeriodEnd: new Date(body.currentPeriodEnd) }
                    : {}),
            },
            include: { plan: true },
        });
        res.json({ subscription });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to update subscription");
    }
}
export async function recordPayment(req, res) {
    try {
        const auth = getAuthUser(req);
        const schoolId = param(req, "schoolId");
        const { studentCount, pricePerStudent, periodStart, periodEnd, paymentMethod, invoiceNumber, notes, grantAccess, } = req.body;
        const subscription = await prisma.schoolSubscription.findUnique({
            where: { schoolId },
        });
        if (!subscription) {
            throw notFound("Subscription not found");
        }
        const count = studentCount ??
            (await prisma.enrollment.count({
                where: { schoolId, isActive: true },
            }));
        const rate = pricePerStudent ?? subscription.pricePerStudent;
        if (count < 0 || rate < 0) {
            throw badRequest("studentCount and pricePerStudent must be non-negative");
        }
        const amount = count * rate;
        const now = new Date();
        const payment = await prisma.$transaction(async (tx) => {
            const created = await tx.payment.create({
                data: {
                    schoolId,
                    subscriptionId: subscription.id,
                    studentCount: count,
                    pricePerStudent: rate,
                    amount,
                    currency: subscription.currency,
                    status: "SUCCEEDED",
                    paidAt: now,
                    periodStart: periodStart ? new Date(periodStart) : now,
                    periodEnd: periodEnd ? new Date(periodEnd) : undefined,
                    paymentMethod: paymentMethod ?? "manual",
                    invoiceNumber: invoiceNumber ?? null,
                    notes: notes ?? null,
                    recordedById: auth.userId,
                },
            });
            if (grantAccess !== false) {
                await tx.schoolSubscription.update({
                    where: { schoolId },
                    data: {
                        status: "ACTIVE",
                        isAccessEnabled: true,
                        accessGrantedById: auth.userId,
                        accessGrantedAt: now,
                        accessRevokedAt: null,
                        currentPeriodStart: periodStart ? new Date(periodStart) : now,
                        currentPeriodEnd: periodEnd ? new Date(periodEnd) : undefined,
                    },
                });
            }
            return created;
        });
        res.status(201).json({ payment });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to record payment");
    }
}
export async function listPayments(req, res) {
    try {
        getAuthUser(req);
        const schoolId = typeof req.query.schoolId === "string" ? req.query.schoolId : undefined;
        const payments = await prisma.payment.findMany({
            where: schoolId ? { schoolId } : undefined,
            include: {
                school: { select: { id: true, name: true } },
                recordedBy: { select: { id: true, name: true, email: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 200,
        });
        res.json({ payments });
    }
    catch (error) {
        handleControllerError(res, error, "Failed to list payments");
    }
}
// silence unused import warning if any
void AppError;
//# sourceMappingURL=platform.controller.js.map