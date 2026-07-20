import { verifyAccessToken } from "../moduls/auth/token.js";
import { prisma } from "../lib/prisma.js";
import { AppError, forbidden, unauthorized } from "../lib/errors.js";
export function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
        res.status(401).json({ error: "Access token required" });
        return;
    }
    const token = header.slice("Bearer ".length).trim();
    if (!token) {
        res.status(401).json({ error: "Access token required" });
        return;
    }
    try {
        const payload = verifyAccessToken(token);
        req.user = {
            userId: payload.userId,
            email: payload.email,
            role: payload.role,
            schoolId: payload.schoolId,
        };
        next();
    }
    catch {
        res.status(401).json({ error: "Invalid or expired access token" });
    }
}
export function requireRoles(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }
        if (!roles.includes(req.user.role)) {
            res.status(403).json({ error: "Forbidden" });
            return;
        }
        next();
    };
}
/** Ensure school users operate only within their school. Super admin bypasses. */
export function requireSchoolAccess(req, res, next) {
    if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    if (req.user.role === "SUPER_ADMIN") {
        next();
        return;
    }
    if (!req.user.schoolId) {
        res.status(403).json({ error: "School membership required" });
        return;
    }
    next();
}
/**
 * Block school users when subscription access is disabled.
 * Super admin always passes. Applied to school operational routes.
 */
export async function requireActiveSubscription(req, res, next) {
    try {
        if (!req.user) {
            throw unauthorized();
        }
        if (req.user.role === "SUPER_ADMIN") {
            next();
            return;
        }
        if (!req.user.schoolId) {
            throw forbidden("School membership required");
        }
        const subscription = await prisma.schoolSubscription.findUnique({
            where: { schoolId: req.user.schoolId },
        });
        if (!subscription) {
            throw forbidden("No subscription found for this school");
        }
        const statusOk = subscription.status === "TRIAL" || subscription.status === "ACTIVE";
        if (!subscription.isAccessEnabled || !statusOk) {
            res.status(403).json({
                error: "School access is disabled. Please renew your subscription.",
                code: "SUBSCRIPTION_INACTIVE",
                subscription: {
                    status: subscription.status,
                    isAccessEnabled: subscription.isAccessEnabled,
                    trialEndsAt: subscription.trialEndsAt,
                    currentPeriodEnd: subscription.currentPeriodEnd,
                },
            });
            return;
        }
        next();
    }
    catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }
        console.error(error);
        res.status(500).json({ error: "Failed to verify subscription" });
    }
}
export function getAuthUser(req) {
    if (!req.user) {
        throw unauthorized();
    }
    return req.user;
}
export function requireSchoolId(req) {
    const user = getAuthUser(req);
    if (user.role === "SUPER_ADMIN") {
        const fromQuery = req.query.schoolId;
        if (typeof fromQuery === "string" && fromQuery) {
            return fromQuery;
        }
        const fromBody = req.body?.schoolId;
        if (fromBody) {
            return fromBody;
        }
        throw forbidden("schoolId is required for this action");
    }
    if (!user.schoolId) {
        throw forbidden("School membership required");
    }
    return user.schoolId;
}
//# sourceMappingURL=auth.js.map