import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { requireSchoolId } from "../../middleware/auth.js";
import { handleControllerError } from "../auth/auth.controller.js";

export async function getUsers(req: Request, res: Response) {
  try {
    const schoolId = requireSchoolId(req);
    const users = await prisma.user.findMany({
      where: { schoolId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ users });
  } catch (error) {
    handleControllerError(res, error, "Failed to fetch users");
  }
}
