import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { config } from "../../lib/config.js";
import { badRequest } from "../../lib/errors.js";
import { isRateLimited } from "../../lib/rate-limit.js";
import {
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
} from "../../lib/mailer.js";
import { handleControllerError } from "./auth.controller.js";
import { clearRefreshCookie } from "./session.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const REQUEST_LIMIT_PER_IP = 10;
const REQUEST_LIMIT_PER_EMAIL = 3;
const MIN_REQUEST_INTERVAL_MS = 60 * 1000;
const BCRYPT_ROUNDS = 12;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function validatePassword(password: string) {
  if (password.length < 8) {
    throw badRequest("Password must be at least 8 characters");
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw badRequest("Password must include at least one letter and one number");
  }
  if (password.length > 128) {
    throw badRequest("Password is too long");
  }
}

/**
 * Request a password reset link.
 * Always responds with the same message so accounts cannot be enumerated.
 */
export async function forgotPassword(req: Request, res: Response) {
  const genericMessage =
    "If an account exists for that email, we have sent a password reset link.";
  try {
    const rawEmail =
      typeof (req.body as { email?: unknown })?.email === "string"
        ? (req.body as { email: string }).email
        : "";
    const email = rawEmail.trim().toLowerCase();
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";

    if (!email || !EMAIL_PATTERN.test(email)) {
      throw badRequest("Enter a valid email address");
    }

    if (isRateLimited(`forgot:ip:${ip}`, REQUEST_LIMIT_PER_IP, REQUEST_WINDOW_MS)) {
      res.status(429).json({
        error: "Too many password reset requests. Please try again later.",
      });
      return;
    }
    if (
      isRateLimited(
        `forgot:email:${email}`,
        REQUEST_LIMIT_PER_EMAIL,
        REQUEST_WINDOW_MS,
      )
    ) {
      res.json({ message: genericMessage });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      res.json({ message: genericMessage });
      return;
    }

    // Throttle bursts for the same account, but keep the response identical.
    const recent = await prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        createdAt: { gt: new Date(Date.now() - MIN_REQUEST_INTERVAL_MS) },
      },
    });
    if (recent) {
      res.json({ message: genericMessage });
      return;
    }

    // Only the newest link stays valid.
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.now() + config.passwordResetTtlMinutes * 60 * 1000,
    );
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt,
        requestedIp: ip,
      },
    });

    const resetUrl = `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
    try {
      await sendPasswordResetEmail(
        user.email,
        resetUrl,
        config.passwordResetTtlMinutes,
      );
    } catch (mailError) {
      console.error("Failed to send password reset email", mailError);      // Remove the unusable token so a retry can succeed.
      await prisma.passwordResetToken
        .deleteMany({ where: { userId: user.id, tokenHash: hashToken(token) } })
        .catch(() => undefined);
      res.status(503).json({
        error:
          "We could not send the reset email right now. Please try again later.",
      });
      return;
    }

    res.json({ message: genericMessage });
  } catch (error) {
    handleControllerError(res, error, "Failed to start password reset");
  }
}

/** Consume a reset token and set a new password. The token is single use. */
export async function resetPassword(req: Request, res: Response) {
  try {
    const body = (req.body ?? {}) as { token?: unknown; password?: unknown };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!token) {
      throw badRequest("Reset link is invalid or has expired");
    }
    validatePassword(password);

    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });

    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
      throw badRequest("Reset link is invalid or has expired");
    }
    if (!record.user.isActive) {
      throw badRequest("This account is disabled. Contact your administrator.");
    }

    const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Atomically claim the token: only one request can mark it used.
    let claimed: { id: string } | null = null;
    try {
      claimed = await prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
        select: { id: true },
      });
    } catch {
      // Another request consumed it between our read and this update.
      claimed = null;
    }
    if (!claimed) {
      throw badRequest("Reset link is invalid or has expired");
    }

    await prisma.user.update({
      where: { id: record.userId },
      data: { password: hashed, tokenVersion: { increment: 1 } },
    });

    // Any other outstanding links for this account stop working.
    await prisma.passwordResetToken
      .deleteMany({ where: { userId: record.userId, id: { not: record.id } } })
      .catch(() => undefined);

    // Force every existing session to sign in again with the new password.
    clearRefreshCookie(res);

    try {
      await sendPasswordChangedEmail(record.user.email);
    } catch (mailError) {
      console.error("Failed to send password changed notice", mailError);
    }

    res.json({
      message: "Password updated. You can now sign in with your new password.",
    });
  } catch (error) {
    handleControllerError(res, error, "Failed to reset password");
  }
}
