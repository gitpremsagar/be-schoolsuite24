import type { Response } from "express";
import type { User, UserRole } from "@prisma/client";
export declare function setRefreshCookie(res: Response, refreshToken: string): void;
export declare function clearRefreshCookie(res: Response): void;
type PublicUser = {
    id: string;
    email: string;
    name: string;
    phone: string | null;
    role: UserRole;
    schoolId: string | null;
    isActive: boolean;
};
export declare function publicUser(user: User): PublicUser;
export declare function issueTokens(res: Response, user: User): {
    accessToken: string;
    refreshToken: string;
    user: PublicUser;
};
export {};
//# sourceMappingURL=session.d.ts.map