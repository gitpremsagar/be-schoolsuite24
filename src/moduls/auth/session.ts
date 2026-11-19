import type { CookieOptions, Response } from "express";
import type { User, UserRole } from "@prisma/client";
import { config } from "../../lib/config.js";
import { signAccessToken, signRefreshToken } from "./token.js";

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    path: "/",
    maxAge: config.refreshCookieMaxAge,
  };
}

export function setRefreshCookie(res: Response, refreshToken: string) {
  res.cookie(config.refreshCookieName, refreshToken, refreshCookieOptions());
}

type PublicUser = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: UserRole;
  schoolId: string | null;
  isActive: boolean;
};

export function publicUser(user: User): PublicUser {
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

export function issueTokens(res: Response, user: User) {
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
