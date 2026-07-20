import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@prisma/client";
export type AuthUser = {
    userId: string;
    email: string;
    role: UserRole;
    schoolId: string | null;
};
declare global {
    namespace Express {
        interface Request {
            user?: AuthUser;
        }
    }
}
export declare function requireAuth(req: Request, res: Response, next: NextFunction): void;
export declare function requireRoles(...roles: UserRole[]): (req: Request, res: Response, next: NextFunction) => void;
/** Ensure school users operate only within their school. Super admin bypasses. */
export declare function requireSchoolAccess(req: Request, res: Response, next: NextFunction): void;
/**
 * Block school users when subscription access is disabled.
 * Super admin always passes. Applied to school operational routes.
 */
export declare function requireActiveSubscription(req: Request, res: Response, next: NextFunction): Promise<void>;
export declare function getAuthUser(req: Request): AuthUser;
export declare function requireSchoolId(req: Request): string;
//# sourceMappingURL=auth.d.ts.map