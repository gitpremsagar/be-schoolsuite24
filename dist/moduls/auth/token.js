import jwt from "jsonwebtoken";
import { config } from "../../lib/config.js";
export function signAccessToken(payload) {
    return jwt.sign(payload, config.jwtAccessSecret, {
        expiresIn: config.accessTokenExpiry,
    });
}
export function signRefreshToken(payload) {
    return jwt.sign(payload, config.jwtRefreshSecret, {
        expiresIn: config.refreshTokenExpiry,
    });
}
function parsePayload(decoded) {
    if (typeof decoded === "string") {
        throw new Error("Invalid token payload");
    }
    if (!decoded.userId ||
        !decoded.email ||
        !decoded.role ||
        typeof decoded.userId !== "string" ||
        typeof decoded.email !== "string" ||
        typeof decoded.role !== "string") {
        throw new Error("Invalid token payload");
    }
    return {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
        schoolId: typeof decoded.schoolId === "string" ? decoded.schoolId : null,
    };
}
export function verifyAccessToken(token) {
    return parsePayload(jwt.verify(token, config.jwtAccessSecret));
}
export function verifyRefreshToken(token) {
    return parsePayload(jwt.verify(token, config.jwtRefreshSecret));
}
//# sourceMappingURL=token.js.map