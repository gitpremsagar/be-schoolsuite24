import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import type { UserRole } from "@prisma/client";
import { config } from "../../lib/config.js";

export type TokenPayload = {
  userId: string;
  email: string;
  role: UserRole;
  schoolId: string | null;
};

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.jwtAccessSecret, {
    expiresIn: config.accessTokenExpiry as NonNullable<
      SignOptions["expiresIn"]
    >,
  });
}

export function signRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.jwtRefreshSecret, {
    expiresIn: config.refreshTokenExpiry as NonNullable<
      SignOptions["expiresIn"]
    >,
  });
}

function parsePayload(decoded: string | jwt.JwtPayload): TokenPayload {
  if (typeof decoded === "string") {
    throw new Error("Invalid token payload");
  }
  if (
    !decoded.userId ||
    !decoded.email ||
    !decoded.role ||
    typeof decoded.userId !== "string" ||
    typeof decoded.email !== "string" ||
    typeof decoded.role !== "string"
  ) {
    throw new Error("Invalid token payload");
  }
  return {
    userId: decoded.userId,
    email: decoded.email,
    role: decoded.role as UserRole,
    schoolId:
      typeof decoded.schoolId === "string" ? decoded.schoolId : null,
  };
}

export function verifyAccessToken(token: string): TokenPayload {
  return parsePayload(jwt.verify(token, config.jwtAccessSecret));
}

export function verifyRefreshToken(token: string): TokenPayload {
  return parsePayload(jwt.verify(token, config.jwtRefreshSecret));
}
