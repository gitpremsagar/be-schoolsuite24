import "dotenv/config";

function requireEnv(name: string): string {
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
  refreshCookieMaxAge: Number(
    process.env.REFRESH_COOKIE_MAX_AGE ?? 7 * 24 * 60 * 60 * 1000,
  ),
  isProduction: process.env.NODE_ENV === "production",
  refreshCookieName: "refreshToken",
} as const;
