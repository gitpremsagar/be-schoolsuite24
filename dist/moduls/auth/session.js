import { config } from "../../lib/config.js";
import { signAccessToken, signRefreshToken } from "./token.js";
function refreshCookieOptions() {
    return {
        httpOnly: true,
        sameSite: "lax",
        secure: config.isProduction,
        path: "/",
        maxAge: config.refreshCookieMaxAge,
    };
}
export function setRefreshCookie(res, refreshToken) {
    res.cookie(config.refreshCookieName, refreshToken, refreshCookieOptions());
}
export function clearRefreshCookie(res) {
    res.clearCookie(config.refreshCookieName, {
        httpOnly: true,
        sameSite: "lax",
        secure: config.isProduction,
        path: "/",
    });
}
export function publicUser(user) {
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        schoolId: user.schoolId,
        isActive: user.isActive,
    };
}
export function issueTokens(res, user) {
    const payload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        schoolId: user.schoolId,
    };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    setRefreshCookie(res, refreshToken);
    // refreshToken is also returned in the body for mobile clients (SecureStore).
    // Web continues to use the httpOnly cookie.
    return { accessToken, refreshToken, user: publicUser(user) };
}
//# sourceMappingURL=session.js.map