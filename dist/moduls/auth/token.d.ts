import type { UserRole } from "@prisma/client";
export type TokenPayload = {
    userId: string;
    email: string;
    role: UserRole;
    schoolId: string | null;
};
export declare function signAccessToken(payload: TokenPayload): string;
export declare function signRefreshToken(payload: TokenPayload): string;
export declare function verifyAccessToken(token: string): TokenPayload;
export declare function verifyRefreshToken(token: string): TokenPayload;
//# sourceMappingURL=token.d.ts.map