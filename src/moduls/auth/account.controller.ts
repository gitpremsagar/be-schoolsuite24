import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { badRequest, conflict, forbidden, unauthorized } from "../../lib/errors.js";
import { getAuthUser } from "../../middleware/auth.js";
import { handleControllerError } from "./auth.controller.js";
import { issueTokens } from "./session.js";
import { validatePassword } from "./password-rules.js";
import { bumpTokenVersion } from "./token-version.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Change the signed-in user's login email.
 * Requires the current password, rejects duplicates and re-issues tokens so
 * the session keeps working with the new identity.
 */
export async function changeEmail(req: Request, res: Response) {
  try {
    const auth = getAuthUser(req);
    const body = (req.body ?? {}) as {
      email?: unknown;
      password?: unknown;
    };

    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email) {
      throw badRequest("New email is required");
    }
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
      throw badRequest("Enter a valid email address");
    }
    if (!password) {
      throw badRequest("Current password is required to change email");
    }

    const user = await prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user || !user.isActive) {
      throw unauthorized("User not found");
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw forbidden("Incorrect password");
    }

    if (user.email.toLowerCase() === email) {
      throw badRequest("This is already your login email");
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && existing.id !== user.id) {
      throw conflict("Email is already registered to another account");
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { email },
    });

    res.json(issueTokens(res, updated));
  } catch (error) {
    handleControllerError(res, error, "Failed to change email");
  }
}

/**
 * Change the signed-in user's password after verifying the current one.
 * Bumps tokenVersion to sign out other devices, then re-issues tokens so this
 * device stays signed in.
 */
export async function changePassword(req: Request, res: Response) {
  try {
    const auth = getAuthUser(req);
    const body = (req.body ?? {}) as {
      currentPassword?: unknown;
      newPassword?: unknown;
    };
    const currentPassword =
      typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword =
      typeof body.newPassword === "string" ? body.newPassword : "";

    if (!currentPassword) {
      throw badRequest("Current password is required");
    }
    validatePassword(newPassword);

    const user = await prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user || !user.isActive) {
      throw unauthorized("User not found");
    }

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      throw forbidden("Current password is incorrect");
    }
    if (
      currentPassword === newPassword ||
      (await bcrypt.compare(newPassword, user.password))
    ) {
      throw badRequest(
        "New password must be different from the current password",
      );
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed },
    });
    await bumpTokenVersion(user.id);

    // Re-read so the new tokens carry the bumped version.
    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });

    res.json(issueTokens(res, updated));
  } catch (error) {
    handleControllerError(res, error, "Failed to change password");
  }
}
