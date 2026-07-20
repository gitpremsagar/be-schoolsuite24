import type { CookieOptions, NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import type { User, UserRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { config } from "../../lib/config.js";
import { addDays } from "../../lib/dates.js";
import { AppError, badRequest, conflict } from "../../lib/errors.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "./token.js";

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    path: "/",
    maxAge: config.refreshCookieMaxAge,
  };
}

function setRefreshCookie(res: Response, refreshToken: string) {
  res.cookie(config.refreshCookieName, refreshToken, refreshCookieOptions());
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(config.refreshCookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProduction,
    path: "/",
  });
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

function publicUser(user: User): PublicUser {
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

function issueTokens(res: Response, user: User) {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    schoolId: user.schoolId,
  };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  setRefreshCookie(res, refreshToken);
  return { accessToken, user: publicUser(user) };
}

async function getOrCreateDefaultPlan() {
  const existing = await prisma.subscriptionPlan.findFirst({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  if (existing) {
    return existing;
  }
  return prisma.subscriptionPlan.create({
    data: {
      name: "Standard",
      description: "Per-student subscription with 30-day free trial",
      defaultPricePerStudent: 5000,
      currency: "INR",
      interval: "MONTHLY",
      trialDays: 30,
      isActive: true,
      sortOrder: 0,
    },
  });
}

/** School owner registration: creates ADMIN + School + trial subscription. */
export async function register(req: Request, res: Response) {
  try {
    const {
      email,
      password,
      name,
      phone,
      schoolName,
      schoolEmail,
      schoolPhone,
      addressLine1,
      addressLine2,
      city,
      state,
      country,
      postalCode,
    } = req.body as {
      email?: string;
      password?: string;
      name?: string;
      phone?: string;
      schoolName?: string;
      schoolEmail?: string;
      schoolPhone?: string;
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      state?: string;
      country?: string;
      postalCode?: string;
    };

    if (!email || !password || !name || !schoolName) {
      throw badRequest(
        "Email, password, name, and schoolName are required",
      );
    }
    if (password.length < 8) {
      throw badRequest("Password must be at least 8 characters");
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw conflict("Email already registered");
    }

    const plan = await getOrCreateDefaultPlan();
    const hashedPassword = await bcrypt.hash(password, 12);
    const now = new Date();
    const trialEndsAt = addDays(now, plan.trialDays);

    const result = await prisma.$transaction(async (tx) => {
      const owner = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          name,
          phone: phone ?? null,
          role: "ADMIN",
          isActive: true,
        },
      });

      const school = await tx.school.create({
        data: {
          name: schoolName,
          email: schoolEmail ?? email,
          phone: schoolPhone ?? phone ?? null,
          addressLine1: addressLine1 ?? null,
          addressLine2: addressLine2 ?? null,
          city: city ?? null,
          state: state ?? null,
          country: country ?? null,
          postalCode: postalCode ?? null,
          ownerId: owner.id,
        },
      });

      const user = await tx.user.update({
        where: { id: owner.id },
        data: { schoolId: school.id },
      });

      await tx.staffProfile.create({
        data: {
          userId: user.id,
          schoolId: school.id,
          staffType: "ADMIN",
          employeeCode: "ADMIN-001",
          designation: "School Admin",
        },
      });

      await tx.schoolSubscription.create({
        data: {
          schoolId: school.id,
          planId: plan.id,
          status: "TRIAL",
          pricePerStudent: plan.defaultPricePerStudent,
          currency: plan.currency,
          interval: plan.interval,
          trialStartsAt: now,
          trialEndsAt,
          isAccessEnabled: true,
        },
      });

      return { user, school };
    });

    res.status(201).json({
      ...issueTokens(res, result.user),
      school: {
        id: result.school.id,
        name: result.school.name,
      },
    });
  } catch (error) {
    handleControllerError(res, error, "Failed to register");
  }
}

export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      throw badRequest("Email and password are required");
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    res.json(issueTokens(res, user));
  } catch (error) {
    handleControllerError(res, error, "Failed to login");
  }
}

export async function refresh(req: Request, res: Response) {
  try {
    const token = req.cookies?.[config.refreshCookieName] as string | undefined;
    if (!token) {
      res.status(401).json({ error: "Refresh token missing" });
      return;
    }

    let payload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      clearRefreshCookie(res);
      res.status(401).json({ error: "Invalid or expired refresh token" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });
    if (!user || !user.isActive) {
      clearRefreshCookie(res);
      res.status(401).json({ error: "User not found" });
      return;
    }

    res.json(issueTokens(res, user));
  } catch (error) {
    handleControllerError(res, error, "Failed to refresh token");
  }
}

export async function logout(_req: Request, res: Response) {
  clearRefreshCookie(res);
  res.json({ message: "Logged out" });
}

export async function me(req: Request, res: Response) {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: {
        school: {
          include: {
            subscription: {
              include: { plan: true },
            },
          },
        },
        studentProfile: true,
        staffProfile: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { password: _password, ...safe } = user;
    res.json({ user: safe });
  } catch (error) {
    handleControllerError(res, error, "Failed to fetch current user");
  }
}

export function handleControllerError(
  res: Response,
  error: unknown,
  fallback: string,
) {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  console.error(error);
  res.status(500).json({ error: fallback });
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
