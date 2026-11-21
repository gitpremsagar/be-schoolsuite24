import "dotenv/config";
function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
export const config = {
    jwtAccessSecret: requireEnv("JWT_ACCESS_SECRET"),
    jwtRefreshSecret: requireEnv("JWT_REFRESH_SECRET"),
    accessTokenExpiry: process.env.ACCESS_TOKEN_EXPIRY ?? "15m",
    refreshTokenExpiry: process.env.REFRESH_TOKEN_EXPIRY ?? "7d",
    refreshCookieMaxAge: Number(process.env.REFRESH_COOKIE_MAX_AGE ?? 7 * 24 * 60 * 60 * 1000),
    isProduction: process.env.NODE_ENV === "production",
    refreshCookieName: "refreshToken",
    // Deep link the staff punch QR poster encodes; the token is appended as a query param
    staffPunchQrLinkBase: process.env.STAFF_PUNCH_QR_LINK_BASE ?? "mobileteacher://qr-punch",
    // Web app origin used to build links in emails (e.g. password reset)
    appUrl: (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    passwordResetTtlMinutes: Math.max(1, Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 15)),
    // SMTP (nodemailer). When SMTP_HOST is missing, reset emails are logged instead.
    smtp: {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === "true",
        // Self-signed certificates are common on internal relays; opt in when needed.
        tlsRejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
        from: process.env.MAIL_FROM ?? process.env.SMTP_USER ?? "",
    },
};
//# sourceMappingURL=config.js.map