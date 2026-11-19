import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { badRequest, conflict, forbidden, unauthorized } from "../../lib/errors.js";
import { getAuthUser } from "../../middleware/auth.js";
import { handleControllerError } from "./auth.controller.js";
import { issueTokens } from "./session.js";

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
